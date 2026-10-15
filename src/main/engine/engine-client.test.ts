import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@shared/errors';
import { nullLogger, type Logger } from '../logger';
import { EngineClient, type EngineTransport } from './engine-client';
import { EngineRequestError } from './error-map';

function manualTransport() {
  const written: string[] = [];
  let onLine: (line: string) => void = () => undefined;
  let onClose: () => void = () => undefined;
  const transport: EngineTransport = {
    write: (line) => void written.push(line),
    onLine: (l) => void (onLine = l),
    onClose: (l) => void (onClose = l),
  };
  return {
    transport,
    written,
    feed: (obj: unknown) => onLine(typeof obj === 'string' ? obj : JSON.stringify(obj)),
    close: () => onClose(),
    lastId: () => (JSON.parse(written.at(-1)!) as { id: string }).id,
  };
}

afterEach(() => vi.useRealTimers());

describe('EngineClient', () => {
  it('resolves validated results', async () => {
    const t = manualTransport();
    const c = new EngineClient({ transport: t.transport, log: nullLogger });
    const p = c.request('ping', {});
    t.feed({ v: 1, id: t.lastId(), ok: true, result: { now: 5 } });
    await expect(p).resolves.toEqual({ now: 5 });
    expect(JSON.parse(t.written[0]!)).toMatchObject({ v: 1, op: 'ping', args: {} });
  });

  it('retries a timed-out request with the same id, then fails with ENGINE_TIMEOUT', async () => {
    vi.useFakeTimers();
    const t = manualTransport();
    const c = new EngineClient({ transport: t.transport, log: nullLogger, timeoutMs: 100, retries: 1 });
    const p = c.request('pause', {}, 'job-1');
    const caught = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    expect(t.written).toHaveLength(2);
    expect(t.written[0]).toBe(t.written[1]);
    await vi.advanceTimersByTimeAsync(100);
    const error = await caught;
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('ENGINE_TIMEOUT');
  });

  it('accepts the answer to a retried request', async () => {
    vi.useFakeTimers();
    const t = manualTransport();
    const c = new EngineClient({ transport: t.transport, log: nullLogger, timeoutMs: 100, retries: 2 });
    const p = c.request('pause', {}, 'job-1');
    await vi.advanceTimersByTimeAsync(100);
    t.feed({ v: 1, id: t.lastId(), ok: true, result: { state: 'paused' } });
    await expect(p).resolves.toEqual({ state: 'paused' });
  });

  it('rejects engine errors with the engine code', async () => {
    const t = manualTransport();
    const c = new EngineClient({ transport: t.transport, log: nullLogger });
    const p = c.request('resume', {}, 'x');
    t.feed({ v: 1, id: t.lastId(), ok: false, error: { code: 'JOB_NOT_FOUND', message: 'unknown job' } });
    const error = await p.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EngineRequestError);
    expect((error as EngineRequestError).toAppError().code).toBe('JOB_NOT_FOUND');
  });

  it('logs and ignores invalid lines', async () => {
    const warnings: string[] = [];
    const log: Logger = { ...nullLogger, warn: (m) => void warnings.push(m), child: () => log };
    const t = manualTransport();
    const c = new EngineClient({ transport: t.transport, log });
    const p = c.request('ping', {});
    t.feed('not json {');
    t.feed({ v: 1, event: 'progress', seq: 1, data: { jobs: 'nope' } });
    t.feed({ v: 1, id: t.lastId(), ok: true, result: { now: 1 } });
    await expect(p).resolves.toEqual({ now: 1 });
    expect(warnings).toHaveLength(2);
  });

  it('reports seq gaps and resets on ready', () => {
    const t = manualTransport();
    const c = new EngineClient({ transport: t.transport, log: nullLogger });
    const gaps: unknown[] = [];
    c.on('gap', (g) => gaps.push(g));
    const resume = (seq: number) => ({ v: 1, event: 'resumeSaved', seq, data: { jobId: 'a' } });
    t.feed({ v: 1, event: 'ready', seq: 1, data: { engineVersion: '1', protocol: 1 } });
    t.feed(resume(2));
    t.feed(resume(4));
    t.feed({ v: 1, event: 'ready', seq: 1, data: { engineVersion: '1', protocol: 1 } });
    t.feed(resume(2));
    expect(gaps).toEqual([{ expected: 3, got: 4 }]);
  });

  it('rejects a different protocol version', async () => {
    const t = manualTransport();
    const c = new EngineClient({ transport: t.transport, log: nullLogger });
    const p = c.hello('0.1.0');
    t.feed({
      v: 1,
      id: t.lastId(),
      ok: true,
      result: { protocol: 2, engineVersion: 'x', libtorrent: 'y', features: [] },
    });
    await expect(p).rejects.toMatchObject({ code: 'ENGINE_PROTOCOL_MISMATCH' });
  });

  it('fails pending requests when the process exits', async () => {
    const t = manualTransport();
    const c = new EngineClient({ transport: t.transport, log: nullLogger });
    const p = c.request('snapshot', {});
    t.close();
    await expect(p).rejects.toMatchObject({ code: 'ENGINE_CRASHED' });
    await expect(c.request('ping', {})).rejects.toMatchObject({ code: 'ENGINE_UNAVAILABLE' });
  });
});
