import { z } from 'zod';
import type { AppErrorShape } from '../errors';
import { engineStatusSchema, updaterStatusSchema, diagnosticsSchema } from './app';
import type { ChannelName, EventName } from './channels';
import {
  appSettingsSchema,
  secretsStatusSchema,
  settingsPatchSchema,
  userSecretNameSchema,
  languageCodeSchema,
} from './settings';
import { subtitleAccountSchema } from './subtitles';
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
import {
  downloadJobSchema,
  downloadOptionsSchema,
  jobProgressSchema,
  preflightSchema,
  releaseRefSchema,
} from './downloads';
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
  'settings:testSubtitles': { input: z.void(), output: subtitleAccountSchema },
  'settings:logoutSubtitles': { input: z.void(), output: z.void() },
  'subtitles:retry': {
    input: z.object({ jobId: z.string().max(64), taskId: z.number().int().positive() }).strict(),
    output: z.void(),
  },
  'subtitles:choose': {
    input: z
      .object({ jobId: z.string().max(64), taskId: z.number().int().positive(), fileId: z.number().int().positive() })
      .strict(),
    output: z.void(),
  },
  'subtitles:language': {
    input: z
      .object({
        jobId: z.string().max(64),
        language: languageCodeSchema.nullable(),
        fallback: languageCodeSchema.nullable(),
      })
      .strict(),
    output: z.void(),
  },
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
  'downloads:preflight': {
    input: z.object({ ref: releaseRefSchema, options: downloadOptionsSchema.partial().optional() }).strict(),
    output: preflightSchema,
  },
  'downloads:create': {
    input: z.object({ ref: releaseRefSchema, options: downloadOptionsSchema }).strict(),
    output: downloadJobSchema,
  },
  'downloads:list': { input: z.void(), output: z.array(downloadJobSchema) },
  'downloads:get': { input: z.object({ jobId: z.string().max(64) }).strict(), output: downloadJobSchema },
  'downloads:progress': { input: z.void(), output: z.array(jobProgressSchema) },
  'downloads:selectFiles': {
    input: z
      .object({ jobId: z.string().max(64), indices: z.array(z.number().int().nonnegative()).min(1).max(10_000) })
      .strict(),
    output: downloadJobSchema,
  },
  'downloads:pause': { input: z.object({ jobId: z.string().max(64) }).strict(), output: downloadJobSchema },
  'downloads:resume': { input: z.object({ jobId: z.string().max(64) }).strict(), output: downloadJobSchema },
  'downloads:remove': {
    input: z.object({ jobId: z.string().max(64), deleteFiles: z.boolean() }).strict(),
    output: z.void(),
  },
  'downloads:openFolder': { input: z.object({ jobId: z.string().max(64) }).strict(), output: z.void() },
  'downloads:recheck': { input: z.object({ jobId: z.string().max(64) }).strict(), output: downloadJobSchema },
  /** Hidden test API: only registered with the fake engine in an unpackaged app (03-testy.md, smoke). */
  'dev:addTestDownload': {
    input: z.object({ name: z.string().min(1).max(120) }).strict(),
    output: downloadJobSchema,
  },
  'settings:testTmdb': { input: z.void(), output: z.boolean() },
  'app:version': { input: z.void(), output: z.string() },
  'app:diagnostics': { input: z.void(), output: diagnosticsSchema },
  'app:copyDiagnostics': { input: z.void(), output: z.void() },
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
  'downloads:changed': downloadJobSchema,
  'downloads:progress': z.object({ jobs: z.array(jobProgressSchema) }),
} as const satisfies Record<EventName, z.ZodType>;

export type ChannelInput<C extends ChannelName> = z.input<(typeof ipcChannels)[C]['input']>;
export type ChannelOutput<C extends ChannelName> = z.output<(typeof ipcChannels)[C]['output']>;
export type EventPayload<E extends EventName> = z.output<(typeof ipcEvents)[E]>;

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorShape };
