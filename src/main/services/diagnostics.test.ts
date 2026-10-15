import { expect, it } from 'vitest';
import { diagnostics } from './diagnostics';

it('includes only counts, supported error codes and validated versions', () => {
  const result = diagnostics({
    app: '0.9.0',
    electron: '44.7.2',
    node: '24.21.0',
    engine: { state: 'running', engineVersion: '0.9.0', libtorrent: '2.1.2', message: 'secret-engine-token' },
    jackett: { state: 'crashed', version: 'C:\\Users\\Private', message: 'JACKETT_UNAVAILABLE' },
    jobs: [
      { state: 'paused', errorCode: 'DISK_FULL' },
      { state: 'downloading', errorCode: 'magnet:?xt=secret' },
    ],
    subtitleErrors: ['SUBS_AUTH'],
    sourceErrors: ['https://private.invalid/?apikey=secret'],
  });
  expect(result.jobs.paused).toBe(1);
  expect(result.jobs.downloading).toBe(1);
  expect(result.errorCodes).toEqual(['JACKETT_UNAVAILABLE', 'DISK_FULL', 'SUBS_AUTH']);
  expect(result.versions.jackett).toBeNull();
  expect(JSON.stringify(result)).not.toMatch(/secret|Private|private|magnet|apikey/);
});
