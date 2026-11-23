import crypto from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import {
  DEFAULT_LOCAL_HOST,
  PAIRING_HEADER,
  type CliWatcherStatus,
  type DashboardPayload,
  type HealthResponse,
  type HeartbeatInput,
  type PairVerifyResponse,
  type QuotaSnapshotInput,
  type UsageEventInput,
} from '@ai-quota/shared';
import type { DatabaseRepository, BucketWindowConfig } from '../db/repository.js';

const MAX_BODY_BYTES = 256 * 1024;

export interface LocalApiServerOptions {
  port: number;
  version: string;
  getPairingToken: () => string;
  getWindowConfig: () => BucketWindowConfig;
  getCliStatus: () => CliWatcherStatus;
  repository: DatabaseRepository;
}

export class LocalApiServer {
  private server: http.Server | null = null;
  private actualPort: number;
  private readonly opts: LocalApiServerOptions;

  constructor(opts: LocalApiServerOptions) {
    this.opts = opts;
    this.actualPort = opts.port;
  }

  getPort(): number {
    return this.actualPort;
  }

  async start(): Promise<number> {
    if (this.server) return this.actualPort;

    const server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.opts.port, DEFAULT_LOCAL_HOST, () => {
        server.off('error', reject);
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          this.actualPort = addr.port;
        }
        resolve();
      });
    });

    this.server = server;
    return this.actualPort;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }

  private isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return true;
    return origin.startsWith('chrome-extension://');
  }

  private isValidToken(provided: string | undefined): boolean {
    if (!provided) return false;
    const expected = this.opts.getPairingToken();
    const a = Buffer.from(provided.trim(), 'utf-8');
    const b = Buffer.from(expected.trim(), 'utf-8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    if (!this.isAllowedOrigin(origin)) {
      this.sendJson(res, 403, { error: 'Forbidden origin' });
      return;
    }

    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${PAIRING_HEADER}`);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${DEFAULT_LOCAL_HOST}`);
    const pathname = url.pathname;

    // Public health probe (exposes no sensitive user data)
    if (req.method === 'GET' && pathname === '/api/health') {
      const payload: HealthResponse = {
        ok: true,
        version: this.opts.version,
        port: this.actualPort,
      };
      this.sendJson(res, 200, payload);
      return;
    }

    // All other routes require valid Pairing Token
    const tokenHeader = req.headers[PAIRING_HEADER];
    const providedToken = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
    if (!this.isValidToken(providedToken)) {
      this.sendJson(res, 401, { error: 'Invalid or missing pairing token' });
      return;
    }

    try {
      if (req.method === 'POST' && pathname === '/api/pair/verify') {
        const payload: PairVerifyResponse = {
          ok: true,
          version: this.opts.version,
          serverTime: new Date().toISOString(),
        };
        this.sendJson(res, 200, payload);
        return;
      }

      if (req.method === 'GET' && pathname === '/api/dashboard') {
        const payload: DashboardPayload = {
          accounts: this.opts.repository.getAccounts(),
          updatedAt: new Date().toISOString(),
          cliStatus: this.opts.getCliStatus(),
        };
        this.sendJson(res, 200, payload);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/ingest/heartbeat') {
        const body = await this.readJsonBody<HeartbeatInput>(req);
        if (!body.provider || !body.identityKey) {
          this.sendJson(res, 400, { error: 'Missing provider or identityKey' });
          return;
        }
        const accountId = this.opts.repository.applyHeartbeat(body);
        this.sendJson(res, 200, { ok: true, accountId });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/ingest/snapshot') {
        const body = await this.readJsonBody<QuotaSnapshotInput>(req);
        if (!body.provider || !body.identityKey || !Array.isArray(body.buckets)) {
          this.sendJson(res, 400, { error: 'Missing provider, identityKey, or buckets' });
          return;
        }
        const accountId = this.opts.repository.applySnapshot(body);
        this.sendJson(res, 200, { ok: true, accountId });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/ingest/event') {
        const body = await this.readJsonBody<UsageEventInput>(req);
        if (!body.provider || !body.identityKey || !body.bucketType || !body.source) {
          this.sendJson(res, 400, {
            error: 'Missing provider, identityKey, bucketType, or source',
          });
          return;
        }
        const result = this.opts.repository.recordUsageEvent(body, this.opts.getWindowConfig());
        this.sendJson(res, 200, { ok: true, ...result });
        return;
      }

      this.sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      this.sendJson(res, 400, { error: message });
    }
  }

  private readJsonBody<T>(req: IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      req.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_BODY_BYTES) {
          reject(new Error('Payload too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf-8');
          resolve((text ? JSON.parse(text) : {}) as T);
        } catch {
          reject(new Error('Invalid JSON payload'));
        }
      });
      req.on('error', reject);
    });
  }

  private sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(data));
  }
}
