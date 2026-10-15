import {
  ENGINE_PROTOCOL_VERSION,
  type EngineArgs,
  type EngineEvent,
  type EngineOp,
  type EngineResult,
  engineEventSchema,
  engineResponseSchema,
  engineResultSchemas,
} from '@shared/contracts/engine';
import { AppError } from '@shared/errors';
import type { Logger } from '../logger';
import { redact } from '../redact';
import { Emitter } from '../util/emitter';
import { EngineRequestError } from './error-map';

/** Line-based duplex channel to one engine process (child stdio or the in-process FakeEngine). */
export interface EngineTransport {
  write(line: string): void;
  onLine(listener: (line: string) => void): void;
  onClose(listener: () => void): void;
}

export interface EngineClientOptions {
  transport: EngineTransport;
  log: Logger;
  /** Per-attempt timeout; on timeout the same request (same id) is sent again (10 s, 02-protokol-silnika.md). */
  timeoutMs?: number;
  retries?: number;
}

export interface RequestOptions {
  timeoutMs?: number;
  retries?: number;
}

interface Pending {
  op: EngineOp;
  line: string;
  attempts: number;
  timeoutMs: number;
  retries: number;
  timer: NodeJS.Timeout;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export type EngineClientEvents = {
  event: EngineEvent;
  /** A gap in `seq` (lost events): the consumer should call `snapshot`. */
  gap: { expected: number; got: number };
  closed: undefined;
};

/**
 * Request/response client of the engine protocol: ids, timeouts with retries (idempotent on the engine side), Zod
 * validation of every line, `seq` gap detection. Invalid lines are logged and ignored.
 */
export class EngineClient extends Emitter<EngineClientEvents> {
  private nextId = 1;
  private pending = new Map<string, Pending>();
  private lastSeq = 0;
  private closed = false;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(private readonly opts: EngineClientOptions) {
    super();
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.retries = opts.retries ?? 2;
    opts.transport.onLine((line) => this.handleLine(line));
    opts.transport.onClose(() => this.handleClose());
  }

  get isClosed(): boolean {
    return this.closed;
  }

  request<O extends EngineOp>(
    op: O,
    args: EngineArgs[O],
    jobId?: string,
    options: RequestOptions = {},
  ): Promise<EngineResult<O>> {
    if (this.closed) return Promise.reject(new AppError('ENGINE_UNAVAILABLE', 'engine not running'));
    const id = `r-${this.nextId++}`;
    const line = JSON.stringify({ v: ENGINE_PROTOCOL_VERSION, id, op, ...(jobId ? { jobId } : {}), args });
    return new Promise<EngineResult<O>>((resolve, reject) => {
      const timeoutMs = options.timeoutMs ?? this.timeoutMs;
      const pending: Pending = {
        op,
        line,
        attempts: 1,
        timeoutMs,
        retries: options.retries ?? this.retries,
        timer: this.armTimer(id, timeoutMs),
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      this.pending.set(id, pending);
      this.opts.transport.write(line);
    });
  }

  /** `hello` + protocol check; throws ENGINE_PROTOCOL_MISMATCH for another protocol version. */
  async hello(clientVersion: string): Promise<EngineResult<'hello'>> {
    const result = await this.request('hello', { clientVersion });
    if (result.protocol !== ENGINE_PROTOCOL_VERSION) {
      throw new AppError('ENGINE_PROTOCOL_MISMATCH', `engine protocol ${result.protocol}`);
    }
    return result;
  }

  private armTimer(id: string, ms: number): NodeJS.Timeout {
    return setTimeout(() => this.onTimeout(id), ms);
  }

  private onTimeout(id: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    if (p.attempts > p.retries) {
      this.pending.delete(id);
      p.reject(new AppError('ENGINE_TIMEOUT', `engine did not answer ${p.op}`));
      return;
    }
    p.attempts += 1;
    p.timer = this.armTimer(id, p.timeoutMs);
    this.opts.log.warn(`engine ${p.op} timed out, retrying (${p.attempts})`);
    this.opts.transport.write(p.line);
  }

  private handleLine(line: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      this.opts.log.warn(`engine sent invalid JSON: ${redact(line.slice(0, 200))}`);
      return;
    }
    if (typeof raw === 'object' && raw !== null && 'event' in raw) {
      const parsed = engineEventSchema.safeParse(raw);
      if (!parsed.success) {
        this.opts.log.warn(`engine sent an invalid event: ${redact(line.slice(0, 200))}`);
        return;
      }
      const event = parsed.data;
      if (event.event === 'ready') this.lastSeq = 0;
      if (this.lastSeq > 0 && event.seq !== this.lastSeq + 1) {
        this.emit('gap', { expected: this.lastSeq + 1, got: event.seq });
      }
      this.lastSeq = event.seq;
      this.emit('event', event);
      return;
    }
    const parsed = engineResponseSchema.safeParse(raw);
    if (!parsed.success) {
      this.opts.log.warn(`engine sent an invalid response: ${redact(line.slice(0, 200))}`);
      return;
    }
    const response = parsed.data;
    const p = this.pending.get(response.id);
    if (!p) return; // late duplicate of a retried request
    clearTimeout(p.timer);
    this.pending.delete(response.id);
    if (!response.ok) {
      p.reject(new EngineRequestError(response.error.code, response.error.message));
      return;
    }
    const result = engineResultSchemas[p.op].safeParse(response.result);
    if (!result.success) {
      p.reject(new AppError('ENGINE_PROTOCOL_MISMATCH', `invalid ${p.op} result`));
      return;
    }
    p.resolve(result.data);
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new AppError('ENGINE_CRASHED', 'engine process exited'));
    }
    this.pending.clear();
    this.emit('closed', undefined);
  }
}
