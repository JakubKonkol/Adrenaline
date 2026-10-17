import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { SubtitleCandidate } from '@shared/contracts/subtitles';
import { AppError } from '@shared/errors';
import { readBodyLimited } from './http';
import { movieHash } from './opensubtitles/movie-hash';
import { MAX_SUBTITLE_BYTES, validateSubtitle } from './opensubtitles/subtitle-file';

export interface HashSubtitle {
  candidate: SubtitleCandidate;
  data: Buffer;
  fileName: string;
}

export async function napiHash(path: string): Promise<string> {
  const file = await open(path, 'r');
  try {
    const data = Buffer.alloc(10 * 1024 * 1024);
    let size = 0;
    while (size < data.length) {
      const { bytesRead } = await file.read(data, size, data.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    return createHash('md5').update(data.subarray(0, size)).digest('hex');
  } finally {
    await file.close();
  }
}

export function napiSubhash(hash: string): string {
  return [14, 3, 6, 8, 2]
    .map((index, i) => {
      const offset = parseInt(hash[index]!, 16) + [0, 13, 16, 11, 5][i]!;
      return ((parseInt(hash.slice(offset, offset + 2), 16) * [2, 2, 5, 4, 3][i]!) & 15).toString(16);
    })
    .join('');
}

function candidate(provider: 'napiprojekt' | 'napisy24', hash: string, video: string): SubtitleCandidate {
  // Separate numeric namespaces preserve the existing desktop choose(fileId) contract.
  const fileId =
    parseInt(createHash('sha256').update(hash).digest('hex').slice(0, 10), 16) +
    (provider === 'napiprojekt' ? 2 ** 40 : 2 ** 41);
  return {
    provider,
    id: `${provider}:${hash}`,
    fileId,
    fileName: `${basename(video)}.srt`,
    language: 'pl',
    release: basename(video),
    moviehashMatch: true,
    hearingImpaired: false,
    foreignPartsOnly: false,
    fromTrusted: false,
    machineTranslated: false,
    downloadCount: 0,
    ratings: 0,
  };
}

interface Options {
  fetch?: typeof fetch;
  username?: () => string;
  password?: () => string | null;
}

/** File hashes stay in main. Requests and decompression are bounded and never follow redirects. */
export class HashSubtitlesClient {
  constructor(private readonly options: Options = {}) {}

  private async request(url: string, init: RequestInit = {}): Promise<Buffer> {
    try {
      const response = await (this.options.fetch ?? fetch)(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': 'Adrenaline', ...init.headers },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new AppError('SUBS_UNAVAILABLE');
      }
      const data = await readBodyLimited(response, MAX_SUBTITLE_BYTES);
      if (!data) throw new AppError('SUBS_BAD_FILE');
      return data;
    } catch (error) {
      throw error instanceof AppError ? error : new AppError('SUBS_UNAVAILABLE');
    }
  }

  async search(provider: 'napiprojekt' | 'napisy24', video: string): Promise<HashSubtitle[]> {
    const hash = await napiHash(video);
    let data: Buffer;
    const found = candidate(provider, hash, video);
    if (provider === 'napiprojekt') {
      const url = new URL('https://napiprojekt.pl/unit_napisy/dl.php');
      url.search = new URLSearchParams({
        v: 'dreambox',
        kolejka: 'false',
        nick: '',
        pass: '',
        napios: 'Linux',
        l: 'PL',
        f: hash,
        t: napiSubhash(hash),
      }).toString();
      data = await this.request(url.toString());
      if (data[0] === 0x1f && data[1] === 0x8b) {
        try {
          data = gunzipSync(data, { maxOutputLength: MAX_SUBTITLE_BYTES });
        } catch {
          throw new AppError('SUBS_BAD_FILE');
        }
      }
      if (data.subarray(0, 4).toString() === 'NPc0' || !data.length) return [];
      // NapiProjekt can return SRT, MicroDVD or time-based TXT, regardless of the filename.
      const text = data.toString('latin1');
      found.fileName = /^\{\d+\}\{\d+\}/m.test(text)
        ? 'napiprojekt.sub'
        : /-->/.test(text)
          ? 'napiprojekt.srt'
          : 'napiprojekt.txt';
    } else {
      const username = this.options.username?.().trim();
      const password = this.options.password?.();
      if (!username || !password) throw new AppError('SUBS_NO_KEY');
      const file = await open(video, 'r');
      let size: number;
      try {
        size = (await file.stat()).size;
      } finally {
        await file.close();
      }
      const fh = await movieHash(video);
      if (!fh) return [];
      const body = new URLSearchParams({
        postAction: 'CheckSub',
        ua: username,
        ap: password,
        fs: String(size),
        fh: fh.toUpperCase(),
        md: hash,
        fn: basename(video),
        nl: 'pl',
        n24pref: '1',
      });
      const response = await this.request('https://napisy24.pl/run/CheckSubAgent.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const separator = response.indexOf('||');
      const info = response.subarray(0, separator < 0 ? response.length : separator).toString('utf8');
      if (info.startsWith('login error')) throw new AppError('SUBS_AUTH');
      if (/^OK-[013](?:\||$)/.test(info)) return [];
      if (!info.startsWith('OK-2|') || separator < 0) throw new AppError('SUBS_BAD_FILE');
      const id = /(?:^|\|)napisId:(\d+)/.exec(info)?.[1];
      if (id && id !== '0') found.id = `napisy24:${id}`;
      data = response.subarray(separator + 2);
      found.fileName = 'napisy24.srt'; // ZIP member determines the actual format during validation.
    }
    validateSubtitle(data, found.fileName, 'pl');
    return [{ candidate: found, data, fileName: found.fileName }];
  }
}
