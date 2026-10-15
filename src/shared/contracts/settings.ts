import { z } from 'zod';
import { LANGUAGE_CODES } from '../domain/languages';

export const languageCodeSchema = z.enum(LANGUAGE_CODES);

/** App settings (etap 3.2). Defaults that depend on the machine (folder, port) are filled in by main. */
export const appSettingsSchema = z.object({
  downloadDir: z.string().min(1).max(400),
  subtitlesEnabled: z.boolean(),
  subtitleLang: languageCodeSchema,
  subtitleFallbackLang: languageCodeSchema.nullable(),
  maxActiveDownloads: z.number().int().min(1).max(10),
  downloadLimitKBps: z.number().int().min(0).max(10_000_000),
  uploadLimitKBps: z.number().int().min(0).max(10_000_000),
  listenPort: z.number().int().min(1024).max(65535),
  /** D-70: stop seeding at this ratio (null = no ratio limit). */
  seedRatioLimit: z.number().min(0).max(100).nullable(),
  /** D-70: stop seeding after this many minutes (null = no time limit). */
  seedTimeLimitMin: z.number().int().min(0).max(525_600).nullable(),
  closeToTray: z.boolean(),
  trayNoticeShown: z.boolean(),
  betaUpdates: z.boolean(),
  onboardingDone: z.boolean(),
  theme: z.enum(['system', 'dark', 'light']),
  opensubtitlesUsername: z.string().max(200),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const settingsPatchSchema = appSettingsSchema.partial().strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const STATIC_DEFAULTS: Omit<AppSettings, 'downloadDir' | 'listenPort'> = {
  subtitlesEnabled: true,
  subtitleLang: 'pl',
  subtitleFallbackLang: null,
  maxActiveDownloads: 3,
  downloadLimitKBps: 0,
  uploadLimitKBps: 0,
  seedRatioLimit: 1.0,
  seedTimeLimitMin: 60,
  closeToTray: true,
  trayNoticeShown: false,
  betaUpdates: false,
  onboardingDone: false,
  theme: 'system',
  opensubtitlesUsername: '',
};

/** Secrets the user can set from the renderer (write-only; the renderer only learns whether they exist). */
export const USER_SECRET_NAMES = ['tmdb.token', 'opensubtitles.apiKey', 'opensubtitles.password'] as const;
export const userSecretNameSchema = z.enum(USER_SECRET_NAMES);
export type UserSecretName = z.infer<typeof userSecretNameSchema>;

export const secretsStatusSchema = z.object({
  encryptionAvailable: z.boolean(),
  set: z.record(userSecretNameSchema, z.boolean()),
});
export type SecretsStatus = z.infer<typeof secretsStatusSchema>;
