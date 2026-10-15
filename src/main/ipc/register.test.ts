import { describe, expect, it } from 'vitest';
import { AppError } from '@shared/errors';
import { createIpcRegistry, type IpcInvokeEventLike, type IpcMainLike } from './register';

function fakeIpcMain() {
  const handlers = new Map<string, (event: IpcInvokeEventLike, ...args: unknown[]) => unknown>();
  const ipcMain: IpcMainLike = {
    handle: (channel, listener) => void handlers.set(channel, listener),
    removeHandler: (channel) => void handlers.delete(channel),
  };
  const invoke = (channel: string, url: string, input?: unknown) => {
    const h = handlers.get(channel);
    if (!h) throw new Error(`no handler ${channel}`);
    return h({ senderFrame: { url } }, input);
  };
  return { ipcMain, invoke, handlers };
}

const TRUSTED = 'file:///app/out/renderer/index.html#/';

describe('createIpcRegistry', () => {
  it('returns data from a trusted sender', async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    const reg = createIpcRegistry({ ipcMain, isTrustedSender: (u) => u === TRUSTED });
    reg.handle('app:version', () => '1.2.3');
    await expect(invoke('app:version', TRUSTED)).resolves.toEqual({ ok: true, data: '1.2.3' });
  });

  it('rejects an unknown sender', async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    const reg = createIpcRegistry({ ipcMain, isTrustedSender: (u) => u === TRUSTED });
    reg.handle('app:version', () => '1.2.3');
    await expect(invoke('app:version', 'https://evil.example/')).resolves.toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('rejects invalid input with BAD_REQUEST', async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    const reg = createIpcRegistry({ ipcMain, isTrustedSender: () => true });
    reg.handle('app:version', () => '1.2.3');
    await expect(invoke('app:version', TRUSTED, { unexpected: true })).resolves.toMatchObject({
      ok: false,
      error: { code: 'BAD_REQUEST' },
    });
  });

  it('maps AppError to its code and hides other errors', async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    const errors: unknown[] = [];
    const reg = createIpcRegistry({ ipcMain, isTrustedSender: () => true, onError: (_c, e) => errors.push(e) });
    reg.handle('app:version', () => {
      throw new AppError('TMDB_UNAVAILABLE', 'down');
    });
    await expect(invoke('app:version', TRUSTED)).resolves.toEqual({
      ok: false,
      error: { code: 'TMDB_UNAVAILABLE', message: 'down' },
    });
    reg.dispose();
    const reg2 = createIpcRegistry({ ipcMain, isTrustedSender: () => true, onError: (_c, e) => errors.push(e) });
    reg2.handle('app:version', () => {
      throw new Error('secret detail');
    });
    await expect(invoke('app:version', TRUSTED)).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'Unexpected error' },
    });
    expect(errors).toHaveLength(1);
  });

  it('dispose removes handlers', () => {
    const { ipcMain, handlers } = fakeIpcMain();
    const reg = createIpcRegistry({ ipcMain, isTrustedSender: () => true });
    reg.handle('app:version', () => '1');
    reg.dispose();
    expect(handlers.size).toBe(0);
  });
});
