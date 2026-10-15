import { z } from 'zod';
import type { AppErrorShape } from '../errors';
import { engineStatusSchema, updaterStatusSchema } from './app';
import type { ChannelName, EventName } from './channels';
import { appSettingsSchema, secretsStatusSchema, settingsPatchSchema, userSecretNameSchema } from './settings';
import {
  catalogItemSchema,
  catalogSelectionSchema,
  mediaTypeSchema,
  seasonDetailsSchema,
  seasonNumberSchema,
  titleDetailsSchema,
  tmdbIdSchema,
} from './catalog';
import { searchTargetSchema } from '../domain/search-target';
import { releaseSessionSchema } from './releases';
import { addCustomSourceSchema, jackettStatusSchema, sourceIdSchema, sourceSchema } from './sources';

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
  'catalog:search': {
    input: z.object({ query: z.string().trim().max(300), type: mediaTypeSchema.optional() }).strict(),
    output: z.array(catalogItemSchema),
  },
  'catalog:details': {
    input: z.object({ type: mediaTypeSchema, tmdbId: tmdbIdSchema }).strict(),
    output: titleDetailsSchema,
  },
  'catalog:season': {
    input: z.object({ tmdbId: tmdbIdSchema, season: seasonNumberSchema }).strict(),
    output: seasonDetailsSchema,
  },
  'catalog:select': { input: catalogSelectionSchema, output: searchTargetSchema },
  'releases:startSearch': {
    input: z.object({ target: searchTargetSchema, refresh: z.boolean().optional() }).strict(),
    output: z.object({ sessionId: z.string() }),
  },
  'releases:cancelSearch': { input: z.object({ sessionId: z.string().max(100) }).strict(), output: z.void() },
  'releases:session': {
    input: z.object({ sessionId: z.string().max(100) }).strict(),
    output: releaseSessionSchema.nullable(),
  },
  'sources:list': { input: z.void(), output: z.array(sourceSchema) },
  'sources:setEnabled': {
    input: z.object({ id: sourceIdSchema, enabled: z.boolean() }).strict(),
    output: z.array(sourceSchema),
  },
  'sources:test': { input: z.object({ id: sourceIdSchema }).strict(), output: sourceSchema },
  'sources:addCustom': { input: addCustomSourceSchema, output: z.array(sourceSchema) },
  'sources:remove': { input: z.object({ id: sourceIdSchema }).strict(), output: z.array(sourceSchema) },
  'sources:jackettStatus': { input: z.void(), output: jackettStatusSchema },
  'sources:restartJackett': { input: z.void(), output: jackettStatusSchema },
  'settings:testTmdb': { input: z.void(), output: z.boolean() },
  'app:version': { input: z.void(), output: z.string() },
  'app:updaterStatus': { input: z.void(), output: updaterStatusSchema },
  'app:checkForUpdates': { input: z.void(), output: updaterStatusSchema },
  'app:installUpdate': { input: z.void(), output: z.boolean() },
  'app:openLogsFolder': { input: z.void(), output: z.void() },
  'app:engineStatus': { input: z.void(), output: engineStatusSchema },
  'app:restartEngine': { input: z.void(), output: engineStatusSchema },
  'settings:get': { input: z.void(), output: appSettingsSchema },
  'settings:update': { input: settingsPatchSchema, output: appSettingsSchema },
  'settings:chooseFolder': {
    input: z.object({ defaultPath: z.string().max(400).optional() }).strict(),
    output: z.string().nullable(),
  },
  'settings:secretsStatus': { input: z.void(), output: secretsStatusSchema },
  'settings:setSecret': {
    input: z.object({ name: userSecretNameSchema, value: z.string().max(2000).nullable() }).strict(),
    output: secretsStatusSchema,
  },
} as const satisfies Record<ChannelName, ChannelSchema>;

/** Events sent from main to the renderer (`webContents.send`). */
export const ipcEvents = {
  'updater:status': updaterStatusSchema,
  'engine:status': engineStatusSchema,
  'releases:update': releaseSessionSchema,
  'jackett:status': jackettStatusSchema,
} as const satisfies Record<EventName, z.ZodType>;

export type ChannelInput<C extends ChannelName> = z.input<(typeof ipcChannels)[C]['input']>;
export type ChannelOutput<C extends ChannelName> = z.output<(typeof ipcChannels)[C]['output']>;
export type EventPayload<E extends EventName> = z.output<(typeof ipcEvents)[E]>;

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorShape };
