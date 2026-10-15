import type { Diagnostics } from '@shared/contracts/app';
import type { EngineStatus } from '@shared/contracts/app';
import type { JackettStatus } from '@shared/contracts/sources';
import { JOB_STATES, type JobState } from '@shared/domain/job-state';
import { isAppErrorCode } from '@shared/errors';

const version = (value: string | undefined) =>
  value && /^\d+(?:\.\d+){1,3}(?:-[a-z0-9.]+)?$/i.test(value) ? value : null;

/** Strict allowlist: never serialize whole jobs, provider replies, log lines or environment variables. */
export function diagnostics(input: {
  app: string;
  electron: string;
  node: string;
  engine: EngineStatus;
  jackett: JackettStatus;
  jobs: { state: JobState; errorCode: string | null }[];
  subtitleErrors: (string | null)[];
  sourceErrors: (string | null)[];
}): Diagnostics {
  const counts = Object.fromEntries(JOB_STATES.map((s) => [s, 0])) as Record<JobState, number>;
  for (const job of input.jobs) counts[job.state]++;
  return {
    versions: {
      app: version(input.app),
      electron: version(input.electron),
      node: version(input.node),
      engine: version(input.engine.engineVersion),
      libtorrent: version(input.engine.libtorrent),
      jackett: version(input.jackett.version),
    },
    engine: input.engine.state,
    jackett: input.jackett.state,
    fakeEngine: input.engine.fake ?? false,
    jobs: counts,
    errorCodes: [
      ...new Set(
        [
          input.engine.message,
          input.jackett.message,
          ...input.jobs.map((j) => j.errorCode),
          ...input.subtitleErrors,
          ...input.sourceErrors,
        ].filter(isAppErrorCode),
      ),
    ].slice(0, 20),
  };
}
