/** Magnet link parsing (BEP 9 / BEP 52): info hashes v1 (btih) and v2 (btmh), name, trackers. */
export interface MagnetInfo {
  infoHashV1: string | null;
  infoHashV2: string | null;
  name: string | null;
  trackers: string[];
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32ToHex(s: string): string | null {
  let bits = '';
  for (const c of s.toUpperCase()) {
    const v = BASE32.indexOf(c);
    if (v < 0) return null;
    bits += v.toString(2).padStart(5, '0');
  }
  let hex = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex.slice(0, 40);
}

/** Normalizes a v1 info hash given as 40 hex or 32 base32 characters; null when invalid. */
export function normalizeInfoHashV1(value: string): string | null {
  const v = value.trim();
  if (/^[0-9a-f]{40}$/i.test(v)) return v.toLowerCase();
  if (/^[A-Z2-7]{32}$/i.test(v)) return base32ToHex(v);
  return null;
}

export function parseMagnet(uri: string): MagnetInfo | null {
  if (!/^magnet:\?/i.test(uri)) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(uri.slice(uri.indexOf('?') + 1));
  } catch {
    return null;
  }
  let v1: string | null = null;
  let v2: string | null = null;
  for (const xt of params.getAll('xt')) {
    const btih = xt.match(/^urn:btih:(.+)$/i);
    if (btih) v1 = normalizeInfoHashV1(btih[1]!) ?? v1;
    const btmh = xt.match(/^urn:btmh:1220([0-9a-f]{64})$/i);
    if (btmh) v2 = btmh[1]!.toLowerCase();
  }
  if (!v1 && !v2) return null;
  return { infoHashV1: v1, infoHashV2: v2, name: params.get('dn'), trackers: params.getAll('tr') };
}
