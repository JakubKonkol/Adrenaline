import type { Logger } from './logger';

interface Step {
  name: string;
  run: () => Promise<void> | void;
  timeoutMs: number;
}

function withTimeout(promise: Promise<void>, ms: number): Promise<'done' | 'timeout'> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('timeout'), ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve('done');
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Ordered shutdown (etap 3.7): stop the queue, engine (resume data), Jackett, close the DB. Each step has its own
 * timeout, the whole sequence at most `totalTimeoutMs` (15 s). `shutdown()` is idempotent: the updater, tray "Quit"
 * and `before-quit` all share one run.
 */
export function createLifecycle(opts: { log: Logger; totalTimeoutMs?: number }) {
  const steps: Step[] = [];
  const totalTimeoutMs = opts.totalTimeoutMs ?? 15_000;
  let running: Promise<void> | null = null;
  let done = false;

  async function runSteps(deadline: number): Promise<void> {
    let exhausted = false;
    for (const step of steps) {
      const left = deadline - Date.now();
      if (exhausted || left <= 0) {
        opts.log.warn(`shutdown: no time left for ${step.name}`);
        continue;
      }
      const budget = Math.min(step.timeoutMs, left);
      try {
        const result = await withTimeout(Promise.resolve().then(step.run), budget);
        if (result === 'timeout') {
          opts.log.warn(`shutdown: ${step.name} timed out`);
          // Timers may fire a millisecond early: a step cut by the total limit ends the sequence.
          if (budget === left) exhausted = true;
        }
      } catch (error) {
        opts.log.error(`shutdown: ${step.name} failed`, error);
      }
    }
  }

  return {
    /** Steps run in registration order. */
    addStep(name: string, run: Step['run'], timeoutMs = 5_000): void {
      steps.push({ name, run, timeoutMs });
    },
    shutdown(): Promise<void> {
      running ??= runSteps(Date.now() + totalTimeoutMs).finally(() => {
        done = true;
      });
      return running;
    },
    get isDone() {
      return done;
    },
    get isShuttingDown() {
      return running !== null;
    },
  };
}

export type Lifecycle = ReturnType<typeof createLifecycle>;
