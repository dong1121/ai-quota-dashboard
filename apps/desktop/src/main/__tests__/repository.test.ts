import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseRepository } from '../db/repository.js';

const tempDirs: string[] = [];

function createTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-quota-repo-test-'));
  tempDirs.push(dir);
  return path.join(dir, 'quota.db');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('DatabaseRepository', () => {
  it('merges Gemini Web and Gemini CLI under the same Google email account', async () => {
    const dbPath = createTempDbPath();
    const repo = await DatabaseRepository.create(dbPath);

    try {
      // 1. Chrome extension reports Gemini Web usage
      repo.recordUsageEvent({
        provider: 'gemini',
        identityKey: 'Dong1121.AI@gmail.com',
        profileHint: 'Chrome 藍窗',
        bucketType: 'gemini_web',
        source: 'chrome_ext',
        deltaCount: 1,
      });

      // 2. Local CLI watcher reports Gemini CLI usage for same email (different casing)
      repo.recordUsageEvent({
        provider: 'gemini',
        identityKey: 'dong1121.ai@gmail.com',
        bucketType: 'gemini_cli',
        source: 'cli_local',
        deltaCount: 1,
        tokensUsed: 1500,
        externalEventId: 'gcli:sess1:msg1',
      });

      // 3. Re-ingesting the exact same externalEventId must be idempotent
      const dup = repo.recordUsageEvent({
        provider: 'gemini',
        identityKey: 'dong1121.ai@gmail.com',
        bucketType: 'gemini_cli',
        source: 'cli_local',
        deltaCount: 1,
        tokensUsed: 1500,
        externalEventId: 'gcli:sess1:msg1',
      });
      expect(dup.inserted).toBe(false);

      const accounts = repo.getAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0]!.displayName).toBe('don***@gmail.com');
      expect(accounts[0]!.buckets.map((b) => b.bucketType)).toEqual(['gemini_web', 'gemini_cli']);
      expect(accounts[0]!.buckets.find((b) => b.bucketType === 'gemini_cli')?.usedValue).toBe(1);
      expect(accounts[0]!.buckets.find((b) => b.bucketType === 'gemini_cli')?.tokensToday).toBe(
        1500,
      );
    } finally {
      repo.close();
    }
  });

  it('persists Claude snapshots accurately across restarts', async () => {
    const dbPath = createTempDbPath();
    const repo1 = await DatabaseRepository.create(dbPath);
    const futureReset = new Date(Date.now() + 2 * 60 * 60_000).toISOString();

    repo1.applySnapshot({
      provider: 'claude',
      identityKey: 'me@example.com',
      buckets: [
        {
          bucketType: 'claude_5h',
          measureMode: 'percent',
          usedValue: 82,
          limitValue: 100,
          resetAt: futureReset,
        },
        {
          bucketType: 'claude_weekly',
          measureMode: 'percent',
          usedValue: 41,
          limitValue: 100,
        },
      ],
    });
    repo1.close();

    // Reopen from disk to verify SQLite persistence
    const repo2 = await DatabaseRepository.create(dbPath);
    try {
      const accounts = repo2.getAccounts();
      expect(accounts).toHaveLength(1);
      const b5h = accounts[0]!.buckets.find((b) => b.bucketType === 'claude_5h');
      const bWk = accounts[0]!.buckets.find((b) => b.bucketType === 'claude_weekly');
      expect(b5h?.usedValue).toBe(82);
      expect(b5h?.status).toBe('warning');
      expect(bWk?.usedValue).toBe(41);
      expect(bWk?.status).toBe('ok');
    } finally {
      repo2.close();
    }
  });
});
