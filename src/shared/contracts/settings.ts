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
  subtitleProviders: z.array(z.enum(['opensubtitles', 'napiprojekt', 'napisy24'])).max(3),
  napisy24Username: z.string().max(200),
  /** 1.0 (D-82): LAN server for the TV apps; off by default. */
  tvServerEnabled: z.boolean(),
  tvServerPort: z.number().int().min(1024).max(65535),
  /** IPv4 address of the chosen network interface; empty = the first private LAN address. */
  tvServerAddress: z.union([z.literal(''), z.ipv4()]),
  /** D-85: encoder family for TV transcodes (auto = first working of NVENC, QSV, AMF, else CPU). */
  transcodeHwAccel: z.enum(['auto', 'nvenc', 'qsv', 'amf', 'cpu']),
  /** Highest output resolution of a TV transcode (lines). */
  transcodeMaxHeight: z.union([z.literal(2160), z.literal(1440), z.literal(1080), z.literal(720)]),
  transcodeMaxBitrateMbps: z.number().int().min(2).max(120),
  /** Disk space for HLS segments in userData/transcode. */
  transcodeCacheGiB: z.number().int().min(1).max(200),
  /** Deploy to TV (D-84): adb.exe and the Tizen Studio folder chosen by the user ('' = detect). */
  tvAdbPath: z.string().max(400),
  tvTizenStudioPath: z.string().max(400),
  tvTizenProfile: z.string().max(64),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const settingsPatchSchema = appSettingsSchema.partial().strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const STATIC_DEFAULTS: Omit<AppSettings, 'downloadDir' | 'listenPort'> = {
  subtitlesEnabled: true,
  subtitleLang: 'en',
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
  subtitleProviders: ['opensubtitles', 'napiprojekt', 'napisy24'],
  napisy24Username: '',
  tvServerEnabled: false,
  tvServerPort: 18790,
  tvServerAddress: '',
  transcodeHwAccel: 'auto',
  transcodeMaxHeight: 2160,
  transcodeMaxBitrateMbps: 40,
  transcodeCacheGiB: 20,
  tvAdbPath: '',
  tvTizenStudioPath: '',
  tvTizenProfile: '',
};

/** Secrets the user can set from the renderer (write-only; the renderer only learns whether they exist). */
export const USER_SECRET_NAMES = [
  'tmdb.token',
  'opensubtitles.apiKey',
  'opensubtitles.password',
  'napisy24.password',
] as const;
export const userSecretNameSchema = z.enum(USER_SECRET_NAMES);
export type UserSecretName = z.infer<typeof userSecretNameSchema>;

export const secretsStatusSchema = z.object({
  encryptionAvailable: z.boolean(),
  set: z.record(userSecretNameSchema, z.boolean()),
});
export type SecretsStatus = z.infer<typeof secretsStatusSchema>;
