import { open } from 'node:fs/promises';

const CHUNK = 64 * 1024;
const MASK = (1n << 64n) - 1n;

/**
 * OpenSubtitles moviehash (etap 7.2): file size + sum of the 64-bit little-endian words of the first and the last
 * 64 KiB, modulo 2^64, as 16 hex characters. Reads only 2 × 64 KiB. Files under 128 KiB have no hash.
 */
export async function movieHash(path: string): Promise<string | null> {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    if (size < 2 * CHUNK) return null;
    let hash = BigInt(size);
    const buf = Buffer.alloc(CHUNK);
    for (const position of [0, size - CHUNK]) {
      const { bytesRead } = await fh.read(buf, 0, CHUNK, position);
      if (bytesRead !== CHUNK) return null;
      for (let i = 0; i < CHUNK; i += 8) hash = (hash + buf.readBigUInt64LE(i)) & MASK;
    }
    return hash.toString(16).padStart(16, '0');
  } finally {
    await fh.close();
  }
}
