import type { SubtitleCandidate, SubtitleProvider } from '@shared/contracts/subtitles';
import { AppError } from '@shared/errors';
import type { HashSubtitle, HashSubtitlesClient } from '../providers/hash-subtitles';
import type { OpenSubtitlesClient, SubtitleQuery } from '../providers/opensubtitles/opensubtitles-client';

export interface SubtitleClient {
  search(query: SubtitleQuery): Promise<SubtitleCandidate[]>;
  downloadLink: OpenSubtitlesClient['downloadLink'];
  fetchFile: OpenSubtitlesClient['fetchFile'];
  downloadCandidate?: (candidate: SubtitleCandidate, video: string) => Promise<{ data: Buffer; fileName: string }>;
}

/** A broken or unconfigured provider cannot hide results from the other providers. */
export class SubtitleProviders implements SubtitleClient {
  private cache = new Map<string, { expires: number; result: HashSubtitle[] }>();
  private pending = new Map<string, Promise<HashSubtitle[]>>();
  constructor(
    private readonly options: {
      open: Pick<OpenSubtitlesClient, 'search' | 'downloadLink' | 'fetchFile'>;
      hash: HashSubtitlesClient;
      available: () => SubtitleProvider[];
    },
  ) {}

  available = (): SubtitleProvider[] => this.options.available();

  private async byHash(provider: 'napiprojekt' | 'napisy24', video: string): Promise<HashSubtitle[]> {
    const key = `${provider}:${video}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.result;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const request = this.options.hash
      .search(provider, video)
      .then((result) => {
        // Napisy24 asks for at least 15 minutes between repeated searches of the same file.
        this.cache.delete(key);
        this.cache.set(key, { expires: Date.now() + 15 * 60_000, result });
        while (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value!);
        return result;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  async search(query: SubtitleQuery): Promise<SubtitleCandidate[]> {
    const providers = this.available().filter((p) => !query.provider || query.provider === p);
    const searches = providers.flatMap((provider) => {
      if (provider === 'opensubtitles') return [this.options.open.search(query)];
      if (!query.videoPath || !query.languages.includes('pl')) return [];
      return [this.byHash(provider, query.videoPath).then((items) => items.map((x) => x.candidate))];
    });
    const results = await Promise.allSettled(searches);
    const candidates = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    if (!candidates.length && results.length && results.every((r) => r.status === 'rejected'))
      throw new AppError('SUBS_UNAVAILABLE');
    return candidates;
  }

  downloadLink = (id: number) => this.options.open.downloadLink(id);
  fetchFile = (link: string) => this.options.open.fetchFile(link);

  async downloadCandidate(candidate: SubtitleCandidate, video: string): Promise<{ data: Buffer; fileName: string }> {
    const provider = candidate.provider ?? 'opensubtitles';
    if (!this.available().includes(provider)) throw new AppError('SUBS_NO_KEY');
    if (provider === 'opensubtitles') {
      const link = await this.downloadLink(candidate.fileId);
      return { data: await this.fetchFile(link.link), fileName: link.fileName };
    }
    const found = (await this.byHash(provider, video)).find((x) => x.candidate.fileId === candidate.fileId);
    if (!found) throw new AppError('SUBS_NOT_FOUND');
    return found;
  }
}
