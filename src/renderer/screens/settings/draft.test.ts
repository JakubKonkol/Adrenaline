import { describe, expect, it } from 'vitest';
import { type AppSettings, STATIC_DEFAULTS } from '@shared/contracts/settings';
import { changedSecrets, fromDraft, toDraft } from './draft';

const settings: AppSettings = { ...STATIC_DEFAULTS, downloadDir: 'D:\\Filmy', listenPort: 51000 };

describe('settings draft', () => {
  it('round-trips settings', () => {
    const { patch, errors } = fromDraft(toDraft(settings));
    expect(errors).toEqual({});
    expect(patch).toMatchObject({
      downloadDir: 'D:\\Filmy',
      maxActiveDownloads: 3,
      seedRatioLimit: 1,
      seedTimeLimitMin: 60,
      listenPort: 51000,
      subtitleFallbackLang: null,
    });
  });

  it('accepts a decimal comma and empty seed limits', () => {
    const d = { ...toDraft(settings), seedRatioLimit: '1,5', seedTimeLimitMin: '' };
    expect(fromDraft(d).patch).toMatchObject({ seedRatioLimit: 1.5, seedTimeLimitMin: null });
  });

  it('reports out-of-range and non-numeric fields', () => {
    const d = { ...toDraft(settings), maxActiveDownloads: '0', listenPort: '80', downloadLimitKBps: 'abc' };
    const { patch, errors } = fromDraft(d);
    expect(Object.keys(errors).sort()).toEqual(['downloadLimitKBps', 'listenPort', 'maxActiveDownloads']);
    expect(errors.listenPort).toEqual({ min: 1024, max: 65535 });
    expect(patch.maxActiveDownloads).toBeUndefined();
  });

  it('drops a fallback equal to the main language', () => {
    const d = { ...toDraft(settings), subtitleLang: 'en' as const, subtitleFallbackLang: 'en' as const };
    expect(fromDraft(d).patch.subtitleFallbackLang).toBeNull();
  });

  it('lists only typed secrets', () => {
    const d = toDraft(settings);
    d.secrets['tmdb.token'] = '  abc ';
    expect(changedSecrets(d)).toEqual([{ name: 'tmdb.token', value: 'abc' }]);
  });
});
