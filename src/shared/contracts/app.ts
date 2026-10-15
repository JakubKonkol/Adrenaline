import { z } from 'zod';

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
