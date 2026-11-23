import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { DatabaseRepository, BucketWindowConfig } from '../db/repository.js';

interface TranscriptStep {
  step_index?: number;
  type?: string;
  status?: string;
  created_at?: string;
}

export class AntigravityCliCollector {
  private readonly agyDir: string;
  private readonly geminiDir: string;
  private readonly repository: DatabaseRepository;
  private readonly getWindowConfig: () => BucketWindowConfig;
  private readonly fileOffsets = new Map<string, number>();
  private watcher: FSWatcher | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastScanAt: string | null = null;

  constructor(
    repository: DatabaseRepository,
    getWindowConfig: () => BucketWindowConfig,
    agyDir?: string,
    geminiDir?: string,
  ) {
    this.repository = repository;
    this.getWindowConfig = getWindowConfig;
    const defaultGeminiDir = path.join(os.homedir(), '.gemini');
    this.geminiDir = geminiDir ?? defaultGeminiDir;
    this.agyDir = agyDir ?? path.join(this.geminiDir, 'antigravity-cli');
  }

  getBaseDir(): string {
    return this.agyDir;
  }

  exists(): boolean {
    return fs.existsSync(this.agyDir);
  }

  getLastScanAt(): string | null {
    return this.lastScanAt;
  }

  resolveIdentityKey(): string {
    // 1. Check antigravity-cli/settings.json for any configured account email
    const settingsPath = path.join(this.agyDir, 'settings.json');
    if (fs.existsSync(settingsPath)) {
      try {
        const raw = fs.readFileSync(settingsPath, 'utf-8');
        const emailMatch = raw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (emailMatch?.[0]) {
          return emailMatch[0].toLowerCase();
        }
      } catch {
        // ignore
      }
    }

    // 2. Fallback to ~/.gemini/google_accounts.json so it groups cleanly under the Google account
    const accountsPath = path.join(this.geminiDir, 'google_accounts.json');
    if (fs.existsSync(accountsPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(accountsPath, 'utf-8')) as {
          active?: string | null;
        };
        if (typeof parsed.active === 'string' && parsed.active.includes('@')) {
          return parsed.active.trim().toLowerCase();
        }
      } catch {
        // ignore
      }
    }

    return 'antigravity-local';
  }

  scanNow(): { scannedFiles: number; insertedEvents: number } {
    this.lastScanAt = new Date().toISOString();
    if (!fs.existsSync(this.agyDir)) {
      return { scannedFiles: 0, insertedEvents: 0 };
    }

    const identityKey = this.resolveIdentityKey();
    const brainDir = path.join(this.agyDir, 'brain');
    let scannedFiles = 0;
    let insertedEvents = 0;

    if (fs.existsSync(brainDir)) {
      let convDirs: fs.Dirent[];
      try {
        convDirs = fs.readdirSync(brainDir, { withFileTypes: true });
      } catch {
        convDirs = [];
      }

      const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60_000;
      for (const entry of convDirs) {
        if (!entry.isDirectory()) continue;
        const transcriptPath = path.join(
          brainDir,
          entry.name,
          '.system_generated',
          'logs',
          'transcript.jsonl',
        );
        if (!fs.existsSync(transcriptPath)) continue;

        try {
          const stat = fs.statSync(transcriptPath);
          if (stat.mtimeMs < sevenDaysAgoMs) continue;
          scannedFiles += 1;
          insertedEvents += this.ingestTranscriptIncremental(
            transcriptPath,
            entry.name,
            identityKey,
          );
        } catch {
          // ignore transient file lock
        }
      }
    }

    if (scannedFiles > 0) {
      this.repository.applyHeartbeat({
        provider: 'gemini',
        identityKey,
        buckets: [
          {
            bucketType: 'antigravity_cli',
            measureMode: 'count',
            limitValue: this.getWindowConfig().antigravityCliDailyLimit,
          },
        ],
      });
    }

    return { scannedFiles, insertedEvents };
  }

  private ingestTranscriptIncremental(
    filePath: string,
    conversationId: string,
    identityKey: string,
  ): number {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return 0;
    }

    const prevOffset = this.fileOffsets.get(filePath) ?? 0;
    const startOffset = stat.size < prevOffset ? 0 : prevOffset;
    if (stat.size === startOffset) return 0;

    const bytesToRead = stat.size - startOffset;
    const buffer = Buffer.alloc(bytesToRead);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buffer, 0, bytesToRead, startOffset);
    } finally {
      fs.closeSync(fd);
    }

    const chunkText = buffer.toString('utf-8');
    const lastNewline = chunkText.lastIndexOf('\n');
    const completeText = lastNewline >= 0 ? chunkText.slice(0, lastNewline + 1) : chunkText;
    const consumedBytes = Buffer.byteLength(completeText, 'utf-8');
    this.fileOffsets.set(filePath, startOffset + consumedBytes);

    const lines = completeText.split(/\r?\n/);
    let inserted = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;
      let step: TranscriptStep;
      try {
        step = JSON.parse(line) as TranscriptStep;
      } catch {
        continue;
      }

      if (step.type !== 'PLANNER_RESPONSE') continue;
      if (step.status && step.status !== 'DONE') continue;

      const stepIdx = step.step_index ?? i;
      const occurredAt =
        typeof step.created_at === 'string' && !Number.isNaN(Date.parse(step.created_at))
          ? step.created_at
          : new Date().toISOString();

      const res = this.repository.recordUsageEvent(
        {
          provider: 'gemini',
          identityKey,
          bucketType: 'antigravity_cli',
          measureMode: 'count',
          source: 'cli_local',
          modelName: 'antigravity-cli',
          deltaCount: 1,
          tokensUsed: 0,
          occurredAt,
          externalEventId: `agy:${conversationId}:${stepIdx}`,
        },
        this.getWindowConfig(),
      );
      if (res.inserted) inserted += 1;
    }

    return inserted;
  }

  start(): void {
    this.scanNow();

    const brainDir = path.join(this.agyDir, 'brain');
    if (fs.existsSync(brainDir)) {
      this.watcher = chokidar.watch(brainDir, {
        ignoreInitial: true,
        depth: 4,
        awaitWriteFinish: { stabilityThreshold: 350, pollInterval: 100 },
      });

      const onChange = (filePath: string) => {
        if (!filePath.endsWith('transcript.jsonl')) return;
        const rel = path.relative(brainDir, filePath);
        const convId = rel.split(path.sep)[0] ?? 'unknown';
        this.ingestTranscriptIncremental(filePath, convId, this.resolveIdentityKey());
        this.lastScanAt = new Date().toISOString();
      };

      this.watcher.on('add', onChange);
      this.watcher.on('change', onChange);
    }

    this.pollTimer = setInterval(() => {
      this.scanNow();
    }, 60_000);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
