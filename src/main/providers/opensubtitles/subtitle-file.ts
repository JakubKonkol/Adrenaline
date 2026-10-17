import { crc32, gunzipSync, inflateRawSync } from 'node:zlib';
import { extname } from 'node:path';
import { AppError } from '@shared/errors';
import { resolveInside } from '../../fs/safe-path';

export const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;
const EXTENSIONS = new Set(['.srt', '.ass', '.ssa', '.vtt', '.sub', '.txt']);
function bad(): never {
  throw new AppError('SUBS_BAD_FILE');
}

/** Bounded in-memory extraction: archive names never become filesystem paths. No nested archives. */
function unzip(data: Buffer): { data: Buffer; name: string } {
  let end = data.length - 22;
  for (; end >= Math.max(0, data.length - 65557); end--) {
    if (data.readUInt32LE(end) === 0x06054b50 && end + 22 + data.readUInt16LE(end + 20) === data.length) break;
  }
  if (end < 0 || data.readUInt16LE(end + 4) !== 0 || data.readUInt16LE(end + 6) !== 0) return bad();
  const count = data.readUInt16LE(end + 10);
  if (count < 1 || count > 100 || data.readUInt16LE(end + 8) !== count) return bad();
  let offset = data.readUInt32LE(end + 16);
  if (offset + data.readUInt32LE(end + 12) !== end) return bad();
  let total = 0;
  const files: { data: Buffer; name: string }[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || data.readUInt32LE(offset) !== 0x02014b50) return bad();
    const flags = data.readUInt16LE(offset + 8),
      method = data.readUInt16LE(offset + 10);
    const compressed = data.readUInt32LE(offset + 20),
      size = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28),
      extra = data.readUInt16LE(offset + 30),
      comment = data.readUInt16LE(offset + 32);
    const local = data.readUInt32LE(offset + 42);
    if (offset + 46 + nameLength + extra + comment > end || flags & 1 || ![0, 8].includes(method)) return bad();
    const name = data.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const mode = data.readUInt32LE(offset + 38) >>> 16;
    if ((mode & 0xf000) === 0xa000 || data.readUInt16LE(offset + 34) !== 0) return bad();
    resolveInside('/archive', name.replace(/\/$/, ''));
    total += size;
    if (
      total > MAX_SUBTITLE_BYTES ||
      compressed > MAX_SUBTITLE_BYTES ||
      local + 30 > data.length ||
      data.readUInt32LE(local) !== 0x04034b50
    )
      return bad();
    const localNameLength = data.readUInt16LE(local + 26);
    const start = local + 30 + localNameLength + data.readUInt16LE(local + 28);
    if (
      start + compressed > data.length ||
      data.subarray(local + 30, local + 30 + localNameLength).toString('utf8') !== name ||
      data.readUInt16LE(local + 8) !== method
    )
      return bad();
    if (!name.endsWith('/')) {
      // Reject executable payloads rather than unpacking unrelated entries.
      if (!EXTENSIONS.has(extname(name).toLowerCase())) return bad();
      const payload = data.subarray(start, start + compressed);
      const plain = method === 0 ? payload : inflateRawSync(payload, { maxOutputLength: MAX_SUBTITLE_BYTES });
      if (plain.length !== size || crc32(plain) !== data.readUInt32LE(offset + 16)) return bad();
      files.push({ data: plain, name });
    }
    offset += 46 + nameLength + extra + comment;
  }
  if (offset !== end || files.length !== 1) return bad();
  return files[0]!;
}

/** OpenSubtitles promises UTF-8; tolerate legacy Polish uploads without accepting binary/HTML responses. */
export function validateSubtitle(
  input: Buffer,
  name: string,
  language: string,
  frameRate?: number,
): { text: string; extension: string } {
  try {
    if (!input.length || input.length > MAX_SUBTITLE_BYTES) return bad();
    let data = input;
    if (input[0] === 0x50 && input[1] === 0x4b) ({ data, name } = unzip(input));
    else if (input[0] === 0x1f && input[1] === 0x8b) {
      data = gunzipSync(input, { maxOutputLength: MAX_SUBTITLE_BYTES });
      name = name.replace(/\.gz$/i, '');
    }
    let extension = extname(name).toLowerCase();
    if (!EXTENSIONS.has(extension) || data.length > MAX_SUBTITLE_BYTES) return bad();
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      if (language !== 'pl') return bad();
      // Polish ISO-8859-2 uses A1/B1/B6/BC for letters; CP1250 uses these as punctuation/controls.
      const iso = data.some((b) => [0xa1, 0xb1, 0xb6, 0xbc].includes(b));
      text = new TextDecoder(iso ? 'iso-8859-2' : 'windows-1250', { fatal: true }).decode(data);
    }
    text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(text) || /<!doctype|<html|<script/i.test(text))
      return bad();
    if (extension === '.txt') {
      if (/^\{\d+\}\{\d+\}/m.test(text)) extension = '.sub';
      else if (/\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->/.test(text)) extension = '.srt';
      else {
        const rows = [...text.matchAll(/^(\d{1,2}):(\d{2}):(\d{2}):(.*)$/gm)];
        if (!rows.length) return bad();
        text = rows
          .map((r, i) => {
            const start = (Number(r[1]) * 3600 + Number(r[2]) * 60 + Number(r[3])) * 1000;
            const next = rows[i + 1];
            const end = next ? (Number(next[1]) * 3600 + Number(next[2]) * 60 + Number(next[3])) * 1000 : start + 4000;
            if (end <= start) return bad();
            return `${i + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${r[4]!.replace(/\|/g, '\n')}\n`;
          })
          .join('\n');
        extension = '.srt';
      }
    }
    if (extension === '.sub' && frameRate && frameRate >= 1 && frameRate <= 240) {
      const rows = [...text.matchAll(/^\{(\d+)\}\{(\d+)\}(.*)$/gm)].filter((r) => Number(r[2]) > Number(r[1]));
      if (!rows.length) return bad();
      text = rows
        .map(
          (r, i) =>
            `${i + 1}\n${srtTime((Number(r[1]) * 1000) / frameRate)} --> ${srtTime((Number(r[2]) * 1000) / frameRate)}\n${r[3]!.replace(/\{[^}]*\}/g, '').replace(/\|/g, '\n')}\n`,
        )
        .join('\n');
      extension = '.srt';
    }
    const stamp =
      extension === '.ass' || extension === '.ssa'
        ? /^Dialogue:\s*[^,]*,\d+:\d{2}:\d{2}\.\d{2},\d+:\d{2}:\d{2}\.\d{2},/m
        : extension === '.sub'
          ? /^\{\d+\}\{\d+\}.+/m
          : /(?:\d{2}:)?\d{2}:\d{2}[,.]\d{3}\s+-->\s+(?:\d{2}:)?\d{2}:\d{2}[,.]\d{3}/;
    if (!stamp.test(text)) return bad();
    return { text, extension };
  } catch {
    return bad();
  }
}

function srtTime(ms: number): string {
  const value = Math.max(0, Math.round(ms));
  return `${String(Math.floor(value / 3600000)).padStart(2, '0')}:${String(Math.floor(value / 60000) % 60).padStart(2, '0')}:${String(Math.floor(value / 1000) % 60).padStart(2, '0')},${String(value % 1000).padStart(3, '0')}`;
}
