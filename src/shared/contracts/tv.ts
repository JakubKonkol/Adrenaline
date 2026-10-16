import { z } from 'zod';
import { JOB_STATES } from '../domain/job-state';
import { libraryItemSchema } from './library';

/**
 * TV API v1 (1.0, docs/1.0-adrenaline-tv/02-architecture-and-api.md). DTOs sent over the LAN never contain local
 * paths, hashes, download links or secrets. The API version is independent of the app version.
 */
export { TV_API_MIN, TV_API_VERSION, TV_DEFAULT_PORT } from './tv-constants';

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

export const tvSessionSchema = z.object({
  device: z.object({ id: z.string(), name: z.string() }),
  server: tvInfoSchema,
  /** What the PC can do for this TV right now. */
  features: z.object({ subtitles: z.boolean() }),
});
export type TvSession = z.infer<typeof tvSessionSchema>;

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

const codec = z.string().regex(/^[a-z0-9-]{1,20}$/);

/** What the TV can play (D-85): reported by the TV app, used by the PlaybackPlanner. */
export const deviceProfileSchema = z
  .object({
    platform: tvPlatformSchema,
    model: z.string().max(80).nullable(),
    maxWidth: z.number().int().min(320).max(7680),
    maxHeight: z.number().int().min(240).max(4320),
    video: z
      .array(
        z.object({
          codec,
          maxWidth: z.number().int().min(320).max(7680),
          maxHeight: z.number().int().min(240).max(4320),
          tenBit: z.boolean(),
        }),
      )
      .max(10),
    hdr: z.object({
      hdr10: z.boolean(),
      hdr10plus: z.boolean(),
      hlg: z.boolean(),
      dolbyVision: z.array(z.number().int().min(0).max(20)).max(10),
    }),
    audioDecode: z.array(codec).max(20),
    audioPassthrough: z.array(codec).max(20),
    maxAudioChannels: z.number().int().min(1).max(16),
    containers: z.array(codec).max(10),
    hls: z.boolean(),
  })
  .strict();

export const subtitleChoiceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('external'), lang: z.string().max(16) }).strict(),
  z.object({ kind: z.literal('embedded'), index: z.number().int().min(0).max(999) }).strict(),
]);

export const tvPlaybackRequestSchema = z
  .object({
    profile: deviceProfileSchema,
    audioIndex: z.number().int().min(0).max(999).nullable().optional(),
    subtitle: subtitleChoiceSchema.optional(),
    /** Start of the converted stream (a seek beyond what the PC converted so far starts a new stream). */
    startMs: z.number().int().min(0).max(1e9).optional(),
  })
  .strict();

export const tvAudioTrackSchema = z.object({
  index: z.number().int(),
  label: z.string(),
  selected: z.boolean(),
});

export const tvSubtitleTrackSchema = z.object({
  /** `x:<lang>` sidecar file, `e:<index>` embedded track. */
  id: z.string(),
  label: z.string(),
  kind: z.enum(['external', 'embedded-text', 'embedded-image']),
  /** WebVTT for text tracks; image tracks are burned in by the PC (new stream). */
  url: z.string().nullable(),
  /** Already part of the picture (burned in). */
  burnedIn: z.boolean(),
});

export const tvPlaybackSchema = z.object({
  itemId: z.string(),
  title: z.string(),
  mode: z.enum(['direct', 'remux', 'audio', 'video']),
  /** Absolute URL with a short-lived ticket: the file (HTTP Range) or an HLS playlist. */
  streamUrl: z.string(),
  mimeType: z.string(),
  /** Position in the film where the stream starts (HLS after a seek); the player adds it to its own time. */
  offsetMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().nullable(),
  resumeMs: z.number().int().nonnegative().nullable(),
  audioTracks: z.array(tvAudioTrackSchema),
  subtitleTracks: z.array(tvSubtitleTrackSchema),
  /** Why this variant (direct play, remux, conversion). */
  reasons: z.array(z.string()),
});
export type TvPlayback = z.infer<typeof tvPlaybackSchema>;
export type TvSubtitleTrack = z.infer<typeof tvSubtitleTrackSchema>;

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

export const tvPlaybackRecordSchema = z.object({
  deviceName: z.string(),
  title: z.string(),
  mode: z.enum(['direct', 'remux', 'audio', 'video']),
  reasons: z.array(z.string()),
  encoder: z.string().nullable(),
  toneMap: z.enum(['none', 'zscale', 'libplacebo']),
  /** FFmpeg speed (×realtime) while converting. */
  speed: z.number().nullable(),
  active: z.boolean(),
  startedAt: z.number(),
});
export type TvPlaybackRecord = z.infer<typeof tvPlaybackRecordSchema>;

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
  /** FFmpeg is bundled and found (conversion possible). */
  ffmpeg: z.boolean(),
  playbacks: z.array(tvPlaybackRecordSchema),
});
export type TvServerStatus = z.infer<typeof tvServerStatusSchema>;

// ---------------------------------------------------------------- Deploy to TV (desktop, D-84)

export const tvToolchainSchema = z.object({
  adb: z.string().nullable(),
  sdb: z.string().nullable(),
  tizen: z.string().nullable(),
  tizenStudio: z.string().nullable(),
  /** Certificate profiles from Tizen Studio's Certificate Manager. */
  profiles: z.array(z.string()),
});
export type TvToolchain = z.infer<typeof tvToolchainSchema>;

/** Private IPv4 of the TV (no host names, no command text: D-84). */
const tvAddressSchemaIp = z.ipv4().refine((ip) => {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}, 'Enter the private IPv4 address of the TV (e.g. 192.168.1.40)');

export const tvDeployRequestSchema = z.discriminatedUnion('platform', [
  z
    .object({
      platform: z.literal('android'),
      address: tvAddressSchemaIp,
      /** ADB port shown by the TV (wireless debugging) or 5555 for classic network debugging. */
      port: z.number().int().min(1).max(65535),
      /** Android 11+ wireless debugging: "Pair device with pairing code" port and code. */
      pairing: z
        .object({ port: z.number().int().min(1).max(65535), code: z.string().regex(/^\d{6}$/) })
        .strict()
        .nullable(),
    })
    .strict(),
  z
    .object({
      platform: z.literal('tizen'),
      address: tvAddressSchemaIp,
      /** Certificate profile (author + Samsung distributor certificate with this TV's DUID). */
      profile: z.string().regex(/^[\w-]{1,64}$/),
    })
    .strict(),
]);
export type TvDeployRequest = z.infer<typeof tvDeployRequestSchema>;

export const TV_DEPLOY_STEPS = [
  'preflight',
  'pairing',
  'connecting',
  'authorizing',
  'packaging',
  'installing',
  'launching',
  'handshake',
] as const;
export type TvDeployStep = (typeof TV_DEPLOY_STEPS)[number];

export const tvDeployStateSchema = z.object({
  platform: z.enum(['android', 'tizen']),
  address: z.string(),
  step: z.enum(TV_DEPLOY_STEPS),
  /** action: waiting for the user on the TV (accept the debugging prompt, open the app, approve pairing). */
  status: z.enum(['running', 'action', 'done', 'error', 'cancelled']),
  errorCode: z.string().nullable(),
  /** Last lines of the tool output, without secrets (for the error details). */
  detail: z.string().nullable(),
  /** Samsung DUID of the TV (needed for the distributor certificate). */
  duid: z.string().nullable(),
  startedAt: z.number(),
});
export type TvDeployState = z.infer<typeof tvDeployStateSchema>;
