import { z } from 'zod';
import { JOB_STATES } from '../domain/job-state';
import { libraryItemSchema } from './library';

/**
 * TV API v1 (1.0, docs/1.0-adrenaline-tv/02-architecture-and-api.md). DTOs sent over the LAN never contain local
 * paths, hashes, download links or secrets. The API version is independent of the app version.
 */
export const TV_API_VERSION = 1;
export const TV_API_MIN = 1;
export const TV_DEFAULT_PORT = 18790;

export const tvPlatformSchema = z.enum(['android', 'tizen', 'web']);
export type TvPlatform = z.infer<typeof tvPlatformSchema>;

export const tvInfoSchema = z.object({
  app: z.literal('adrenaline'),
  serverId: z.string(),
  serverName: z.string(),
  version: z.string(),
  apiVersion: z.number().int(),
  apiMin: z.number().int(),
});
export type TvInfo = z.infer<typeof tvInfoSchema>;

/** Device name as typed or reported by the TV: printable characters only. */
const deviceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[^\p{Cc}\p{Cf}<>]+$/u);

export const pairingRequestSchema = z
  .object({
    deviceName: deviceNameSchema,
    platform: tvPlatformSchema,
    clientVersion: z.string().max(40).optional(),
  })
  .strict();
export type PairingRequest = z.infer<typeof pairingRequestSchema>;

export const pairingCreatedSchema = z.object({
  pairingId: z.string(),
  /** Shown on the TV and on the PC; the user approves only when both match. */
  code: z.string().regex(/^\d{6}$/),
  /** Secret only the TV knows; needed to collect the token after approval. */
  claimSecret: z.string(),
  expiresAt: z.number(),
  pollMs: z.number().int(),
});
export type PairingCreated = z.infer<typeof pairingCreatedSchema>;

export const pairingClaimSchema = z.object({ claimSecret: z.string().min(16).max(100) }).strict();

export const pairingStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('denied') }),
  z.object({ status: z.literal('expired') }),
  z.object({ status: z.literal('approved'), token: z.string(), deviceId: z.string() }),
]);
export type PairingStatus = z.infer<typeof pairingStatusSchema>;

export const tvSelectionSchema = z
  .object({
    type: z.enum(['movie', 'tv']),
    tmdbId: z.number().int().positive(),
    season: z.number().int().min(0).max(10000).optional(),
    episode: z.number().int().positive().optional(),
  })
  .strict()
  .refine((v) =>
    v.type === 'movie'
      ? v.season === undefined && v.episode === undefined
      : v.season !== undefined && v.episode !== undefined,
  );

export const tvCreateDownloadSchema = z
  .object({
    sessionId: z.string().max(100),
    releaseId: z.string().max(200),
    /** Subtitles in the language set on the PC (only when an OpenSubtitles account is set up there). */
    subtitles: z.boolean(),
  })
  .strict();

export const tvDownloadActionSchema = z.object({ action: z.enum(['pause', 'resume']) }).strict();

export const tvDownloadSchema = z.object({
  id: z.string(),
  kind: z.enum(['movie', 'episode']),
  tmdbId: z.number().int(),
  title: z.string(),
  year: z.number().int().nullable(),
  season: z.number().int().nullable(),
  episode: z.number().int().nullable(),
  posterPath: z.string().nullable(),
  releaseName: z.string(),
  state: z.enum(JOB_STATES),
  /** Derived status for the UI (`deriveJobStatus`). */
  status: z.string(),
  errorCode: z.string().nullable(),
  percent: z.number().min(0).max(100).nullable(),
  sizeBytes: z.number().nullable(),
  downloadRate: z.number().nonnegative(),
  etaSeconds: z.number().nullable(),
  /** The files need a choice on the PC (several videos in the torrent). */
  needsFileChoice: z.boolean(),
  createdAt: z.number(),
});
export type TvDownload = z.infer<typeof tvDownloadSchema>;

export const tvLibraryItemSchema = libraryItemSchema.omit({ jobId: true }).extend({
  /** Where this TV stopped watching (ms), null when never started or finished. */
  resumeMs: z.number().int().nonnegative().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
});
export type TvLibraryItem = z.infer<typeof tvLibraryItemSchema>;

export const tvPlaybackSchema = z.object({
  itemId: z.string(),
  title: z.string(),
  /** Absolute URL with a short-lived ticket; supports HTTP Range. */
  streamUrl: z.string(),
  mimeType: z.string(),
  subtitles: z.array(z.object({ lang: z.string(), url: z.string() })),
  resumeMs: z.number().int().nonnegative().nullable(),
});
export type TvPlayback = z.infer<typeof tvPlaybackSchema>;

export const tvProgressSchema = z
  .object({
    positionMs: z.number().int().nonnegative().max(1e9),
    durationMs: z.number().int().nonnegative().max(1e9).nullable(),
  })
  .strict();

export const tvErrorSchema = z.object({
  error: z.object({ code: z.string(), requestId: z.string(), retryable: z.boolean() }),
});

// ---------------------------------------------------------------- desktop (IPC) view of the TV server

export const tvAddressSchema = z.object({
  address: z.string(),
  interfaceName: z.string(),
  /** Private LAN range (10/8, 172.16/12, 192.168/16); others are shown but not chosen automatically. */
  private: z.boolean(),
});
export type TvAddress = z.infer<typeof tvAddressSchema>;

export const tvDeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  platform: tvPlatformSchema,
  clientVersion: z.string().nullable(),
  createdAt: z.number(),
  lastSeenAt: z.number().nullable(),
  lastAddress: z.string().nullable(),
});
export type TvDevice = z.infer<typeof tvDeviceSchema>;

export const tvPendingPairingSchema = z.object({
  id: z.string(),
  code: z.string(),
  deviceName: z.string(),
  platform: tvPlatformSchema,
  address: z.string(),
  expiresAt: z.number(),
});
export type TvPendingPairing = z.infer<typeof tvPendingPairingSchema>;

export const tvServerStatusSchema = z.object({
  enabled: z.boolean(),
  state: z.enum(['stopped', 'starting', 'running', 'error']),
  /** e.g. TV_PORT_IN_USE, TV_NO_NETWORK */
  errorCode: z.string().nullable(),
  /** Address and port the TV apps connect to (the PC, not the TV). */
  address: z.string().nullable(),
  port: z.number().int(),
  url: z.string().nullable(),
  addresses: z.array(tvAddressSchema),
  pending: z.array(tvPendingPairingSchema),
  devices: z.array(tvDeviceSchema),
});
export type TvServerStatus = z.infer<typeof tvServerStatusSchema>;
