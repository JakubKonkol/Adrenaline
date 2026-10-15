import type { BrowserWindow } from 'electron';
import { type EventName, type EventPayload, ipcEvents } from '@shared/contracts/ipc';

/** Sends a typed main → renderer event to the main window (payload validated against the contract). */
export function createEventSender(getWindow: () => BrowserWindow | null) {
  return function send<E extends EventName>(event: E, payload: EventPayload<E>): void {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const parsed = ipcEvents[event].safeParse(payload);
    if (!parsed.success) throw new Error(`Invalid payload for ${event}`);
    win.webContents.send(event, parsed.data);
  };
}

export type EventSender = ReturnType<typeof createEventSender>;
