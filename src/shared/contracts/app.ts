import { z } from 'zod';

export const updaterStatusSchema = z.object({
  state: z.enum(['disabled', 'idle', 'checking', 'downloading', 'ready', 'error']),
  version: z.string().optional(),
  percent: z.number().min(0).max(100).optional(),
  message: z.string().optional(),
  checkedAt: z.number().optional(),
});
export type UpdaterStatus = z.infer<typeof updaterStatusSchema>;
