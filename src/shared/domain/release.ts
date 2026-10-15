import { normalizeInfoHashV1, parseMagnet } from './magnet';

/** One result row from one source (Torznab item, normalized). Links stay in main; the renderer never sees them. */
export interface SourceHit {
  sourceId: string;
  sourceName: string;
  guid: string | null;
  title: string;
  size: number | null;
  publishedAt: number | null;
  seeders: number | null;
  peers: number | null;
  infoHash: string | null;
  magnet: string | null;
  link: string | null;
  imdbId: string | null;
  observedAt: number;
}

/** Releases merged across sources by info hash (FR04). */
export interface MergedRelease {
  id: string;
  name: string;
  size: number | null;
  infoHashV1: string | null;
  infoHashV2: string | null;
  magnet: string | null;
  hits: SourceHit[];
}

function hashes(hit: SourceHit): { v1: string | null; v2: string | null } {
  const m = hit.magnet ? parseMagnet(hit.magnet) : null;
  let v1 = m?.infoHashV1 ?? null;
  let v2 = m?.infoHashV2 ?? null;
  if (hit.infoHash) {
    const h = hit.infoHash.trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(h)) v2 ??= h;
    else v1 ??= normalizeInfoHashV1(h);
  }
  return { v1, v2 };
}

/** Best seeder count across sources: the maximum with its source and time, never a sum (BR08). */
export function bestSeeders(hits: SourceHit[]): { value: number; sourceName: string; observedAt: number } | null {
  let best: SourceHit | null = null;
  for (const h of hits) if (h.seeders !== null && (best === null || h.seeders > (best.seeders ?? -1))) best = h;
  return best && best.seeders !== null
    ? { value: best.seeders, sourceName: best.sourceName, observedAt: best.observedAt }
    : null;
}

/**
 * Merges hits with the same info hash (v1 or v2) into one release listing all sources. Hits without any hash are
 * never merged (they stay separate rows).
 */
export function dedupe(hits: SourceHit[]): MergedRelease[] {
  const byKey = new Map<string, MergedRelease>();
  const out: MergedRelease[] = [];
  let anonymous = 0;
  for (const hit of hits) {
    const { v1, v2 } = hashes(hit);
    const existing = (v1 && byKey.get(`v1:${v1}`)) || (v2 && byKey.get(`v2:${v2}`)) || null;
    if (existing) {
      if (!existing.hits.some((h) => h.sourceId === hit.sourceId && h.guid === hit.guid)) existing.hits.push(hit);
      existing.infoHashV1 ??= v1;
      existing.infoHashV2 ??= v2;
      existing.size ??= hit.size;
      existing.magnet ??= hit.magnet;
      if (v1) byKey.set(`v1:${v1}`, existing);
      if (v2) byKey.set(`v2:${v2}`, existing);
      continue;
    }
    const release: MergedRelease = {
      id: v1 ? `v1:${v1}` : v2 ? `v2:${v2}` : `nohash:${hit.sourceId}:${hit.guid ?? ''}:${anonymous++}`,
      name: hit.title,
      size: hit.size,
      infoHashV1: v1,
      infoHashV2: v2,
      magnet: hit.magnet,
      hits: [hit],
    };
    if (v1) byKey.set(`v1:${v1}`, release);
    if (v2) byKey.set(`v2:${v2}`, release);
    out.push(release);
  }
  // The displayed name comes from the source with most seeders.
  for (const r of out) {
    const best = [...r.hits].sort((a, b) => (b.seeders ?? -1) - (a.seeders ?? -1))[0];
    if (best) r.name = best.title;
  }
  return out;
}
