import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { TvDevice } from '@shared/contracts/tv';
import { AppError, type AppErrorCode } from '@shared/errors';
import type { Logger } from '../logger';
import { isAllowedHost } from './network';

const MAX_BODY_BYTES = 64 * 1024;

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  /** Set for routes with `auth: 'device'`. */
  device: TvDevice | null;
  /** Remote IPv4 address of the TV. */
  address: string;
  /** Host header as validated (used to build absolute media URLs). */
  host: string;
}

/** Returned by handlers that wrote the response themselves (media streams). */
export const HANDLED = Symbol('handled');

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** e.g. `/api/v1/downloads/:id/actions` */
  path: string;
  /** `device`: Bearer device token; `none`: public (info, pairing); `media`: ticket in the URL, checked by the route. */
  auth: 'none' | 'device' | 'media';
  /** Stricter limit for unauthenticated routes that create state (pairing requests). */
  strictLimit?: boolean;
  handler: (ctx: RequestContext) => unknown;
}

interface CompiledRoute extends Route {
  regex: RegExp;
  keys: string[];
}

function compile(route: Route): CompiledRoute {
  const keys: string[] = [];
  const pattern = route.path
    .split('/')
    .map((part) => {
      if (!part.startsWith(':')) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      keys.push(part.slice(1));
      return '([^/]+)';
    })
    .join('/');
  return { ...route, regex: new RegExp(`^${pattern}$`), keys };
}

const STATUS: Partial<Record<AppErrorCode, number>> = {
  BAD_REQUEST: 400,
  TV_UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  JOB_NOT_FOUND: 404,
  FILE_MISSING: 404,
  DUPLICATE_JOB: 409,
  PATH_CONFLICT: 409,
  TV_PAIRING_BUSY: 409,
  TV_PAIRING_EXPIRED: 410,
  TV_UNSUPPORTED_MEDIA: 415,
  TV_RATE_LIMITED: 429,
  TMDB_RATE_LIMITED: 429,
  TMDB_NO_KEY: 503,
  TMDB_UNAVAILABLE: 503,
  ENGINE_UNAVAILABLE: 503,
  ENGINE_CRASHED: 503,
  ALL_SOURCES_FAILED: 503,
  SOURCE_UNAVAILABLE: 503,
  DISK_FULL: 507,
};

/** Token bucket per remote address. */
class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    private readonly now: () => number,
  ) {}

  take(key: string): boolean {
    const now = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.perSecond);
    b.at = now;
    this.buckets.set(key, b);
    if (this.buckets.size > 1000) this.buckets.clear();
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}

export interface TvHttpServerOptions {
  routes: Route[];
  authenticate: (token: string) => TvDevice | null;
  /** IPs this PC may be called by (Host allowlist against DNS rebinding). */
  allowedHosts: () => string[];
  log: Logger;
  now?: () => number;
}

function remoteAddress(req: IncomingMessage): string {
  const a = req.socket.remoteAddress ?? '';
  return a.startsWith('::ffff:') ? a.slice(7) : a;
}

/**
 * Minimal HTTP server for the TV API (D-82). Every request: Host allowlist, rate limit, route allowlist, token or
 * ticket, bounded JSON body. Errors are `{error:{code,requestId,retryable}}` without stack traces or paths. CORS allows
 * any origin without credentials: the bearer token, not the origin, authorizes (TV web apps run from file:// or
 * app origins that differ between firmwares).
 */
export class TvHttpServer {
  private server: Server | null = null;
  private readonly routes: CompiledRoute[];
  private readonly sockets = new Set<Socket>();
  private readonly streams = new Map<string, Set<ServerResponse>>();
  private readonly limiter: RateLimiter;
  private readonly strictLimiter: RateLimiter;
  private port = 0;

  constructor(private readonly opts: TvHttpServerOptions) {
    this.routes = opts.routes.map(compile);
    const now = opts.now ?? Date.now;
    this.limiter = new RateLimiter(120, 30, now);
    this.strictLimiter = new RateLimiter(5, 5 / 60, now);
  }

  get listening(): boolean {
    return this.server?.listening ?? false;
  }

  async listen(host: string, port: number): Promise<number> {
    await this.close();
    const server = createServer((req, res) => void this.handle(req, res));
    server.headersTimeout = 10_000;
    server.requestTimeout = 30_000;
    server.keepAliveTimeout = 5_000;
    server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) =>
        reject(
          new AppError(
            error.code === 'EADDRINUSE' || error.code === 'EACCES' ? 'TV_PORT_IN_USE' : 'TV_SERVER_FAILED',
            error.code,
          ),
        ),
      );
      server.listen({ host, port, exclusive: true }, () => resolve());
    });
    server.on('error', (error) => this.opts.log.error('tv server error', error));
    this.server = server;
    const address = server.address();
    this.port = typeof address === 'object' && address ? address.port : port;
    return this.port;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    this.streams.clear();
    await closed;
  }

  /** Revoke: cut the device's open media streams right away. */
  dropDevice(deviceId: string): void {
    for (const res of this.streams.get(deviceId) ?? []) res.destroy();
    this.streams.delete(deviceId);
  }

  /** Media routes register their response so a revoke can end it. */
  trackStream(deviceId: string, res: ServerResponse): void {
    let set = this.streams.get(deviceId);
    if (!set) this.streams.set(deviceId, (set = new Set()));
    set.add(res);
    res.on('close', () => set.delete(res));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = randomBytes(6).toString('hex');
    const started = Date.now();
    const address = remoteAddress(req);
    let routeName = 'unknown';
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, X-Request-Id');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (!isAllowedHost(req.headers.host, this.port, ['127.0.0.1', ...this.opts.allowedHosts()]))
        throw new AppError('FORBIDDEN', 'host');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      const url = new URL(req.url ?? '/', 'http://tv.invalid');
      const method = req.method === 'HEAD' ? 'GET' : req.method;
      let params: Record<string, string> = {};
      const route = this.routes.find((r) => {
        if (r.method !== method) return false;
        const m = r.regex.exec(url.pathname);
        if (!m) return false;
        params = Object.fromEntries(r.keys.map((k, i) => [k, decode(m[i + 1]!)]));
        return true;
      });
      if (!route) throw new AppError('NOT_FOUND');
      routeName = route.path;
      if (route.auth !== 'media' && !this.limiter.take(address)) throw new AppError('TV_RATE_LIMITED');
      if (route.strictLimit && !this.strictLimiter.take(address)) throw new AppError('TV_RATE_LIMITED');
      let device: TvDevice | null = null;
      if (route.auth === 'device') {
        const header = req.headers.authorization ?? '';
        const token = /^Bearer\s+([\w-]{20,200})$/.exec(header)?.[1];
        device = token ? this.opts.authenticate(token) : null;
        if (!device) throw new AppError('TV_UNAUTHORIZED');
      }
      const body = req.method === 'POST' || req.method === 'PUT' ? await readJson(req) : undefined;
      const result = await route.handler({
        req,
        res,
        params,
        query: url.searchParams,
        body,
        device,
        address,
        host: req.headers.host ?? '',
      });
      if (result === HANDLED) return;
      sendJson(res, result === undefined ? 204 : 200, result);
    } catch (error) {
      const code: AppErrorCode = error instanceof AppError ? error.code : 'INTERNAL';
      if (!(error instanceof AppError)) this.opts.log.error(`tv ${routeName} failed`, error);
      const status = STATUS[code] ?? (code.startsWith('TMDB_') || code.startsWith('SOURCE_') ? 503 : 500);
      if (res.headersSent) {
        res.destroy();
      } else {
        sendJson(res, status, { error: { code, requestId, retryable: status === 429 || status === 503 } });
      }
    } finally {
      // Route pattern only: URLs may carry media tickets.
      this.opts.log.debug(`${req.method} ${routeName} ${res.statusCode} ${Date.now() - started} ms`);
    }
  }
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    throw new AppError('BAD_REQUEST', 'bad path');
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  if (status === 204) {
    res.end();
    return;
  }
  const text = JSON.stringify(body);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', String(Buffer.byteLength(text)));
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const type = req.headers['content-type'] ?? '';
  const length = Number(req.headers['content-length'] ?? 0);
  if (length > MAX_BODY_BYTES) throw new AppError('BAD_REQUEST', 'body too large');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new AppError('BAD_REQUEST', 'body too large');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return undefined;
  if (!/^application\/json\b/i.test(type)) throw new AppError('BAD_REQUEST', 'json expected');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new AppError('BAD_REQUEST', 'invalid json');
  }
}
