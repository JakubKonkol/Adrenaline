/**
 * Parses a raw release name into comparable attributes (FR05, BR01). Missing information is `null`, never a guess.
 */
export type Resolution = '480p' | '576p' | '720p' | '1080p' | '2160p';
export type VideoSource = 'Remux' | 'BluRay' | 'WEB-DL' | 'WEBRip' | 'HDTV' | 'DVDRip' | 'CAM' | 'TS';
export type VideoCodec = 'x264' | 'x265/HEVC' | 'AV1';
export type Hdr = 'HDR' | 'HDR10+' | 'DV';

export interface ParsedRelease {
  title: string;
  year: number | null;
  resolution: Resolution | null;
  source: VideoSource | null;
  codec: VideoCodec | null;
  hdr: Hdr | null;
  audio: string[];
  languages: string[];
  edition: string | null;
  group: string | null;
  season: number | null;
  episode: number | null;
  isSeasonPack: boolean;
}

const first = <T>(text: string, rules: [RegExp, T][]): T | null => {
  for (const [re, value] of rules) if (re.test(text)) return value;
  return null;
};

const RESOLUTION: [RegExp, Resolution][] = [
  [/\b(2160p|4k|uhd)\b/i, '2160p'],
  [/\b1080[pi]\b/i, '1080p'],
  [/\b720p\b/i, '720p'],
  [/\b576[pi]\b/i, '576p'],
  [/\b480p\b/i, '480p'],
];

const SOURCE: [RegExp, VideoSource][] = [
  [/\bremux\b/i, 'Remux'],
  [/\b(blu-?ray|bdrip|brrip|bdremux|bd25|bd50)\b/i, 'BluRay'],
  [/\bweb-?dl\b|\bweb\b(?!-?rip)/i, 'WEB-DL'],
  [/\bweb-?rip\b/i, 'WEBRip'],
  [/\b(hdtv|pdtv)\b/i, 'HDTV'],
  [/\b(dvd-?rip|dvdr|dvd5|dvd9|dvd)\b/i, 'DVDRip'],
  [/\b(cam|camrip|hdcam)\b/i, 'CAM'],
  [/\b(ts|telesync|hdts|tc|telecine)\b/i, 'TS'],
];

const CODEC: [RegExp, VideoCodec][] = [
  [/\b(x265|h[\s.]?265|hevc)\b/i, 'x265/HEVC'],
  [/\bav1\b/i, 'AV1'],
  [/\b(x264|h[\s.]?264|avc)\b/i, 'x264'],
];

const HDR_RULES: [RegExp, Hdr][] = [
  [/\b(dv|dovi|dolby\s?vision)\b/i, 'DV'],
  [/\bhdr10(\+|plus)/i, 'HDR10+'],
  [/\bhdr(10)?\b/i, 'HDR'],
];

const AUDIO: [RegExp, string][] = [
  [/\batmos\b/i, 'Atmos'],
  [/\btrue-?hd\b/i, 'TrueHD'],
  [/\bdts-?hd(\s?ma)?\b/i, 'DTS-HD MA'],
  [/\bdts(?!-?hd)\b/i, 'DTS'],
  [/\b(ddp|dd\+|e-?ac-?3)(?=[\s\d]|$)/i, 'DDP'],
  [/\b(dd|ac-?3)(?=[\s\d]|$)/i, 'DD'],
  [/\baac(?=[\s\d]|$)/i, 'AAC'],
  [/\bflac\b/i, 'FLAC'],
];

const EDITION: [RegExp, string][] = [
  [/\bdirector'?s\s?cut\b/i, "Director's Cut"],
  [/\bextended(\s(cut|edition))?\b/i, 'Extended'],
  [/\bunrated\b/i, 'Unrated'],
  [/\bremastered\b/i, 'Remastered'],
  [/\btheatrical\b/i, 'Theatrical'],
  [/\bimax\b/i, 'IMAX'],
  [/\bcriterion\b/i, 'Criterion'],
];

const LANGS: [RegExp, string][] = [
  [/\bmulti\b/i, 'MULTi'],
  [/\b(dubbing\s?pl|pl\s?dub(bing)?|dubpl)\b/i, 'Dubbing PL'],
  [/\b(lektor\s?pl|pl\s?lektor)\b/i, 'Lektor PL'],
  [/\b(napisy\s?pl|pl\s?sub(s|bed)?|plsub(s|bed)?|subs?\s?pl)\b/i, 'Napisy PL'],
  [/\b(pl|polish)\b/i, 'PL'],
];

const YEAR = /^(19|20)\d{2}$/;
/** Words that end the title part of a release name. */
const STOP =
  /\b((19|20)\d{2}|s\d{1,2}(e\d{1,3})?|\d{1,2}x\d{2,3}|season|complete|2160p|1080[pi]|720p|576[pi]|480p|4k|uhd|remux|blu-?ray|bdrip|brrip|web-?dl|web-?rip|web|hdtv|dvdrip|dvd|hdcam|cam|x26[45]|h\s?26[45]|hevc|av1|hdr|dv|multi|extended|unrated|remastered|director'?s|imax|proper|repack|internal|limited|pl|pldub|dubbing|lektor|plsub|plsubbed)\b/gi;

function normalizeSeparators(name: string): string {
  return (
    name
      .replace(/\[[^\]]*\]\s*$/, ' ')
      .replace(/_+/g, ' ')
      // Dots separate words, except in audio channels ("5.1", "7.1"): protect them, split, restore.
      .replace(/(?<!\d)(\d)\.(\d)(?!\d)/g, '$1§$2')
      .replace(/\./g, ' ')
      .replace(/§/g, '.')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function episodeInfo(text: string): Pick<ParsedRelease, 'season' | 'episode' | 'isSeasonPack'> {
  const se = text.match(/\bs(\d{1,2})\s?e(\d{1,3})\b/i) ?? text.match(/\b(\d{1,2})x(\d{2,3})\b/);
  if (se) return { season: Number(se[1]), episode: Number(se[2]), isSeasonPack: false };
  const range = text.match(/\bs(\d{1,2})\s?-\s?s?(\d{1,2})\b/i);
  if (range) return { season: Number(range[1]), episode: null, isSeasonPack: true };
  const s = text.match(/\bs(\d{1,2})\b(?!\s?e\d)/i) ?? text.match(/\bseason\s?(\d{1,2})\b/i);
  if (s) return { season: Number(s[1]), episode: null, isSeasonPack: true };
  if (/\bcomplete\s(series|season)/i.test(text)) return { season: null, episode: null, isSeasonPack: true };
  return { season: null, episode: null, isSeasonPack: false };
}

/**
 * Where the title ends: the first quality/episode token, except that a year followed by another year belongs to
 * the title ("Blade Runner 2049 2017", "2012 2009").
 */
function titleEndIndex(text: string): number {
  const matches = [...text.matchAll(STOP)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const next = matches[i + 1];
    if (YEAR.test(m[0]) && next && YEAR.test(next[0])) continue;
    return m.index ?? -1;
  }
  return -1;
}

function findYear(text: string, titleEnd: number): number | null {
  const years = [...text.matchAll(/(?:^|[\s([])((?:19|20)\d{2})(?=$|[\s)\]])/g)];
  const after = years.filter((m) => (m.index ?? 0) + 1 >= titleEnd);
  const m = (titleEnd >= 0 ? after[0] : undefined) ?? years.at(-1);
  return m ? Number(m[1]) : null;
}

function findGroup(raw: string): string | null {
  const bracket = raw.match(/\[([A-Za-z0-9.\- ]{2,20})\]\s*$/);
  if (bracket) return bracket[1]!.trim();
  const dash = raw.replace(/\.(mkv|mp4|avi)$/i, '').match(/-([A-Za-z0-9]{2,20})$/);
  return dash ? dash[1]! : null;
}

export function parseReleaseName(raw: string): ParsedRelease {
  const text = normalizeSeparators(raw);
  const titleEnd = titleEndIndex(text);
  const title = (titleEnd > 0 ? text.slice(0, titleEnd) : text).replace(/[\s([-]+$/, '').trim();
  const audio: string[] = [];
  for (const [re, label] of AUDIO) {
    const m = text.match(re);
    if (!m || audio.some((a) => a.startsWith(label))) continue;
    const after = text.slice((m.index ?? 0) + m[0].length);
    const channels = /^(DDP|DD|AAC)$/.test(label) ? after.match(/^\s?(\d\.\d)/)?.[1] : undefined;
    audio.push(channels ? `${label}${channels}` : label);
  }
  const languages: string[] = [];
  for (const [re, label] of LANGS) {
    if (re.test(text) && !(label === 'PL' && languages.some((l) => l.includes('PL')))) languages.push(label);
  }
  return {
    title,
    year: findYear(text, titleEnd),
    resolution: first(text, RESOLUTION),
    source: first(text, SOURCE),
    codec: first(text, CODEC),
    hdr: first(text, HDR_RULES),
    audio,
    languages,
    edition: first(text, EDITION),
    group: findGroup(raw),
    ...episodeInfo(text),
  };
}
