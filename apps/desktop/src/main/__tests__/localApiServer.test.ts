import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PAIRING_HEADER } from '@ai-quota/shared';
import { DatabaseRepository } from '../db/repository.js';
import { LocalApiServer } from '../server/localApiServer.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('LocalApiServer', () => {
  it('enforces pairing token and CORS origin isolation, and accepts valid ingest calls', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-quota-api-test-'));
    tempDirs.push(dir);
    const repo = await DatabaseRepository.create(path.join(dir, 'quota.db'));
    const token = 'K8M2-94Q1';

    const server = new LocalApiServer({
      port: 0, // Let OS assign an ephemeral free port
      version: '0.1.0',
      getPairingToken: () => token,
      getWindowConfig: () => ({ geminiCliDailyLimit: 1000, antigravityCliDailyLimit: 500 }),
      getCliStatus: () => ({
        geminiCliFound: false,
        geminiCliPath: '',
        geminiCliLastScan: null,
        antigravityCliFound: false,
        antigravityCliPath: '',
        antigravityCliLastScan: null,
      }),
      repository: repo,
    });

    const port = await server.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. Health endpoint works without token
      const healthRes = await fetch(`${baseUrl}/api/health`);
      expect(healthRes.status).toBe(200);
      const healthJson = (await healthRes.json()) as { ok: boolean };
      expect(healthJson.ok).toBe(true);

      // 2. Rejects unauthorized requests with 401
      const unauth = await fetch(`${baseUrl}/api/dashboard`);
      expect(unauth.status).toBe(401);

      // 3. Rejects malicious web origins with 403
      const evilCors = await fetch(`${baseUrl}/api/dashboard`, {
        headers: {
          Origin: 'https://evil.example',
          [PAIRING_HEADER]: token,
        },
      });
      expect(evilCors.status).toBe(403);

      // 4. Accepts chrome-extension origin with valid pairing token
      const verify = await fetch(`${baseUrl}/api/pair/verify`, {
        method: 'POST',
        headers: {
          Origin: 'chrome-extension://abcdefghijklmnop',
          [PAIRING_HEADER]: token,
        },
      });
      expect(verify.status).toBe(200);

      // 5. Ingest snapshot and read back via /api/dashboard
      const snapRes = await fetch(`${baseUrl}/api/ingest/snapshot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'chrome-extension://abcdefghijklmnop',
          [PAIRING_HEADER]: token,
        },
        body: JSON.stringify({
          provider: 'claude',
          identityKey: 'alice@example.com',
          buckets: [
            {
              bucketType: 'claude_5h',
              measureMode: 'percent',
              usedValue: 64,
              limitValue: 100,
            },
          ],
        }),
      });
      expect(snapRes.status).toBe(200);

      const dashRes = await fetch(`${baseUrl}/api/dashboard`, {
        headers: { [PAIRING_HEADER]: token },
      });
      expect(dashRes.status).toBe(200);
      const dash = (await dashRes.json()) as { accounts: Array<{ provider: string }> };
      expect(dash.accounts).toHaveLength(1);
      expect(dash.accounts[0]!.provider).toBe('claude');
    } finally {
      await server.stop();
      repo.close();
    }
  });
});
