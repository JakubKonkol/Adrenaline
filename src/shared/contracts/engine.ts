import { z } from 'zod';

/** adrenaline-engine protocol (02-protokol-silnika.md). Unknown fields are ignored (forward compatibility). */
export const ENGINE_PROTOCOL_VERSION = 1;

export const engineStateSchema = z.enum([
  'fetching_metadata',
  'downloading',
  'paused',
  'checking',
  'downloaded',
  'seeding',
  'stopped',
  'error',
]);
export type EngineState = z.infer<typeof engineStateSchema>;

export const engineErrorSchema = z.object({ code: z.string(), message: z.string() });
export type EngineErrorPayload = z.infer<typeof engineErrorSchema>;

export const engineFileSchema = z.object({
  index: z.number().int().nonnegative(),
  path: z.string(),
  size: z.number().nonnegative(),
  pad: z.boolean(),
});
export type EngineFile = z.infer<typeof engineFileSchema>;

export const jobStatusSchema = z.object({
  jobId: z.string(),
  state: engineStateSchema,
  reason: z.string().optional(),
  hasMetadata: z.boolean().optional(),
  selectedBytes: z.number().nonnegative(),
  selectedDoneBytes: z.number().nonnegative(),
  files: z.array(z.object({ index: z.number().int(), doneBytes: z.number().nonnegative() })),
  downloadRate: z.number().nonnegative(),
  uploadRate: z.number().nonnegative(),
  peers: z.number().int().nonnegative(),
  seeds: z.number().int().nonnegative(),
  ratio: z.number().nonnegative(),
  seedingSeconds: z.number().nonnegative(),
  etaSeconds: z.number().nonnegative().nullable(),
});
export type JobStatus = z.infer<typeof jobStatusSchema>;

const okResult = z.object({ ok: z.literal(true), pending: z.boolean().optional() });

/** Result schema per operation. */
export const engineResultSchemas = {
  hello: z.object({
    protocol: z.number().int(),
    engineVersion: z.string(),
    libtorrent: z.string(),
    features: z.array(z.string()),
    listenPort: z.number().int().optional(),
  }),
  ping: z.object({ now: z.number() }),
  add: z.object({ jobId: z.string(), infoHashV1: z.string(), infoHashV2: z.string(), hasMetadata: z.boolean() }),
  selectFiles: okResult,
  files: z.object({ files: z.array(engineFileSchema) }),
  pause: z.object({ state: engineStateSchema, pending: z.boolean().optional() }),
  resume: z.object({ state: engineStateSchema }),
  remove: okResult,
  recheck: okResult,
  setLimits: okResult,
  setSeedPolicy: okResult,
  snapshot: z.object({ jobs: z.array(jobStatusSchema), seq: z.number().int() }),
  shutdown: okResult,
} as const;
export type EngineOp = keyof typeof engineResultSchemas;
export type EngineResult<O extends EngineOp> = z.infer<(typeof engineResultSchemas)[O]>;

export interface EngineArgs {
  hello: { clientVersion: string };
  ping: Record<string, never>;
  add: { magnet?: string; torrentBase64?: string; savePath: string; paused?: boolean; peers?: string[] };
  selectFiles: { files: { index: number; priority: number }[] };
  files: Record<string, never>;
  pause: Record<string, never>;
  resume: Record<string, never>;
  remove: { deleteFiles: boolean };
  recheck: Record<string, never>;
  setLimits: { downloadBps: number; uploadBps: number; maxConnections?: number };
  setSeedPolicy: { ratio: number | null; minutes: number | null };
  snapshot: Record<string, never>;
  shutdown: Record<string, never>;
}

export const engineResponseSchema = z.union([
  z.object({ v: z.number(), id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({ v: z.number(), id: z.string(), ok: z.literal(false), error: engineErrorSchema }),
]);

export const engineMetadataSchema = z.object({
  jobId: z.string(),
  name: z.string(),
  files: z.array(engineFileSchema),
  totalSize: z.number().nonnegative(),
  infoHashV1: z.string(),
  infoHashV2: z.string(),
});
export type EngineMetadata = z.infer<typeof engineMetadataSchema>;

export const engineStateEventSchema = z.object({
  jobId: z.string(),
  state: engineStateSchema,
  reason: z.string().optional(),
  error: engineErrorSchema.optional(),
});
export type EngineStateEvent = z.infer<typeof engineStateEventSchema>;

const ev = <N extends string, D extends z.ZodType>(name: N, data: D) =>
  z.object({ v: z.number(), event: z.literal(name), seq: z.number().int().positive(), data });

export const engineEventSchema = z.discriminatedUnion('event', [
  ev(
    'ready',
    z.object({
      engineVersion: z.string(),
      protocol: z.number().int(),
      libtorrent: z.string().optional(),
      listenPort: z.number().int().optional(),
    }),
  ),
  ev('metadata', engineMetadataSchema),
  ev('state', engineStateEventSchema),
  ev('progress', z.object({ jobs: z.array(jobStatusSchema) })),
  ev('fileCompleted', z.object({ jobId: z.string(), index: z.number().int() })),
  ev('resumeSaved', z.object({ jobId: z.string() })),
  ev('log', z.object({ level: z.string(), message: z.string() })),
]);
export type EngineEvent = z.infer<typeof engineEventSchema>;
export type EngineEventName = EngineEvent['event'];
export type EngineEventData<N extends EngineEventName> = Extract<EngineEvent, { event: N }>['data'];
