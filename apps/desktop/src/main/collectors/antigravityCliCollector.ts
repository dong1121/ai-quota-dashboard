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

interface AgySourceDir {
  id: 'cli' | 'app';
  dir: string;
}

export class AntigravityCliCollector {
  private readonly sources: AgySourceDir[];
  private readonly geminiDir: string;
  private readonly repository: DatabaseRepository;
  private readonly getWindowConfig: () => BucketWindowConfig;
  private readonly fileOffsets = new Map<string, number>();
  private readonly pbSnapshots = new Map<string, number>();
  private readonly watchers: FSWatcher[] = [];
  private pollTimer: NodeJS.Timeout | null = null;
  private lastScanAt: string | null = null;

  constructor(
    repository: DatabaseRepository,
    getWindowConfig: () => BucketWindowConfig,
    agyCliDir?: string,
    geminiDir?: string,
    agyAppDir?: string,
  ) {
    this.repository = repository;
    this.getWindowConfig = getWindowConfig;
    const defaultGeminiDir = path.join(os.homedir(), '.gemini');
    this.geminiDir = geminiDir ?? defaultGeminiDir;

    this.sources = [
      { id: 'cli', dir: agyCliDir ?? path.join(this.geminiDir, 'antigravity-cli') },
      { id: 'app', dir: agyAppDir ?? path.join(this.geminiDir, 'antigravity') },
    ];
  }

  getBaseDir(): string {
    const existing = this.sources.filter((s) => fs.existsSync(s.dir)).map((s) => s.dir);
    return existing.length > 0 ? existing.join(' | ') : this.sources[0]!.dir;
  }

  exists(): boolean {
    return this.sources.some((s) => fs.existsSync(s.dir));
  }

  getLastScanAt(): string | null {
    return this.lastScanAt;
  }

  resolveIdentityKey(): string {
    // 1. Check settings.json in either antigravity-cli or antigravity (Desktop App)
    for (const src of this.sources) {
      const settingsPath = path.join(src.dir, 'settings.json');
      if (!fs.existsSync(settingsPath)) continue;
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
    if (!this.exists()) {
      return { scannedFiles: 0, insertedEvents: 0 };
    }

    const identityKey = this.resolveIdentityKey();
    const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60_000;
    let scannedFiles = 0;
    let insertedEvents = 0;

    for (const src of this.sources) {
      if (!fs.existsSync(src.dir)) continue;

      // Primary: brain/<convId>/.system_generated/logs/transcript.jsonl (CLI & Desktop App)
      const brainDir = path.join(src.dir, 'brain');
      const convIdsWithTranscript = new Set<string>();

      if (fs.existsSync(brainDir)) {
        let convDirs: fs.Dirent[];
        try {
          convDirs = fs.readdirSync(brainDir, { withFileTypes: true });
        } catch {
          convDirs = [];
        }

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
            convIdsWithTranscript.add(entry.name);
            scannedFiles += 1;
            insertedEvents += this.ingestTranscriptIncremental(
              transcriptPath,
              src.id,
              entry.name,
              identityKey,
            );
          } catch {
            // ignore transient file lock
          }
        }
      }

      // Secondary fallback for Antigravity Desktop App (IDE) conversations stored as .pb without transcript.jsonl
      const convsDir = path.join(src.dir, 'conversations');
      if (fs.existsSync(convsDir)) {
        let pbFiles: fs.Dirent[];
        try {
          pbFiles = fs.readdirSync(convsDir, { withFileTypes: true });
        } catch {
          pbFiles = [];
        }

        for (const entry of pbFiles) {
          if (!entry.isFile() || !entry.name.endsWith('.pb')) continue;
          const convId = path.basename(entry.name, '.pb');
          if (convIdsWithTranscript.has(convId)) continue;

          const pbPath = path.join(convsDir, entry.name);
          try {
            const stat = fs.statSync(pbPath);
            if (stat.mtimeMs < sevenDaysAgoMs) continue;
            scannedFiles += 1;
            const prevSize = this.pbSnapshots.get(pbPath);
            this.pbSnapshots.set(pbPath, stat.size);

            // Bucket updates per 2-minute window so rapid writes count as one turn, not dozens
            const turnBucket = Math.floor(stat.mtimeMs / 120_000);
            if (prevSize === undefined || stat.size > prevSize) {
              const res = this.repository.recordUsageEvent(
                {
                  provider: 'gemini',
                  identityKey,
                  bucketType: 'antigravity_cli',
                  measureMode: 'count',
                  source: 'cli_local',
                  modelName: src.id === 'app' ? 'antigravity-app' : 'antigravity-cli',
                  deltaCount: 1,
                  tokensUsed: 0,
                  occurredAt: new Date(stat.mtimeMs).toISOString(),
                  externalEventId: `agy-pb:${src.id}:${convId}:${turnBucket}`,
                },
                this.getWindowConfig(),
              );
              if (res.inserted) insertedEvents += 1;
            }
          } catch {
            // ignore
          }
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
    sourceKind: 'cli' | 'app',
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

    // Keep legacy 'agy:<convId>:<step>' externalEventId for CLI so existing user DB records never duplicate!
    const prefix = sourceKind === 'cli' ? 'agy' : 'agy-app';

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
          modelName: sourceKind === 'app' ? 'antigravity-app' : 'antigravity-cli',
          deltaCount: 1,
          tokensUsed: 0,
          occurredAt,
          externalEventId: `${prefix}:${conversationId}:${stepIdx}`,
        },
        this.getWindowConfig(),
      );
      if (res.inserted) inserted += 1;
    }

    return inserted;
  }

  start(): void {
    this.scanNow();

    for (const src of this.sources) {
      const brainDir = path.join(src.dir, 'brain');
      if (!fs.existsSync(brainDir)) continue;
      const watcher = chokidar.watch(brainDir, {
        ignoreInitial: true,
        depth: 4,
        awaitWriteFinish: { stabilityThreshold: 350, pollInterval: 100 },
      });

      const onChange = (filePath: string) => {
        if (!filePath.endsWith('transcript.jsonl')) return;
        const rel = path.relative(brainDir, filePath);
        const convId = rel.split(path.sep)[0] ?? 'unknown';
        this.ingestTranscriptIncremental(filePath, src.id, convId, this.resolveIdentityKey());
        this.lastScanAt = new Date().toISOString();
      };

      watcher.on('add', onChange);
      watcher.on('change', onChange);
      this.watchers.push(watcher);
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
    while (this.watchers.length > 0) {
      const w = this.watchers.pop()!;
      await w.close();
    }
  }
}
