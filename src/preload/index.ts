import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { type AdrenalineApi, splitChannel } from '@shared/contracts/api';
import { IPC_CHANNEL_NAMES, IPC_EVENT_NAMES } from '@shared/contracts/channels';

/** Builds `window.adrenaline` from the IPC contract: one function per channel, no raw ipcRenderer access. */
function buildApi(): AdrenalineApi {
  const api: Record<string, Record<string, (input?: unknown) => Promise<unknown>>> = {};
  for (const channel of IPC_CHANNEL_NAMES) {
    const [group, method] = splitChannel(channel);
    (api[group] ??= {})[method] = (input?: unknown) => ipcRenderer.invoke(channel, input);
  }
  const allowedEvents = new Set<string>(IPC_EVENT_NAMES);
  const events = {
    on(event: string, listener: (payload: unknown) => void) {
      if (!allowedEvents.has(event)) throw new Error(`Unknown event: ${event}`);
      const wrapped = (_e: IpcRendererEvent, payload: unknown) => listener(payload);
      ipcRenderer.on(event, wrapped);
      return () => void ipcRenderer.removeListener(event, wrapped);
    },
  };
  return { ...api, events } as unknown as AdrenalineApi;
}

contextBridge.exposeInMainWorld('adrenaline', buildApi());
