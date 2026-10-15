import { XMLParser } from 'fast-xml-parser';
import { AppError } from '@shared/errors';
import { normalizeInfoHashV1 } from '@shared/domain/magnet';
import type { SourceHit } from '@shared/domain/release';
import type { SearchTarget } from '@shared/domain/search-target';
import { readBodyLimited } from '../http';

/** A Torznab endpoint: the built-in Jackett indexer or a user endpoint (Jackett/Prowlarr), D-52. */
export interface TorznabSource {
  id: string;
  name: string;
  /** Full API URL, e.g. http://127.0.0.1:9117/api/v2.0/indexers/yts/results/torznab/api */
  endpoint: string;
  apiKey: () => string | null;
}

export interface SearchMode {
  available: boolean;
  params: string[];
}

export interface TorznabCaps {
  search: SearchMode;
  movieSearch: SearchMode;
  tvSearch: SearchMode;
  categories: number[];
}

export interface TorznabOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const AUTH_ERROR_CODES = new Set(['100', '101', '102']);

// No entity expansion (XXE / billion laughs), attributes kept, values as strings.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  processEntities: false,
  htmlEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => ['item', 'torznab:attr', 'newznab:attr', 'category', 'subcat'].includes(name),
});

/** Only the five predefined XML entities and numeric references are decoded; nothing else is expanded. */
export function decodeXmlText(value: string): string {
  return value.replace(
    /&(amp|lt|gt|quot|apos);|&#(\d{1,7});|&#x([0-9a-f]{1,6});/gi,
    (m, named: string, dec: string, hex: string) => {
      if (named) return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[named.toLowerCase()] ?? m;
      const code = dec ? Number(dec) : parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    },
  );
}

type Node = Record<string, unknown>;
const obj = (v: unknown): Node => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Node) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
const text = (v: unknown): string | null => {
  if (typeof v === 'string') return decodeXmlText(v).trim() || null;
  if (typeof v === 'number') return String(v);
  const t = obj(v)['#text'];
  return typeof t === 'string' ? decodeXmlText(t).trim() || null : null;
};
const attr = (node: unknown, name: string): string | null => {
  const v = obj(node)[name];
  return typeof v === 'string' ? decodeXmlText(v) : null;
};
const num = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Only http(s) endpoints are accepted (no file:, no magnet: as an endpoint). */
export function isValidEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.username === '' && u.password === '';
  } catch {
    return false;
  }
}

/**
 * SSRF rule (etap 5.3): a link from results is fetched only from the source's own host, or is a magnet.
 */
export function isAllowedDownloadUrl(link: string, endpoint: string): boolean {
  if (/^magnet:\?/i.test(link)) return true;
  try {
    const l = new URL(link);
    const e = new URL(endpoint);
    return (l.protocol === 'http:' || l.protocol === 'https:') && l.host === e.host;
  } catch {
    return false;
  }
}

function parseDocument(body: Buffer): Node {
  const textBody = body.toString('utf8').replace(/^\uFEFF/, '');
  const head = textBody.slice(0, 512).trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
    throw new AppError('SOURCE_BAD_RESPONSE', 'html instead of xml');
  }
  // Torznab feeds never need a DTD; documents declaring one (XXE, entity bombs) are rejected outright.
  if (/<!DOCTYPE|<!ENTITY/i.test(textBody)) throw new AppError('SOURCE_BAD_RESPONSE', 'dtd not allowed');
  let doc: Node;
  try {
    doc = obj(parser.parse(textBody, true));
  } catch {
    throw new AppError('SOURCE_BAD_RESPONSE', 'invalid xml');
  }
  const error = doc['error'];
  if (error !== undefined) {
    const code = attr(error, 'code') ?? '';
    throw new AppError(AUTH_ERROR_CODES.has(code) ? 'SOURCE_AUTH' : 'SOURCE_BAD_RESPONSE', `torznab error ${code}`);
  }
  return doc;
}

function mode(node: unknown): SearchMode {
  const n = obj(node);
  const params = (attr(n, 'supportedParams') ?? '')
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  return { available: n['available'] === 'yes', params };
}

export function parseCaps(body: Buffer): TorznabCaps {
  const caps = obj(parseDocument(body)['caps']);
  if (Object.keys(caps).length === 0) throw new AppError('SOURCE_BAD_RESPONSE', 'no caps');
  const searching = obj(caps['searching']);
  const categories: number[] = [];
  for (const c of arr(obj(caps['categories'])['category'])) {
    const id = num(attr(c, 'id'));
    if (id !== null) categories.push(id);
    for (const s of arr(obj(c)['subcat'])) {
      const sid = num(attr(s, 'id'));
      if (sid !== null) categories.push(sid);
    }
  }
  return {
    search: mode(searching['search']),
    movieSearch: mode(searching['movie-search']),
    tvSearch: mode(searching['tv-search']),
    categories,
  };
}

export function parseResults(body: Buffer, source: { id: string; name: string }, observedAt: number): SourceHit[] {
  const rss = obj(parseDocument(body)['rss']);
  if (Object.keys(rss).length === 0) throw new AppError('SOURCE_BAD_RESPONSE', 'no rss');
  const items = arr(obj(rss['channel'])['item']);
  const hits: SourceHit[] = [];
  for (const raw of items) {
    const item = obj(raw);
    const title = text(item['title']);
    if (!title) continue;
    const attrs = new Map<string, string>();
    for (const a of [...arr(item['torznab:attr']), ...arr(item['newznab:attr'])]) {
      const name = (attr(a, 'name') ?? '').toLowerCase();
      const value = attr(a, 'value') ?? '';
      if (name && !attrs.has(name)) attrs.set(name, value);
    }
    const enclosure = obj(item['enclosure']);
    const linkText = text(item['link']);
    const enclosureUrl = attr(enclosure, 'url');
    const magnetAttr = attrs.get('magneturl') ?? null;
    const magnet =
      (magnetAttr && /^magnet:\?/i.test(magnetAttr) ? magnetAttr : null) ??
      [linkText, enclosureUrl].find((l) => l && /^magnet:\?/i.test(l)) ??
      null;
    const link = [enclosureUrl, linkText].find((l) => l && /^https?:/i.test(l)) ?? null;
    const pub = text(item['pubDate']);
    const published = pub ? Date.parse(pub) : NaN;
    const infoHash = attrs.get('infohash')?.trim().toLowerCase() || null;
    const imdb = attrs.get('imdbid') ?? attrs.get('imdb') ?? null;
    hits.push({
      sourceId: source.id,
      sourceName: source.name,
      guid: text(item['guid']),
      title,
      size: num(text(item['size'])) ?? num(attrs.get('size')) ?? num(attr(enclosure, 'length')),
      publishedAt: Number.isFinite(published) ? published : null,
      seeders: num(attrs.get('seeders')),
      peers: num(attrs.get('peers')),
      infoHash: infoHash && (normalizeInfoHashV1(infoHash) ?? (/^[0-9a-f]{64}$/.test(infoHash) ? infoHash : null)),
      magnet,
      link,
      imdbId: imdb ? (imdb.startsWith('tt') ? imdb : `tt${imdb.padStart(7, '0')}`) : null,
      observedAt,
    });
  }
  return hits;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Queries for a target according to the source's caps (etap 5.3): t=movie with imdbid or t=tvsearch with
 * season/ep when supported, otherwise t=search with title + year / SxxEyy. One more query with the other title
 * when the Polish and original titles differ.
 */
export function buildQueries(target: SearchTarget, caps: TorznabCaps): Record<string, string>[] {
  const queries: Record<string, string>[] = [];
  const titles = [target.originalTitle, target.title].filter((t, i, all) => t.trim() && all.indexOf(t) === i);
  if (target.kind === 'movie') {
    const year = target.year ? ` ${target.year}` : '';
    if (caps.movieSearch.available && caps.movieSearch.params.includes('imdbid') && target.imdbId) {
      queries.push({ t: 'movie', imdbid: target.imdbId });
      for (const t of titles.slice(1)) queries.push({ t: 'search', q: `${t}${year}`, cat: '2000' });
    } else {
      for (const t of titles) queries.push({ t: 'search', q: `${t}${year}`, cat: '2000' });
    }
  } else {
    const se = `S${pad(target.season)}E${pad(target.episode)}`;
    const tv = caps.tvSearch;
    for (const t of titles) {
      if (tv.available && tv.params.includes('season') && tv.params.includes('ep') && tv.params.includes('q')) {
        queries.push({ t: 'tvsearch', q: t, season: String(target.season), ep: String(target.episode) });
      } else {
        queries.push({ t: 'search', q: `${t} ${se}`, cat: '5000' });
      }
    }
  }
  return queries;
}

/** Thin Torznab client: no retries here (the search service schedules, times out and backs off, D-55). */
export class TorznabClient {
  constructor(private readonly options: TorznabOptions = {}) {}

  private async get(source: TorznabSource, params: Record<string, string>, signal?: AbortSignal): Promise<Buffer> {
    if (!isValidEndpoint(source.endpoint)) throw new AppError('SOURCE_BAD_RESPONSE', 'invalid endpoint');
    const url = new URL(source.endpoint);
    const key = source.apiKey();
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (key) url.searchParams.set('apikey', key);
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 12_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(url, {
        headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
        signal: combined,
        redirect: 'error',
      });
    } catch (error) {
      if (timeout.aborted) throw new AppError('SOURCE_TIMEOUT');
      if (signal?.aborted) throw error;
      throw new AppError('SOURCE_UNAVAILABLE');
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new AppError('SOURCE_AUTH');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError('SOURCE_UNAVAILABLE', `HTTP ${response.status}`, {
        retryAfter: response.headers.get('Retry-After'),
      });
    }
    let body: Buffer | null;
    try {
      body = await readBodyLimited(response, MAX_RESPONSE_BYTES);
    } catch {
      if (timeout.aborted) throw new AppError('SOURCE_TIMEOUT');
      throw new AppError('SOURCE_UNAVAILABLE');
    }
    if (!body) throw new AppError('SOURCE_BAD_RESPONSE', 'response too large');
    return body;
  }

  async caps(source: TorznabSource, signal?: AbortSignal): Promise<TorznabCaps> {
    return parseCaps(await this.get(source, { t: 'caps' }, signal));
  }

  async search(source: TorznabSource, params: Record<string, string>, signal?: AbortSignal): Promise<SourceHit[]> {
    const body = await this.get(source, params, signal);
    return parseResults(body, source, (this.options.now ?? Date.now)());
  }
}
