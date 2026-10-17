import type { AppSettings, SettingsPatch, UserSecretName } from '@shared/contracts/settings';
import type { LanguageCode } from '@shared/domain/languages';

/** Form state of the settings screen and the onboarding wizard (numbers kept as typed text). */
export interface SettingsDraft {
  downloadDir: string;
  maxActiveDownloads: string;
  subtitlesEnabled: boolean;
  subtitleLang: LanguageCode;
  subtitleFallbackLang: LanguageCode | '';
  downloadLimitKBps: string;
  uploadLimitKBps: string;
  listenPort: string;
  seedRatioLimit: string;
  seedTimeLimitMin: string;
  closeToTray: boolean;
  theme: AppSettings['theme'];
  betaUpdates: boolean;
  opensubtitlesUsername: string;
  subtitleProviders: AppSettings['subtitleProviders'];
  napisy24Username: string;
  secrets: Record<UserSecretName, string>;
}

export type DraftErrors = Partial<Record<keyof SettingsDraft, { min: number; max: number }>>;

export function toDraft(s: AppSettings): SettingsDraft {
  return {
    downloadDir: s.downloadDir,
    maxActiveDownloads: String(s.maxActiveDownloads),
    subtitlesEnabled: s.subtitlesEnabled,
    subtitleLang: s.subtitleLang,
    subtitleFallbackLang: s.subtitleFallbackLang ?? '',
    downloadLimitKBps: String(s.downloadLimitKBps),
    uploadLimitKBps: String(s.uploadLimitKBps),
    listenPort: String(s.listenPort),
    seedRatioLimit: s.seedRatioLimit === null ? '' : String(s.seedRatioLimit),
    seedTimeLimitMin: s.seedTimeLimitMin === null ? '' : String(s.seedTimeLimitMin),
    closeToTray: s.closeToTray,
    theme: s.theme,
    betaUpdates: s.betaUpdates,
    opensubtitlesUsername: s.opensubtitlesUsername,
    subtitleProviders: s.subtitleProviders,
    napisy24Username: s.napisy24Username,
    secrets: { 'tmdb.token': '', 'opensubtitles.apiKey': '', 'opensubtitles.password': '', 'napisy24.password': '' },
  };
}

function int(text: string, min: number, max: number): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

function decimal(text: string, min: number, max: number): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

const RANGES = {
  maxActiveDownloads: { min: 1, max: 10 },
  downloadLimitKBps: { min: 0, max: 10_000_000 },
  uploadLimitKBps: { min: 0, max: 10_000_000 },
  listenPort: { min: 1024, max: 65535 },
  seedRatioLimit: { min: 0, max: 100 },
  seedTimeLimitMin: { min: 0, max: 525_600 },
} as const;

/** Converts the draft into a settings patch; out-of-range numbers are reported per field. */
export function fromDraft(d: SettingsDraft): { patch: SettingsPatch; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const num = (key: keyof typeof RANGES, parse: typeof int, allowEmpty: boolean): number | null | undefined => {
    if (allowEmpty && d[key].trim() === '') return null;
    const v = parse(d[key], RANGES[key].min, RANGES[key].max);
    if (v === null) {
      errors[key] = RANGES[key];
      return undefined;
    }
    return v;
  };
  const maxActiveDownloads = num('maxActiveDownloads', int, false);
  const downloadLimitKBps = num('downloadLimitKBps', int, false);
  const uploadLimitKBps = num('uploadLimitKBps', int, false);
  const listenPort = num('listenPort', int, false);
  const seedRatioLimit = num('seedRatioLimit', decimal, true);
  const seedTimeLimitMin = num('seedTimeLimitMin', int, true);
  const patch: SettingsPatch = {
    downloadDir: d.downloadDir,
    subtitlesEnabled: d.subtitlesEnabled,
    subtitleLang: d.subtitleLang,
    subtitleFallbackLang:
      d.subtitleFallbackLang === '' || d.subtitleFallbackLang === d.subtitleLang ? null : d.subtitleFallbackLang,
    closeToTray: d.closeToTray,
    theme: d.theme,
    betaUpdates: d.betaUpdates,
    opensubtitlesUsername: d.opensubtitlesUsername.trim(),
    subtitleProviders: d.subtitleProviders,
    napisy24Username: d.napisy24Username.trim(),
  };
  if (typeof maxActiveDownloads === 'number') patch.maxActiveDownloads = maxActiveDownloads;
  if (typeof downloadLimitKBps === 'number') patch.downloadLimitKBps = downloadLimitKBps;
  if (typeof uploadLimitKBps === 'number') patch.uploadLimitKBps = uploadLimitKBps;
  if (typeof listenPort === 'number') patch.listenPort = listenPort;
  if (seedRatioLimit !== undefined) patch.seedRatioLimit = seedRatioLimit;
  if (seedTimeLimitMin !== undefined) patch.seedTimeLimitMin = seedTimeLimitMin;
  return { patch, errors };
}

/** Secrets typed into the form (empty = keep the stored value). */
export function changedSecrets(d: SettingsDraft): { name: UserSecretName; value: string }[] {
  return (Object.entries(d.secrets) as [UserSecretName, string][])
    .filter(([, v]) => v.trim() !== '')
    .map(([name, value]) => ({ name, value: value.trim() }));
}
