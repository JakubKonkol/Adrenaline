import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { UpdaterStatus } from '@shared/contracts/app';
import { nullLogger } from './logger';
import { type AppUpdaterLike, createUpdater } from './updater';

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = false;
  logger: unknown = null;
  checkForUpdates = vi.fn(() => {
    this.emit('checking-for-update');
    this.emit('update-available', { version: '0.1.1' });
    this.emit('download-progress', { percent: 50 });
    this.emit('update-downloaded', { version: '0.1.1' });
    return Promise.resolve();
  });
  quitAndInstall = vi.fn();
}

describe('createUpdater', () => {
  it('is disabled when not packaged', async () => {
    const u = createUpdater({
      updater: null,
      send: () => undefined,
      log: nullLogger,
      betaUpdates: () => false,
      shutdown: () => Promise.resolve(),
    });
    expect(u.status().state).toBe('disabled');
    await expect(u.check()).resolves.toEqual({ state: 'disabled' });
    await expect(u.install()).resolves.toBe(false);
  });

  it('reports progress and installs after shutdown', async () => {
    const fake = new FakeUpdater();
    const sent: UpdaterStatus[] = [];
    const order: string[] = [];
    const u = createUpdater({
      updater: fake as unknown as AppUpdaterLike,
      send: (s) => sent.push(s),
      log: nullLogger,
      betaUpdates: () => true,
      shutdown: () => {
        order.push('shutdown');
        return Promise.resolve();
      },
      firstCheckDelayMs: 1e9,
      intervalMs: 1e9,
    });
    u.start();
    expect(fake.autoDownload).toBe(true);
    const status = await u.check();
    expect(fake.allowPrerelease).toBe(true);
    expect(sent.map((s) => s.state)).toEqual(['checking', 'downloading', 'downloading', 'ready']);
    expect(sent[2]?.percent).toBe(50);
    expect(status).toEqual({ state: 'ready', version: '0.1.1' });
    fake.quitAndInstall.mockImplementation(() => void order.push('install'));
    await expect(u.install()).resolves.toBe(true);
    expect(order).toEqual(['shutdown', 'install']);
    u.stop();
  });

  it('redacts error messages', () => {
    const fake = new FakeUpdater();
    const sent: UpdaterStatus[] = [];
    const u = createUpdater({
      updater: fake as unknown as AppUpdaterLike,
      send: (s) => sent.push(s),
      log: nullLogger,
      betaUpdates: () => false,
      shutdown: () => Promise.resolve(),
      firstCheckDelayMs: 1e9,
      intervalMs: 1e9,
    });
    u.start();
    fake.emit('error', new Error('401 with Bearer abc.def'));
    expect(sent.at(-1)).toEqual({ state: 'error', message: '401 with Bearer <redacted>' });
    u.stop();
  });
});
