import { z } from 'zod';
import { JOB_STATES } from '../domain/job-state';
import { APP_ERROR_CODES } from '../errors';
import { jackettStatusSchema } from './sources';

export const updaterStatusSchema = z.object({
  state: z.enum(['disabled', 'idle', 'checking', 'downloading', 'ready', 'error']),
  version: z.string().optional(),
  percent: z.number().min(0).max(100).optional(),
  message: z.string().optional(),
  checkedAt: z.number().optional(),
});
export type UpdaterStatus = z.infer<typeof updaterStatusSchema>;

export const engineStatusSchema = z.object({
  state: z.enum(['stopped', 'starting', 'running', 'restarting', 'crashed', 'unavailable']),
  engineVersion: z.string().optional(),
  libtorrent: z.string().optional(),
  listenPort: z.number().int().optional(),
  /** Error code when crashed/unavailable (ENGINE_CRASHED, ENGINE_PROTOCOL_MISMATCH, ENGINE_UNAVAILABLE). */
  message: z.string().optional(),
  fake: z.boolean().optional(),
});
export type EngineStatus = z.infer<typeof engineStatusSchema>;

export const diagnosticsSchema = z.object({
  versions: z.object({
    app: z.string().nullable(),
    electron: z.string().nullable(),
    node: z.string().nullable(),
    engine: z.string().nullable(),
    libtorrent: z.string().nullable(),
    jackett: z.string().nullable(),
  }),
  engine: engineStatusSchema.shape.state,
  jackett: jackettStatusSchema.shape.state,
  fakeEngine: z.boolean(),
  jobs: z.record(z.enum(JOB_STATES), z.number().int().nonnegative()),
  errorCodes: z.array(z.enum(APP_ERROR_CODES)),
});
export type Diagnostics = z.infer<typeof diagnosticsSchema>;
