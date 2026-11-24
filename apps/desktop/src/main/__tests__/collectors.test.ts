import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseRepository } from '../db/repository.js';
import { GeminiCliCollector } from '../collectors/geminiCliCollector.js';
import { AntigravityCliCollector } from '../collectors/antigravityCliCollector.js';
import { syncBundledExtension } from '../extensionSync.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('Local CLI Collectors', () => {
  it('scans Gemini CLI and Antigravity CLI fixtures and groups them under the same Google email', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-quota-cli-test-'));
    tempDirs.push(root);

    const mockGeminiDir = path.join(root, '.gemini');
    const mockAgyDir = path.join(mockGeminiDir, 'antigravity-cli');
    const mockAgyAppDir = path.join(mockGeminiDir, 'antigravity');
    const chatsDir = path.join(mockGeminiDir, 'tmp', 'projhash123', 'chats');
    const agyLogDir = path.join(mockAgyDir, 'brain', 'conv-1', '.system_generated', 'logs');
    const agyAppLogDir = path.join(mockAgyAppDir, 'brain', 'app-conv-1', '.system_generated', 'logs');

    fs.mkdirSync(chatsDir, { recursive: true });
    fs.mkdirSync(agyLogDir, { recursive: true });
    fs.mkdirSync(agyAppLogDir, { recursive: true });

    // Mock ~/.gemini/google_accounts.json
    fs.writeFileSync(
      path.join(mockGeminiDir, 'google_accounts.json'),
      JSON.stringify({ active: 'family.main@gmail.com', old: [] }),
      'utf-8',
    );

    const nowIso = new Date().toISOString();

    // Mock Gemini CLI session-*.json
    fs.writeFileSync(
      path.join(chatsDir, 'session-2026-11-20-abc.json'),
      JSON.stringify({
        sessionId: 'sess-001',
        messages: [
          { id: 'm1', type: 'user', timestamp: nowIso },
          {
            id: 'm2',
            type: 'gemini',
            timestamp: nowIso,
            model: 'gemini-2.5-pro',
            tokens: { input: 500, output: 300, total: 800 },
          },
          {
            id: 'm3',
            type: 'gemini',
            timestamp: nowIso,
            model: 'gemini-2.5-pro',
            tokens: { input: 200, output: 100, total: 300 },
          },
        ],
      }),
      'utf-8',
    );

    // Mock Antigravity CLI transcript.jsonl
    const transcriptLines = [
      JSON.stringify({ step_index: 1, type: 'USER_INPUT', status: 'DONE', created_at: nowIso }),
      JSON.stringify({
        step_index: 2,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: nowIso,
      }),
      JSON.stringify({
        step_index: 3,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: nowIso,
      }),
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(agyLogDir, 'transcript.jsonl'), transcriptLines, 'utf-8');

    // Mock Antigravity Desktop App transcript.jsonl under ~/.gemini/antigravity/
    fs.writeFileSync(
      path.join(agyAppLogDir, 'transcript.jsonl'),
      JSON.stringify({
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: nowIso,
      }) + '\n',
      'utf-8',
    );

    const repo = await DatabaseRepository.create(path.join(root, 'quota.db'));
    const windowCfg = () => ({ geminiCliDailyLimit: 1000, antigravityCliDailyLimit: 500 });

    try {
      const gcli = new GeminiCliCollector(repo, windowCfg, mockGeminiDir);
      const agy = new AntigravityCliCollector(
        repo,
        windowCfg,
        mockAgyDir,
        mockGeminiDir,
        mockAgyAppDir,
      );

      const gRes1 = gcli.scanNow();
      expect(gRes1.insertedEvents).toBe(2);
      // Second scan must insert 0 duplicates
      const gRes2 = gcli.scanNow();
      expect(gRes2.insertedEvents).toBe(0);

      const aRes1 = agy.scanNow();
      expect(aRes1.insertedEvents).toBe(3); // 2 from CLI + 1 from Desktop App
      // Append one more step to verify incremental byte-offset scan
      fs.appendFileSync(
        path.join(agyLogDir, 'transcript.jsonl'),
        JSON.stringify({
          step_index: 4,
          type: 'PLANNER_RESPONSE',
          status: 'DONE',
          created_at: nowIso,
        }) + '\n',
        'utf-8',
      );
      const aRes2 = agy.scanNow();
      expect(aRes2.insertedEvents).toBe(1);

      const accounts = repo.getAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0]!.identityKey).toBe('family.main@gmail.com');

      const cliBucket = accounts[0]!.buckets.find((b) => b.bucketType === 'gemini_cli');
      const agyBucket = accounts[0]!.buckets.find((b) => b.bucketType === 'antigravity_cli');

      expect(cliBucket?.usedValue).toBe(2);
      expect(cliBucket?.tokensToday).toBe(1100);
      expect(agyBucket?.usedValue).toBe(4);
    } finally {
      repo.close();
    }
  });

  it('syncs bundled extension files when version changes and skips when up-to-date', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-quota-extsync-test-'));
    tempDirs.push(root);
    const src = path.join(root, 'src');
    const dst = path.join(root, 'dst');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({ version: '1.1.0' }));
    fs.writeFileSync(path.join(src, 'background.js'), '// v1.1.0');

    const first = syncBundledExtension(src, dst);
    expect(first.synced).toBe(true);
    expect(first.version).toBe('1.1.0');
    expect(fs.existsSync(path.join(dst, 'background.js'))).toBe(true);

    const second = syncBundledExtension(src, dst);
    expect(second.synced).toBe(false);
    expect(second.version).toBe('1.1.0');
  });
});
