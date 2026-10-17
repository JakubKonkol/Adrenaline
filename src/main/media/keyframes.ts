import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Logger } from '../logger';

/**
 * Keyframe times of the video of a file (ms from the start of the film), for HLS segments that begin exactly where a
 * stream copy can begin (Jellyfin reads the Matroska index for this). Read from the container index without
 * touching the media data: Matroska/WebM Cues, MP4/MOV sample tables (stss). Other containers, and files without an
 * index, are scanned with ffprobe (reads the whole file once, at most 30 s; cached on disk).
 */

// ---------------------------------------------------------------- file reading

class Reader {
  private fd: number;
  constructor(path: string) {
    this.fd = openSync(path, 'r');
  }
  read(position: number, length: number): Buffer {
    const buf = Buffer.alloc(length);
    const n = readSync(this.fd, buf, 0, length, position);
    return buf.subarray(0, n);
  }
  close() {
    closeSync(this.fd);
  }
}

// ---------------------------------------------------------------- Matroska

const EBML = {
  segment: 0x18538067,
  seekHead: 0x114d9b74,
  seek: 0x4dbb,
  seekId: 0x53ab,
  seekPosition: 0x53ac,
  info: 0x1549a966,
  timestampScale: 0x2ad7b1,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  trackType: 0x83,
  cues: 0x1c53bb6b,
  cuePoint: 0xbb,
  cueTime: 0xb3,
  cueTrackPositions: 0xb7,
  cueTrack: 0xf7,
  cluster: 0x1f43b675,
};

/** EBML variable-length number at `pos`: [value, length]; `id` keeps the marker bits. */
function vint(buf: Buffer, pos: number, id = false): [number, number] | null {
  const first = buf[pos];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || pos + length > buf.length) return null;
  let value = id ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const b = buf[pos + i]!;
    value = value * 256 + b;
    if (b !== 0xff) allOnes = false;
  }
  // Unknown size (all ones) is returned as -1.
  return [!id && allOnes ? -1 : value, length];
}

interface Element {
  id: number;
  dataStart: number;
  size: number;
}

/** Children of an element held in memory. */
function* children(buf: Buffer, start = 0, end = buf.length): Generator<Element> {
  let pos = start;
  while (pos < end) {
    const id = vint(buf, pos, true);
    if (!id) return;
    const size = vint(buf, pos + id[1]);
    if (!size) return;
    const dataStart = pos + id[1] + size[1];
    const len = size[0] < 0 ? end - dataStart : size[0];
    yield { id: id[0], dataStart, size: len };
    pos = dataStart + len;
  }
}

function uint(buf: Buffer, el: Element): number {
  let v = 0;
  for (let i = 0; i < el.size; i++) v = v * 256 + buf[el.dataStart + i]!;
  return v;
}

/** Reads one element (header + data) from the file at an absolute position. */
function readElement(r: Reader, pos: number, maxBytes: number): { el: Element; buf: Buffer } | null {
  const head = r.read(pos, 16);
  const id = vint(head, 0, true);
  if (!id) return null;
  const size = vint(head, id[1]);
  if (!size || size[0] < 0 || size[0] > maxBytes) return null;
  const headerLength = id[1] + size[1];
  const buf = r.read(pos + headerLength, size[0]);
  return { el: { id: id[0], dataStart: 0, size: buf.length }, buf };
}

function matroskaKeyframes(path: string): number[] | null {
  const r = new Reader(path);
  try {
    const head = r.read(0, 64);
    const ebml = vint(head, 0, true);
    if (!ebml || ebml[0] !== 0x1a45dfa3) return null;
    const ebmlSize = vint(head, ebml[1]);
    if (!ebmlSize) return null;
    let pos = ebml[1] + ebmlSize[1] + ebmlSize[0];
    const segHead = r.read(pos, 16);
    const seg = vint(segHead, 0, true);
    if (!seg || seg[0] !== EBML.segment) return null;
    const segSize = vint(segHead, seg[1]);
    if (!segSize) return null;
    const segmentStart = pos + seg[1] + segSize[1];

    // Top-level elements: SeekHead points at Cues (usually at the end); otherwise walk the top level by sizes.
    const positions = new Map<number, number>();
    pos = segmentStart;
    for (let i = 0; i < 100_000; i++) {
      const h = r.read(pos, 16);
      const id = vint(h, 0, true);
      const size = id ? vint(h, id[1]) : null;
      if (!id || !size) break;
      if (!positions.has(id[0])) positions.set(id[0], pos);
      if (id[0] === EBML.seekHead) {
        const sh = readElement(r, pos, 1 << 20);
        if (sh)
          for (const s of children(sh.buf))
            if (s.id === EBML.seek) {
              let target = 0;
              let at = -1;
              for (const c of children(sh.buf, s.dataStart, s.dataStart + s.size)) {
                if (c.id === EBML.seekId) target = uint(sh.buf, c);
                if (c.id === EBML.seekPosition) at = uint(sh.buf, c);
              }
              if (target && at >= 0 && !positions.has(target)) positions.set(target, segmentStart + at);
            }
      }
      if (positions.has(EBML.cues) && positions.has(EBML.info) && positions.has(EBML.tracks)) break;
      if (size[0] < 0) break; // a cluster of unknown size: no way to skip it
      pos += id[1] + size[1] + size[0];
    }
    const cuesAt = positions.get(EBML.cues);
    const infoAt = positions.get(EBML.info);
    const tracksAt = positions.get(EBML.tracks);
    if (cuesAt === undefined || infoAt === undefined || tracksAt === undefined) return null;

    let scale = 1_000_000;
    const info = readElement(r, infoAt, 1 << 20);
    if (info) for (const c of children(info.buf)) if (c.id === EBML.timestampScale) scale = uint(info.buf, c);

    let video: number | null = null;
    const tracks = readElement(r, tracksAt, 4 << 20);
    if (tracks)
      for (const t of children(tracks.buf))
        if (t.id === EBML.trackEntry) {
          let number = 0;
          let type = 0;
          for (const c of children(tracks.buf, t.dataStart, t.dataStart + t.size)) {
            if (c.id === EBML.trackNumber) number = uint(tracks.buf, c);
            if (c.id === EBML.trackType) type = uint(tracks.buf, c);
          }
          if (type === 1 && video === null) video = number;
        }
    if (video === null) return null;

    const cues = readElement(r, cuesAt, 256 << 20);
    if (!cues) return null;
    const times: number[] = [];
    for (const point of children(cues.buf)) {
      if (point.id !== EBML.cuePoint) continue;
      let time = -1;
      let forVideo = false;
      for (const c of children(cues.buf, point.dataStart, point.dataStart + point.size)) {
        if (c.id === EBML.cueTime) time = uint(cues.buf, c);
        if (c.id === EBML.cueTrackPositions)
          for (const p of children(cues.buf, c.dataStart, c.dataStart + c.size))
            if (p.id === EBML.cueTrack && uint(cues.buf, p) === video) forVideo = true;
      }
      if (time >= 0 && forVideo) times.push((time * scale) / 1e6);
    }
    return times.length > 1 ? times : null;
  } finally {
    r.close();
  }
}

// ---------------------------------------------------------------- MP4 / MOV

interface Box {
  type: string;
  start: number;
  size: number;
  dataStart: number;
}

function* boxes(buf: Buffer, start: number, end: number): Generator<Box> {
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) size = end - pos;
    if (size < header || pos + size > end) return;
    yield { type, start: pos, size, dataStart: pos + header };
    pos += size;
  }
}

function child(buf: Buffer, parent: Box, type: string): Box | null {
  for (const b of boxes(buf, parent.dataStart, parent.start + parent.size)) if (b.type === type) return b;
  return null;
}

function mp4Keyframes(path: string, fileSize: number): number[] | null {
  const r = new Reader(path);
  try {
    // Find moov among the top-level boxes (at the start or at the end of the file).
    let pos = 0;
    let moov: Buffer | null = null;
    while (pos + 8 <= fileSize) {
      const h = r.read(pos, 16);
      if (h.length < 8) break;
      let size = h.readUInt32BE(0);
      const type = h.toString('latin1', 4, 8);
      if (size === 1) size = Number(h.readBigUInt64BE(8));
      else if (size === 0) size = fileSize - pos;
      if (size < 8) break;
      if (type === 'moov') {
        if (size > 512 << 20) return null;
        moov = r.read(pos, size);
        break;
      }
      pos += size;
    }
    if (!moov) return null;
    const root: Box = { type: 'moov', start: 0, size: moov.length, dataStart: 8 };
    for (const trak of boxes(moov, root.dataStart, moov.length)) {
      if (trak.type !== 'trak') continue;
      const mdia = child(moov, trak, 'mdia');
      const hdlr = mdia && child(moov, mdia, 'hdlr');
      if (!mdia || !hdlr || moov.toString('latin1', hdlr.dataStart + 8, hdlr.dataStart + 12) !== 'vide') continue;
      const mdhd = child(moov, mdia, 'mdhd');
      const stbl = (() => {
        const minf = child(moov, mdia, 'minf');
        return minf && child(moov, minf, 'stbl');
      })();
      if (!mdhd || !stbl) return null;
      const v1 = moov[mdhd.dataStart] === 1;
      const timescale = moov.readUInt32BE(mdhd.dataStart + (v1 ? 20 : 12));
      if (!timescale) return null;
      const stts = child(moov, stbl, 'stts');
      if (!stts) return null; // fragmented MP4: samples live in the fragments
      const stss = child(moov, stbl, 'stss');
      const ctts = child(moov, stbl, 'ctts');
      // Edit list: where the presentation starts in the media timeline.
      let mediaStart = 0;
      const edts = child(moov, trak, 'edts');
      const elst = edts && child(moov, edts, 'elst');
      if (elst) {
        const ev1 = moov[elst.dataStart] === 1;
        const count = moov.readUInt32BE(elst.dataStart + 4);
        let p = elst.dataStart + 8;
        for (let i = 0; i < count; i++) {
          const mediaTime = ev1 ? Number(moov.readBigInt64BE(p + 8)) : moov.readInt32BE(p + 4);
          if (mediaTime >= 0) {
            mediaStart = mediaTime;
            break;
          }
          p += ev1 ? 20 : 12;
        }
      }
      const sync = new Set<number>();
      if (stss) {
        const n = moov.readUInt32BE(stss.dataStart + 4);
        for (let i = 0; i < n; i++) sync.add(moov.readUInt32BE(stss.dataStart + 8 + i * 4));
      }
      const offsets: [number, number][] = [];
      if (ctts) {
        const signed = moov[ctts.dataStart] === 1;
        const n = moov.readUInt32BE(ctts.dataStart + 4);
        for (let i = 0; i < n; i++) {
          const p = ctts.dataStart + 8 + i * 8;
          offsets.push([moov.readUInt32BE(p), signed ? moov.readInt32BE(p + 4) : moov.readUInt32BE(p + 4)]);
        }
      }
      const times: number[] = [];
      let dts = 0;
      let sample = 1;
      let ci = 0;
      let cLeft = offsets[0]?.[0] ?? 0;
      const n = moov.readUInt32BE(stts.dataStart + 4);
      for (let i = 0; i < n; i++) {
        const count = moov.readUInt32BE(stts.dataStart + 8 + i * 8);
        const delta = moov.readUInt32BE(stts.dataStart + 12 + i * 8);
        for (let k = 0; k < count; k++, sample++) {
          let offset = 0;
          if (offsets.length) {
            while (cLeft === 0 && ci < offsets.length - 1) cLeft = offsets[++ci]![0];
            offset = offsets[ci]?.[1] ?? 0;
            cLeft--;
          }
          if (!stss || sync.has(sample)) times.push(((dts + offset - mediaStart) * 1000) / timescale);
          dts += delta;
        }
      }
      return times.length > 1 ? times.sort((a, b) => a - b) : null;
    }
    return null;
  } finally {
    r.close();
  }
}

// ---------------------------------------------------------------- ffprobe (any container)

function probeKeyframes(ffprobe: string, path: string, timeoutMs: number): Promise<number[] | null> {
  return new Promise((resolve) => {
    const child = spawn(
      ffprobe,
      [
        ...['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags:format=start_time'],
        ...['-of', 'csv=p=0', '-i', path],
      ],
      { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const times: number[] = [];
    let start = 0;
    const timer = setTimeout(() => child.kill(), timeoutMs);
    createInterface({ input: child.stdout }).on('line', (line) => {
      const [t, flags] = line.split(',');
      if (flags === undefined) {
        // The format section: its start time.
        const s = Number(t);
        if (Number.isFinite(s)) start = s;
      } else if (flags.startsWith('K')) {
        const x = Number(t);
        if (Number.isFinite(x)) times.push(x);
      }
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || times.length < 2) resolve(null);
      else resolve(times.map((x) => (x - start) * 1000).sort((a, b) => a - b));
    });
  });
}

// ---------------------------------------------------------------- public

export interface KeyframeSource {
  path: string;
  container: string;
  sizeBytes: number;
  /** Cache key part: the file changed when it changed. */
  mtimeMs: number;
  itemId: string;
}

/** Keyframes with an on-disk cache (userData/keyframes). Null when none could be found. */
export class KeyframeIndex {
  private memory = new Map<string, number[] | null>();

  constructor(
    private readonly opts: {
      dir: string;
      ffprobe: string | null;
      log: Logger;
      scanTimeoutMs?: number;
    },
  ) {}

  async get(src: KeyframeSource): Promise<number[] | null> {
    const key = `${src.itemId.replace(/[^\w-]/g, '_')}-${src.sizeBytes}-${Math.round(src.mtimeMs)}`;
    if (this.memory.has(key)) return this.memory.get(key)!;
    const file = join(this.opts.dir, `${key}.json`);
    try {
      const cached = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      if (Array.isArray(cached) && cached.every((x) => typeof x === 'number')) {
        this.memory.set(key, cached);
        return cached;
      }
    } catch {
      /* not cached yet */
    }
    const started = Date.now();
    let times: number[] | null = null;
    try {
      if (src.container === 'mkv' || src.container === 'webm') times = matroskaKeyframes(src.path);
      else if (src.container === 'mp4' || src.container === 'mov') times = mp4Keyframes(src.path, src.sizeBytes);
    } catch (error) {
      this.opts.log.warn(`keyframe index of ${src.itemId} could not be read`, error);
    }
    if (!times && this.opts.ffprobe)
      times = await probeKeyframes(this.opts.ffprobe, src.path, this.opts.scanTimeoutMs ?? 30_000);
    this.opts.log.info(
      `keyframes of ${src.itemId}: ${times ? times.length : 'none'} in ${Date.now() - started} ms (${src.container})`,
    );
    this.memory.set(key, times);
    if (times) {
      try {
        mkdirSync(this.opts.dir, { recursive: true });
        writeFileSync(file, JSON.stringify(times.map((x) => Math.round(x * 1000) / 1000)));
      } catch {
        /* cache is optional */
      }
    }
    return times;
  }
}

export const forTests = { matroskaKeyframes, mp4Keyframes, probeKeyframes };

/**
 * Segment start times (ms) of the VOD playlist. A stream copy can only begin at a keyframe: each segment starts at the
 * first keyframe at least one segment length after the previous start (FFmpeg then cuts exactly there). An encode
 * places keyframes itself: equal segments.
 */
export function segmentStarts(durationMs: number, segmentMs: number, keyframes: number[] | null): number[] {
  if (!keyframes) {
    const count = Math.max(1, Math.ceil(durationMs / segmentMs));
    return Array.from({ length: count }, (_, i) => i * segmentMs);
  }
  const starts = [0];
  for (const k of keyframes) {
    if (k >= durationMs - 500) break;
    if (k >= starts[starts.length - 1]! + segmentMs) starts.push(k);
  }
  return starts;
}
