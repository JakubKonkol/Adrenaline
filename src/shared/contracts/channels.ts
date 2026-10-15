/**
 * Names of IPC channels and events, without schemas: the sandboxed preload imports only this file (no zod).
 * `ipc.ts` must define a schema for every name here (checked by its `satisfies` clauses).
 */
export const IPC_CHANNEL_NAMES = [
  'app:version',
  'app:updaterStatus',
  'app:checkForUpdates',
  'app:installUpdate',
  'app:openLogsFolder',
] as const;

export const IPC_EVENT_NAMES = ['updater:status'] as const;

export type ChannelName = (typeof IPC_CHANNEL_NAMES)[number];
export type EventName = (typeof IPC_EVENT_NAMES)[number];
