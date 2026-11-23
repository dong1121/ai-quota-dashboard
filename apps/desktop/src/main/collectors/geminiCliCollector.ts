import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { DatabaseRepository, BucketWindowConfig } from '../db/repository.js';

interface GeminiSessionMessage {
  id?: string;
  type?: string;
  timestamp?: string;
  model?: string;
  tokens?: {
    input?: number;
    output?: number;
    cached?: number;
    thoughts?: number;
    tool?: number;
    total?: number;
  };
}

interface GeminiSessionFile {
  sessionId?: string;
  messages?: GeminiSessionMessage[];
}

export class GeminiCliCollector {
  private readonly baseDir: string;
  private readonly repository: DatabaseRepository;
  private readonly getWindowConfig: () => BucketWindowConfig;
  private watcher: FSWatcher | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastScanAt: string | null = null;

  constructor(
    repository: DatabaseRepository,
    getWindowConfig: () => BucketWindowConfig,
    baseDir?: string,
  ) {
    this.repository = repository;
    this.getWindowConfig = getWindowConfig;
    this.baseDir = baseDir ?? path.join(os.homedir(), '.gemini');
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  exists(): boolean {
    return fs.existsSync(this.baseDir);
  }

  getLastScanAt(): string | null {
    return this.lastScanAt;
  }

  /**
   * Read active Google account email from ~/.gemini/google_accounts.json.
   * Never reads oauth_creds.json or any credentials.
   */
  resolveActiveEmail(): string | null {
    const accountsPath = path.join(this.baseDir, 'google_accounts.json');
    if (!fs.existsSync(accountsPath)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(accountsPath, 'utf-8')) as {
        active?: string | null;
        old?: string[];
      };
      if (typeof raw.active === 'string' && raw.active.includes('@')) {
        return raw.active.trim().toLowerCase();
      }
      if (Array.isArray(raw.old)) {
        const firstValid = raw.old.find((e) => typeof e === 'string' && e.includes('@'));
        if (firstValid) return firstValid.trim().toLowerCase();
      }
    } catch {
      // Ignore unreadable file
    }
    return null;
  }

  scanNow(): { scannedFiles: number; insertedEvents: number } {
    this.lastScanAt = new Date().toISOString();
    if (!fs.existsSync(this.baseDir)) {
      return { scannedFiles: 0, insertedEvents: 0 };
    }

    const identityKey = this.resolveActiveEmail() ?? 'gemini-cli-local';
    const tmpDir = path.join(this.baseDir, 'tmp');
    let scannedFiles = 0;
    let insertedEvents = 0;

    if (fs.existsSync(tmpDir)) {
      const jsonFiles = collectJsonFilesRecursive(tmpDir, 4);
      const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60_000;

      for (const filePath of jsonFiles) {
        const baseName = path.basename(filePath).toLowerCase();
        const isSession = baseName.startsWith('session-') && baseName.endsWith('.json');
        const isLogs = baseName === 'logs.json';
        if (!isSession && !isLogs) continue;

        try {
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < sevenDaysAgoMs) continue;
          scannedFiles += 1;
          insertedEvents += this.ingestFile(filePath, identityKey);
        } catch {
          // Skip transient or unreadable files
        }
      }
    }

    // Ensure card appears even if user has logged into Gemini CLI with 0 chats today
    if (identityKey.includes('@') || scannedFiles > 0) {
      this.repository.applyHeartbeat({
        provider: 'gemini',
        identityKey,
        buckets: [
          {
            bucketType: 'gemini_cli',
            measureMode: 'count',
            limitValue: this.getWindowConfig().geminiCliDailyLimit,
          },
        ],
      });
    }

    return { scannedFiles, insertedEvents };
  }

  private ingestFile(filePath: string, identityKey: string): number {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return 0;
    }

    let inserted = 0;
    const fileKey = path.basename(filePath, '.json');

    // Format A: session-*.json { sessionId, messages: [...] }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const session = parsed as GeminiSessionFile;
      if (Array.isArray(session.messages)) {
        const sessionId = session.sessionId || fileKey;
        session.messages.forEach((msg, index) => {
          if (msg.type !== 'gemini' && msg.type !== 'model') return;
          const msgId = msg.id || String(index);
          const totalTokens =
            msg.tokens?.total ??
            (msg.tokens?.input ?? 0) +
              (msg.tokens?.output ?? 0) +
              (msg.tokens?.thoughts ?? 0);
          const occurredAt = isValidIso(msg.timestamp)
            ? msg.timestamp!
            : new Date().toISOString();

          const res = this.repository.recordUsageEvent(
            {
              provider: 'gemini',
              identityKey,
              bucketType: 'gemini_cli',
              measureMode: 'count',
              source: 'cli_local',
              modelName: msg.model ?? 'gemini-cli',
              deltaCount: 1,
              tokensUsed: totalTokens,
              occurredAt,
              externalEventId: `gcli:${sessionId}:${msgId}`,
            },
            this.getWindowConfig(),
          );
          if (res.inserted) inserted += 1;
        });
      }
      return inserted;
    }

    // Format B: logs.json array [{ sessionId, messageId, type, timestamp }]
    if (Array.isArray(parsed)) {
      const parentHash = path.basename(path.dirname(filePath));
      parsed.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') return;
        const rec = entry as Record<string, unknown>;
        const entryType = String(rec.type ?? '').toLowerCase();
        // Count user prompts in logs.json only when chats/session-*.json isn't present
        if (entryType !== 'user') return;
        const sessionId = String(rec.sessionId ?? parentHash);
        const msgId = String(rec.messageId ?? index);
        const ts = typeof rec.timestamp === 'string' && isValidIso(rec.timestamp)
          ? rec.timestamp
          : new Date().toISOString();

        // Only use logs.json if sibling chats/ folder doesn't exist to avoid double counting
        const siblingChatsDir = path.join(path.dirname(filePath), 'chats');
        if (fs.existsSync(siblingChatsDir)) return;

        const res = this.repository.recordUsageEvent(
          {
            provider: 'gemini',
            identityKey,
            bucketType: 'gemini_cli',
            measureMode: 'count',
            source: 'cli_local',
            modelName: 'gemini-cli',
            deltaCount: 1,
            tokensUsed: 0,
            occurredAt: ts,
            externalEventId: `gcli-log:${sessionId}:${msgId}`,
          },
          this.getWindowConfig(),
        );
        if (res.inserted) inserted += 1;
      });
    }

    return inserted;
  }

  start(): void {
    this.scanNow();

    const tmpDir = path.join(this.baseDir, 'tmp');
    if (fs.existsSync(tmpDir)) {
      this.watcher = chokidar.watch(tmpDir, {
        ignoreInitial: true,
        depth: 4,
        awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
      });

      const onFileChange = (filePath: string) => {
        const lower = filePath.toLowerCase();
        if (!lower.endsWith('.json')) return;
        const identityKey = this.resolveActiveEmail() ?? 'gemini-cli-local';
        this.ingestFile(filePath, identityKey);
        this.lastScanAt = new Date().toISOString();
      };

      this.watcher.on('add', onFileChange);
      this.watcher.on('change', onFileChange);
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

function collectJsonFilesRecursive(dir: string, maxDepth: number, depth = 0): string[] {
  if (depth > maxDepth) return [];
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsonFilesRecursive(full, maxDepth, depth + 1));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      results.push(full);
    }
  }
  return results;
}

function isValidIso(val: unknown): boolean {
  return typeof val === 'string' && !Number.isNaN(Date.parse(val));
}
