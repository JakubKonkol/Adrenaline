import { z } from 'zod';

export const jackettStatusSchema = z.object({
  state: z.enum(['disabled', 'unavailable', 'stopped', 'starting', 'running', 'restarting', 'crashed']),
  version: z.string().optional(),
  /** Error code when unavailable/crashed. */
  message: z.string().optional(),
});
export type JackettStatus = z.infer<typeof jackettStatusSchema>;

export const sourceHealthSchema = z.enum(['unknown', 'ok', 'error']);

export const sourceSchema = z.object({
  id: z.string(),
  kind: z.enum(['jackett_builtin', 'torznab_custom']),
  name: z.string(),
  description: z.string().optional(),
  enabled: z.boolean(),
  health: sourceHealthSchema,
  /** Error code of the last check (AppErrorCode). */
  healthCode: z.string().nullable(),
  checkedAt: z.number().nullable(),
  /** Custom endpoints only (built-in Jackett endpoints change with the port). */
  endpoint: z.string().nullable(),
  hasApiKey: z.boolean(),
});
export type Source = z.infer<typeof sourceSchema>;

export const sourceIdSchema = z.string().min(1).max(120);

export const addCustomSourceSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    endpoint: z.string().trim().url().max(500),
    apiKey: z.string().trim().max(200).nullable(),
  })
  .strict();
export type AddCustomSource = z.infer<typeof addCustomSourceSchema>;
