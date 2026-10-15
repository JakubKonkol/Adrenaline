import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { redact } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, extra?: unknown): void;
  info(message: string, extra?: unknown): void;
  warn(message: string, extra?: unknown): void;
  error(message: string, extra?: unknown): void;
  child(scope: string): Logger;
}

export interface FileLoggerOptions {
  dir: string;
  homeDir?: string;
  maxBytes?: number;
  maxFiles?: number;
  /** Also mirror to stderr (dev). */
  mirror?: boolean;
  now?: () => Date;
}

export const LOG_FILE = 'adrenaline.log';

function formatExtra(extra: unknown): string {
  if (extra === undefined) return '';
  if (extra instanceof Error) return ` ${extra.name}: ${extra.message}${extra.stack ? `\n${extra.stack}` : ''}`;
  try {
    return ` ${JSON.stringify(extra)}`;
  } catch {
    return ' [unserializable]';
  }
}

/**
 * Rotated file logger (D-23): `<dir>/adrenaline.log`, rotated to `.1`…`.4` at 5 MB. Writes are queued and async;
 * every line passes through `redact` (tokens, magnets, keys, user paths).
 */
export function createFileLogger(opts: FileLoggerOptions): Logger & { flush(): Promise<void> } {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const maxFiles = opts.maxFiles ?? 5;
  const now = opts.now ?? (() => new Date());
  const path = join(opts.dir, LOG_FILE);
  let queue: Promise<void> = mkdir(opts.dir, { recursive: true }).then(() => undefined);
  let size = -1;

  async function rotate(): Promise<void> {
    await rm(`${path}.${maxFiles - 1}`, { force: true });
    for (let i = maxFiles - 2; i >= 1; i--) {
      await rename(`${path}.${i}`, `${path}.${i + 1}`).catch(() => undefined);
    }
    await rename(path, `${path}.1`).catch(() => undefined);
    size = 0;
  }

  async function write(line: string): Promise<void> {
    if (size < 0)
      size = await stat(path).then(
        (s) => s.size,
        () => 0,
      );
    const bytes = Buffer.byteLength(line);
    if (size > 0 && size + bytes > maxBytes) await rotate();
    await appendFile(path, line, 'utf8');
    size += bytes;
  }

  function make(scope: string | null): Logger {
    const log = (level: LogLevel, message: string, extra?: unknown) => {
      const text = redact(`${message}${formatExtra(extra)}`, { homeDir: opts.homeDir });
      const line = `${now().toISOString()} ${level.toUpperCase().padEnd(5)} ${scope ? `[${scope}] ` : ''}${text}\n`;
      if (opts.mirror) process.stderr.write(line);
      queue = queue.then(() => write(line)).catch(() => undefined);
    };
    return {
      debug: (m, e) => log('debug', m, e),
      info: (m, e) => log('info', m, e),
      warn: (m, e) => log('warn', m, e),
      error: (m, e) => log('error', m, e),
      child: (s) => make(scope ? `${scope}:${s}` : s),
    };
  }

  return Object.assign(make(null), { flush: () => queue });
}

/** Logger that drops everything (tests). */
export const nullLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => nullLogger,
};
