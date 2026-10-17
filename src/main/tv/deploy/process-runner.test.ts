import { describe, expect, it } from 'vitest';
import { runProcess } from './process-runner';

describe('deploy process lifecycle', () => {
  it('does not launch after cancellation', async () => {
    await expect(
      runProcess('does-not-exist', [], {
        timeoutMs: 1_000,
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ code: 'DEPLOY_CANCELLED' });
  });

  it.skipIf(process.platform !== 'win32')(
    'times out and closes inherited pipes held by a child process',
    async () => {
      const script =
        "require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'inherit', windowsHide: true}); setInterval(() => {}, 1000)";
      const result = await runProcess(process.execPath, ['-e', script], { timeoutMs: 1_000 });
      expect(result.timedOut).toBe(true);
      expect(result.code).not.toBe(0);
    },
    10_000,
  );

  it('cancels a running process', async () => {
    const controller = new AbortController();
    const job = runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    controller.abort();
    const result = await job;
    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
  });
});
