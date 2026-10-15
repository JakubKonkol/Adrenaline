import { z } from 'zod';
import type { AppErrorShape } from '../errors';
import { updaterStatusSchema } from './app';
import type { ChannelName, EventName } from './channels';

export type { ChannelName, EventName } from './channels';

interface ChannelSchema {
  input: z.ZodType;
  output: z.ZodType;
}

/**
 * IPC contract: every invoke channel (`group:method`) has a Zod schema for its single input argument and its result.
 * The preload API, the main handlers and the renderer types are all derived from this table (01-architektura.md).
 */
export const ipcChannels = {
  'app:version': { input: z.void(), output: z.string() },
  'app:updaterStatus': { input: z.void(), output: updaterStatusSchema },
  'app:checkForUpdates': { input: z.void(), output: updaterStatusSchema },
  'app:installUpdate': { input: z.void(), output: z.boolean() },
  'app:openLogsFolder': { input: z.void(), output: z.void() },
} as const satisfies Record<ChannelName, ChannelSchema>;

/** Events sent from main to the renderer (`webContents.send`). */
export const ipcEvents = {
  'updater:status': updaterStatusSchema,
} as const satisfies Record<EventName, z.ZodType>;

export type ChannelInput<C extends ChannelName> = z.input<(typeof ipcChannels)[C]['input']>;
export type ChannelOutput<C extends ChannelName> = z.output<(typeof ipcChannels)[C]['output']>;
export type EventPayload<E extends EventName> = z.output<(typeof ipcEvents)[E]>;

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorShape };
