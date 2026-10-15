import { describe, expect, it } from 'vitest';
import type { EngineEvent } from '@shared/contracts/engine';
import { nullLogger } from '../logger';
import { EngineClient } from './engine-client';
import { FakeEngine } from './fake-engine';

const MAGNET = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Test.Film.2024.1080p';

function connect(fake: FakeEngine) {
  const inst = fake.launch();
  const client = new EngineClient({ transport: inst.transport, log: nullLogger });
  const events: EngineEvent[] = [];
  client.on('event', (e) => events.push(e));
  return { client, events, inst };
}

const until = async (cond: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe('FakeEngine', () => {
  it('runs a magnet through metadata, selection, download and seeding', async () => {
    const fake = new FakeEngine({
      tickMs: 10,
      metadataDelayMs: 10,
      rate: 50 * 1024 * 1024,
      files: (name) => [
        { path: `${name}/${name}.mkv`, size: 2 * 1024 * 1024, pad: false },
        { path: `${name}/sample.mkv`, size: 1024, pad: false },
      ],
    });
    const { client, events, inst } = connect(fake);
    await client.hello('1');
    const added = await client.request('add', { magnet: MAGNET, savePath: '/tmp/x' }, 'job-1');
    expect(added).toMatchObject({ jobId: 'job-1', hasMetadata: false });
    await until(() => events.some((e) => e.event === 'metadata'));
    await client.request('selectFiles', { files: [{ index: 0, priority: 4 }] }, 'job-1');
    await until(() => events.some((e) => e.event === 'state' && e.data.state === 'seeding'));
    const states = events.filter((e) => e.event === 'state').map((e) => (e.event === 'state' ? e.data.state : ''));
    expect(states).toEqual(['fetching_metadata', 'downloading', 'downloaded', 'seeding']);
    expect(events.some((e) => e.event === 'fileCompleted' && e.data.index === 0)).toBe(true);
    expect(events.some((e) => e.event === 'fileCompleted' && e.data.index === 1)).toBe(false);
    const snap = await client.request('snapshot', {});
    expect(snap.jobs[0]).toMatchObject({ selectedBytes: 2 * 1024 * 1024, selectedDoneBytes: 2 * 1024 * 1024 });
    inst.kill();
  });

  it('pauses and keeps progress across restarts', async () => {
    const fake = new FakeEngine({ tickMs: 10, metadataDelayMs: 5, rate: 1024 * 1024 });
    const first = connect(fake);
    await first.client.request('add', { magnet: MAGNET, savePath: '/tmp/x' }, 'job-1');
    await until(() => first.events.some((e) => e.event === 'metadata'));
    await first.client.request('selectFiles', { files: [{ index: 0, priority: 4 }] }, 'job-1');
    await new Promise((r) => setTimeout(r, 60));
    await expect(first.client.request('pause', {}, 'job-1')).resolves.toEqual({ state: 'paused' });
    const done = fake.storedJob('job-1')!.done[0]!;
    expect(done).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 40));
    expect(fake.storedJob('job-1')!.done[0]).toBe(done);
    fake.crash();

    const second = connect(fake);
    const re = await second.client.request('add', { magnet: MAGNET, savePath: '/tmp/x', paused: true }, 'job-1');
    expect(re.hasMetadata).toBe(true);
    await second.client.request('selectFiles', { files: [{ index: 0, priority: 4 }] }, 'job-1');
    const snap = await second.client.request('snapshot', {});
    expect(snap.jobs[0]).toMatchObject({ state: 'paused', selectedDoneBytes: done });
    second.inst.kill();
  });
});
