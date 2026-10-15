import { describe, expect, it } from 'vitest';
import { createLifecycle } from './lifecycle';
import { nullLogger } from './logger';

describe('createLifecycle', () => {
  it('runs steps in order once', async () => {
    const order: string[] = [];
    const lc = createLifecycle({ log: nullLogger });
    lc.addStep('queue', () => void order.push('queue'));
    lc.addStep('engine', async () => {
      await Promise.resolve();
      order.push('engine');
    });
    lc.addStep('db', () => void order.push('db'));
    await Promise.all([lc.shutdown(), lc.shutdown()]);
    expect(order).toEqual(['queue', 'engine', 'db']);
    expect(lc.isDone).toBe(true);
  });

  it('continues after a failing or hanging step', async () => {
    const order: string[] = [];
    const lc = createLifecycle({ log: nullLogger });
    lc.addStep('fails', () => {
      throw new Error('boom');
    });
    lc.addStep('hangs', () => new Promise<void>(() => undefined), 20);
    lc.addStep('db', () => void order.push('db'));
    await lc.shutdown();
    expect(order).toEqual(['db']);
  });

  it('respects the total time limit', async () => {
    const lc = createLifecycle({ log: nullLogger, totalTimeoutMs: 30 });
    let ran = false;
    lc.addStep('slow', () => new Promise<void>((r) => setTimeout(r, 200)), 1000);
    lc.addStep('late', () => {
      ran = true;
    });
    const start = Date.now();
    await lc.shutdown();
    expect(Date.now() - start).toBeLessThan(150);
    expect(ran).toBe(false);
  });
});
