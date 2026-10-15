import { describe, expect, it } from 'vitest';
import { IPC_CHANNEL_NAMES, IPC_EVENT_NAMES } from './channels';
import { ipcChannels, ipcEvents } from './ipc';

describe('IPC contract', () => {
  it('has a schema for exactly the listed channels and events', () => {
    expect(Object.keys(ipcChannels).sort()).toEqual([...IPC_CHANNEL_NAMES].sort());
    expect(Object.keys(ipcEvents).sort()).toEqual([...IPC_EVENT_NAMES].sort());
  });

  it('uses group:method names', () => {
    for (const name of IPC_CHANNEL_NAMES) expect(name).toMatch(/^[a-z]+:[a-zA-Z]+$/);
  });
});
