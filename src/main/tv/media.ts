import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname } from 'node:path';
import { pipeline } from 'node:stream/promises';

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.ts': 'video/mp2t',
  '.wmv': 'video/x-ms-wmv',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
};

export function videoMime(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------- tickets

export interface Ticket {
  deviceId: string;
  itemId: string;
  expiresAt: number;
}

/** Long enough for a film paused overnight is not needed: every request extends the ticket. */
const TICKET_TTL_MS = 6 * 60 * 60_000;
const MAX_TICKETS = 200;

/**
 * Media tickets (D-83): short random ids that stand for "this device may read this library item". Players get them in
 * the URL (no custom headers needed); they are separate from the API token, live in memory only and die with the
 * device (revoke) or the app.
 */
export class TicketStore {
  private tickets = new Map<string, Ticket>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(deviceId: string, itemId: string): string {
    this.sweep();
    if (this.tickets.size >= MAX_TICKETS) {
      const oldest = [...this.tickets.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
      if (oldest) this.tickets.delete(oldest[0]);
    }
    const id = randomBytes(24).toString('base64url');
    this.tickets.set(id, { deviceId, itemId, expiresAt: this.now() + TICKET_TTL_MS });
    return id;
  }

  /** Valid ticket, extended on use (a long film never runs out while it plays). */
  use(id: string): Ticket | null {
    const t = this.tickets.get(id);
    if (!t) return null;
    if (t.expiresAt < this.now()) {
      this.tickets.delete(id);
      return null;
    }
    t.expiresAt = this.now() + TICKET_TTL_MS;
    return t;
  }

  revokeDevice(deviceId: string): void {
    for (const [id, t] of this.tickets) if (t.deviceId === deviceId) this.tickets.delete(id);
  }

  clear(): void {
    this.tickets.clear();
  }

  private sweep() {
    const now = this.now();
    for (const [id, t] of this.tickets) if (t.expiresAt < now) this.tickets.delete(id);
  }
}

// ---------------------------------------------------------------- byte ranges

export type RangeResult = { kind: 'full' } | { kind: 'partial'; start: number; end: number } | { kind: 'invalid' };

/**
 * `Range: bytes=...` (RFC 9110). One range is served; several ranges are answered with the first one, which players
 * accept. Unsatisfiable or malformed ranges give 416.
 */
export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return { kind: 'full' };
  const m = /^bytes=\s*(\d*)\s*-\s*(\d*)\s*(,.*)?$/i.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return { kind: 'invalid' };
  let start: number;
  let end: number;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return { kind: 'invalid' };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end)
    return { kind: 'invalid' };
  return { kind: 'partial', start, end };
}

/** Streams a file with Range/HEAD support and backpressure; nothing is buffered in memory. */
export async function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  file: { path: string; size: number; mtimeMs: number; mime: string },
): Promise<void> {
  const range = parseRange(req.headers.range, file.size);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Last-Modified', new Date(file.mtimeMs).toUTCString());
  if (range.kind === 'invalid') {
    res.statusCode = 416;
    res.setHeader('Content-Range', `bytes */${file.size}`);
    res.end();
    return;
  }
  const start = range.kind === 'partial' ? range.start : 0;
  const end = range.kind === 'partial' ? range.end : file.size - 1;
  res.statusCode = range.kind === 'partial' ? 206 : 200;
  if (range.kind === 'partial') res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
  res.setHeader('Content-Length', String(file.size === 0 ? 0 : end - start + 1));
  if (req.method === 'HEAD' || file.size === 0) {
    res.end();
    return;
  }
  try {
    await pipeline(createReadStream(file.path, { start, end, highWaterMark: 256 * 1024 }), res);
  } catch {
    // The player closed the connection (seek, stop): normal for video, nothing to report.
    res.destroy();
  }
}

// ---------------------------------------------------------------- subtitles

const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;

/** SRT → WebVTT: header, `,` → `.` in timestamps, no HTML is added (players render cues as text). */
export function srtToVtt(srt: string): string {
  const body = (srt.charCodeAt(0) === 0xfeff ? srt.slice(1) : srt)
    .replace(/\r\n?/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    .trim();
  return `WEBVTT\n\n${body}\n`;
}

export async function readSubtitleAsVtt(path: string): Promise<string | null> {
  const ext = extname(path).toLowerCase();
  if (ext !== '.srt' && ext !== '.vtt') return null;
  const buf = await readFile(path);
  if (buf.length > MAX_SUBTITLE_BYTES) return null;
  const text = buf.toString('utf8');
  return ext === '.vtt' ? text : srtToVtt(text);
}
