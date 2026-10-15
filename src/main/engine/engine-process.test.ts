import { describe, expect, it } from 'vitest';
import type { EngineStatus } from '@shared/contracts/app';
import { nullLogger } from '../logger';
import type { EngineInstance } from './engine-process';
import { EngineSupervisor, resolveEnginePath } from './engine-process';
import { FakeEngine } from './fake-engine';

const until = async (cond: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
};

function supervisor(fake: FakeEngine, extra: Partial<ConstructorParameters<typeof EngineSupervisor>[0]> = {}) {
  const sup = new EngineSupervisor({
    launch: fake.launch,
    log: nullLogger,
    clientVersion: '0.0.1',
    backoffMs: [10, 20, 30],
    heartbeatMs: 1_000_000,
    ...extra,
  });
  const statuses: EngineStatus['state'][] = [];
  sup.on('status', (s) => statuses.push(s.state));
  return { sup, statuses };
}

describe('EngineSupervisor', () => {
  it('starts and reports running', async () => {
    const fake = new FakeEngine();
    const { sup, statuses } = supervisor(fake);
    const ready: boolean[] = [];
    sup.on('ready', (r) => ready.push(r.restarted));
    await sup.start();
    expect(sup.status).toMatchObject({ state: 'running', engineVersion: 'fake' });
    expect(statuses).toEqual(['starting', 'running']);
    expect(ready).toEqual([false]);
    await sup.stop();
    expect(sup.status.state).toBe('stopped');
  });

  it('restarts after a crash and announces the restart', async () => {
    const fake = new FakeEngine();
    const { sup } = supervisor(fake);
    const ready: boolean[] = [];
    sup.on('ready', (r) => ready.push(r.restarted));
    await sup.start();
    fake.crash();
    await until(() => ready.length === 2);
    expect(ready).toEqual([false, true]);
    expect(fake.launches).toBe(2);
    await sup.stop();
  });

  it('gives up after 3 crashes in the window', async () => {
    const fake = new FakeEngine();
    const { sup } = supervisor(fake);
    await sup.start();
    for (let i = 0; i < 3; i++) {
      await until(() => sup.status.state === 'running');
      fake.crash();
      await until(() => sup.status.state !== 'running');
    }
    await until(() => sup.status.state === 'crashed');
    expect(sup.status.message).toBe('ENGINE_CRASHED');
    await new Promise((r) => setTimeout(r, 60));
    expect(fake.launches).toBe(3);
    await expect(sup.request('ping', {})).rejects.toMatchObject({ code: 'ENGINE_UNAVAILABLE' });
  });

  it('kills a hung engine after missed heartbeats', async () => {
    const fake = new FakeEngine();
    const { sup } = supervisor(fake, { heartbeatMs: 20, missedHeartbeats: 2 });
    await sup.start();
    fake.hang();
    await until(() => fake.launches === 2 && sup.status.state === 'running');
    await sup.stop();
  });

  it('stops on a protocol mismatch without restarting', async () => {
    let launches = 0;
    const launch = (): EngineInstance => {
      launches += 1;
      let onLine: (l: string) => void = () => undefined;
      let onClose: () => void = () => undefined;
      return {
        transport: {
          write: (line) => {
            const { id } = JSON.parse(line) as { id: string };
            queueMicrotask(() =>
              onLine(
                JSON.stringify({
                  v: 1,
                  id,
                  ok: true,
                  result: { protocol: 9, engineVersion: 'x', libtorrent: 'y', features: [] },
                }),
              ),
            );
          },
          onLine: (l) => void (onLine = l),
          onClose: (l) => void (onClose = l),
        },
        kill: () => onClose(),
      };
    };
    const sup = new EngineSupervisor({ launch, log: nullLogger, clientVersion: '1', backoffMs: [5] });
    await sup.start();
    expect(sup.status).toEqual({ state: 'crashed', message: 'ENGINE_PROTOCOL_MISMATCH' });
    await new Promise((r) => setTimeout(r, 30));
    expect(launches).toBe(1);
  });
});

describe('resolveEnginePath', () => {
  it('prefers ADRENALINE_ENGINE_PATH', () => {
    expect(
      resolveEnginePath({
        env: { ADRENALINE_ENGINE_PATH: '/x/engine' },
        isPackaged: false,
        resourcesPath: '/r',
        appRoot: '/a',
      }),
    ).toBe('/x/engine');
  });

  it('returns null when nothing is built', () => {
    expect(resolveEnginePath({ env: {}, isPackaged: false, resourcesPath: '/r', appRoot: '/nonexistent' })).toBeNull();
  });
});
