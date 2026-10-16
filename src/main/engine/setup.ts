import { join } from 'node:path';
import type { Logger } from '../logger';
import { EngineSupervisor, type EngineLauncher, resolveEnginePath, spawnEngine } from './engine-process';
import { FakeEngine } from './fake-engine';

export interface EngineSetupOptions {
  userDataDir: string;
  isPackaged: boolean;
  resourcesPath: string;
  appRoot: string;
  env: NodeJS.ProcessEnv;
  clientVersion: string;
  listenPort: () => number;
  log: Logger;
}

export interface EngineSetup {
  supervisor: EngineSupervisor | null;
  fake: FakeEngine | null;
  binaryPath: string | null;
}

/**
 * Chooses the engine: FakeEngine only for unpackaged runs with ADRENALINE_FAKE_ENGINE=1 (never in the installer),
 * otherwise the adrenaline-engine binary. Returns `supervisor: null` when no binary is available.
 */
export function setupEngine(opts: EngineSetupOptions): EngineSetup {
  const log = opts.log.child('engine');
  if (!opts.isPackaged && opts.env['ADRENALINE_FAKE_ENGINE'] === '1') {
    // Dev-only knob (README screenshots): ADRENALINE_FAKE_RATE_MIB sets the simulated speed per download.
    const rateMiB = Number(opts.env['ADRENALINE_FAKE_RATE_MIB']);
    const fake = new FakeEngine({
      peers: 18,
      uploadRate: 256 * 1024,
      ...(rateMiB > 0 ? { rate: rateMiB * 1024 * 1024 } : {}),
    });
    const supervisor = new EngineSupervisor({ launch: fake.launch, log, clientVersion: opts.clientVersion });
    return { supervisor, fake, binaryPath: null };
  }
  const binaryPath = resolveEnginePath({
    env: opts.env,
    isPackaged: opts.isPackaged,
    resourcesPath: opts.resourcesPath,
    appRoot: opts.appRoot,
  });
  if (!binaryPath) {
    log.warn('engine binary not found');
    return { supervisor: null, fake: null, binaryPath: null };
  }
  const dataDir = join(opts.userDataDir, 'engine');
  const launch: EngineLauncher = () =>
    spawnEngine({
      binaryPath,
      args: ['--data-dir', dataDir, '--listen-port', String(opts.listenPort())],
      log,
    });
  return {
    supervisor: new EngineSupervisor({ launch, log, clientVersion: opts.clientVersion }),
    fake: null,
    binaryPath,
  };
}
