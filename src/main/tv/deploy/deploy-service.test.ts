import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TvDeployState, TvToolchain } from '@shared/contracts/tv';
import type { Logger } from '../../logger';
import { nullLogger } from '../../logger';
import { DeployService } from './deploy-service';
import { cmdLine, type ProcessRunner, type RunResult } from './process-runner';
import { detectToolchain } from './toolchain';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: '', timedOut: false });
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

function setup(responder: (exe: string, args: string[], input?: string) => RunResult, tvSeen = true) {
  const base = mkdtempSync(join(tmpdir(), 'adr-deploy-'));
  dirs.push(base);
  const tvDir = join(base, 'tv');
  mkdirSync(join(tvDir, 'android'), { recursive: true });
  mkdirSync(join(tvDir, 'tizen', 'web'), { recursive: true });
  writeFileSync(join(tvDir, 'android', 'app.apk'), 'apk');
  writeFileSync(join(tvDir, 'tizen', 'web', 'index.html'), 'html');
  writeFileSync(
    join(tvDir, 'manifest.json'),
    JSON.stringify({
      version: '1.0.0',
      android: {
        file: 'android/app.apk',
        sha256: sha('apk'),
        applicationId: 'com.jakubkonkol.adrenaline.tv',
        activity: 'com.jakubkonkol.adrenaline.tv/.MainActivity',
        signing: 'release',
      },
      tizen: {
        dir: 'tizen/web',
        packageId: 'AdrnlnTV01',
        appId: 'AdrnlnTV01.Adrenaline',
        files: [{ path: 'index.html', sha256: sha('html') }],
      },
    }),
  );
  const calls: { exe: string; args: string[]; input?: string }[] = [];
  const run: ProcessRunner = (exe, args, opts) => {
    calls.push({ exe, args, ...(opts.input !== undefined ? { input: opts.input } : {}) });
    if (opts.signal?.aborted) return Promise.resolve({ code: null, stdout: '', stderr: '', timedOut: false });
    // `tizen package` writes the signed widget into the -o folder.
    if (args[0] === 'package') {
      const out = args[args.indexOf('-o') + 1]!;
      writeFileSync(join(out, 'Adrenaline.wgt'), 'wgt');
    }
    return Promise.resolve(responder(exe, args, opts.input));
  };
  const logged: string[] = [];
  const log: Logger = { ...nullLogger, info: (m: string) => void logged.push(m), child: () => log };
  const toolchain: TvToolchain = {
    adb: 'C:/sdk/adb.exe',
    sdb: 'C:/tizen-studio/tools/sdb.exe',
    tizen: 'C:/tizen-studio/tools/ide/bin/tizen.bat',
    tizenStudio: 'C:/tizen-studio',
    profiles: ['myprofile'],
  };
  const deploy = new DeployService({
    tvDir,
    workDir: join(base, 'work'),
    toolchain: () => toolchain,
    serverUrl: () => 'http://192.168.1.20:18790',
    waitForTv: () => Promise.resolve(tvSeen),
    log,
    run,
    sleep: () => Promise.resolve(),
    userWaitMs: 50,
  });
  const states: TvDeployState[] = [];
  deploy.on('state', (s) => states.push(s));
  const finished = () =>
    new Promise<TvDeployState>((resolve) => {
      const check = () => {
        const s = deploy.state;
        if (s && ['done', 'error', 'cancelled'].includes(s.status)) resolve(s);
        else setTimeout(check, 2);
      };
      check();
    });
  return { deploy, calls, states, finished, logged, base, toolchain };
}

const androidOk = (exe: string, args: string[]): RunResult => {
  if (args[0] === 'pair') return ok('Successfully paired to 192.168.1.40:37000 [guid=adb-x]');
  if (args[0] === 'connect') return ok('connected to 192.168.1.40:5555');
  if (args.includes('get-state')) return ok('device\n');
  if (args.includes('install')) return ok('Performing Streamed Install\nSuccess\n');
  if (args.includes('am')) return ok('Starting: Intent { cmp=com.jakubkonkol.adrenaline.tv/.MainActivity }');
  return ok('');
};

describe('Deploy to TV — Android (D-84)', () => {
  it('pairs with the code through stdin, installs the verified APK on that TV only and launches it with the PC address', async () => {
    const { deploy, calls, states, finished, logged } = setup(androidOk);
    deploy.start({
      platform: 'android',
      address: '192.168.1.40',
      port: 5555,
      pairing: { port: 37000, code: '482913' },
    });
    const end = await finished();
    expect(end).toMatchObject({ status: 'done', step: 'handshake' });
    expect(calls[0]).toMatchObject({ args: ['pair', '192.168.1.40:37000'], input: '482913' });
    expect(JSON.stringify(calls.map((c) => c.args))).not.toContain('482913');
    expect(logged.join('\n')).not.toContain('482913');
    for (const c of calls.slice(2)) expect(c.args.slice(0, 2)).toEqual(['-s', '192.168.1.40:5555']);
    expect(calls.find((c) => c.args.includes('install'))?.args).toEqual([
      '-s',
      '192.168.1.40:5555',
      'install',
      '-r',
      expect.stringMatching(/app\.apk$/),
    ]);
    expect(calls.at(-1)?.args).toEqual([
      ...['-s', '192.168.1.40:5555', 'shell', 'am', 'start', '-n', 'com.jakubkonkol.adrenaline.tv/.MainActivity'],
      ...['--es', 'server', 'http://192.168.1.20:18790'],
    ]);
    expect(states.map((s) => s.step)).toEqual(
      expect.arrayContaining([
        'preflight',
        'pairing',
        'connecting',
        'authorizing',
        'installing',
        'launching',
        'handshake',
      ]),
    );
  });

  it('asks the user to accept the debugging prompt, then gives up with a clear code', async () => {
    const { deploy, finished, states } = setup((exe, args) =>
      args.includes('get-state') ? { ...ok(''), stderr: 'error: device unauthorized.' } : androidOk(exe, args),
    );
    deploy.start({ platform: 'android', address: '192.168.1.40', port: 5555, pairing: null });
    expect(await finished()).toMatchObject({ status: 'error', errorCode: 'DEPLOY_UNAUTHORIZED', step: 'authorizing' });
    expect(states.some((s) => s.status === 'action' && s.step === 'authorizing')).toBe(true);
  });

  it.each([
    ['Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Package signatures do not match]', 'DEPLOY_SIGNATURE_MISMATCH'],
    ['Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]', 'DEPLOY_NO_SPACE'],
    ['Failure [INSTALL_FAILED_OLDER_SDK]', 'DEPLOY_INSTALL_FAILED'],
  ])('maps "%s" to %s and never uninstalls', async (failure, code) => {
    const { deploy, finished, calls } = setup((exe, args) =>
      args.includes('install') ? ok(failure) : androidOk(exe, args),
    );
    deploy.start({ platform: 'android', address: '192.168.1.40', port: 5555, pairing: null });
    expect(await finished()).toMatchObject({ status: 'error', errorCode: code });
    expect(calls.some((c) => c.args.includes('uninstall'))).toBe(false);
  });

  it('reports an unreachable TV and a wrong pairing code', async () => {
    const refused = setup((exe, args) =>
      args[0] === 'connect' ? ok('failed to connect to 192.168.1.40:5555: Connection refused') : androidOk(exe, args),
    );
    refused.deploy.start({ platform: 'android', address: '192.168.1.40', port: 5555, pairing: null });
    expect(await refused.finished()).toMatchObject({ errorCode: 'DEPLOY_CONNECT_FAILED' });
    const wrong = setup((exe, args) =>
      args[0] === 'pair' ? ok('Failed: Wrong password or connection was dropped.') : androidOk(exe, args),
    );
    wrong.deploy.start({
      platform: 'android',
      address: '192.168.1.40',
      port: 5555,
      pairing: { port: 1, code: '000000' },
    });
    expect(await wrong.finished()).toMatchObject({ errorCode: 'DEPLOY_UNAUTHORIZED' });
  });

  it('refuses a damaged package and a missing tool before touching the TV', async () => {
    const { deploy, finished, calls, base } = setup(androidOk);
    writeFileSync(join(base, 'tv', 'android', 'app.apk'), 'tampered');
    deploy.start({ platform: 'android', address: '192.168.1.40', port: 5555, pairing: null });
    expect(await finished()).toMatchObject({ errorCode: 'DEPLOY_PACKAGE_MISSING' });
    expect(calls).toHaveLength(0);
    const noAdb = setup(androidOk);
    noAdb.toolchain.adb = null;
    noAdb.deploy.start({ platform: 'android', address: '192.168.1.40', port: 5555, pairing: null });
    expect(await noAdb.finished()).toMatchObject({ errorCode: 'DEPLOY_TOOL_MISSING' });
  });

  it('can be cancelled, and the app waiting for pairing is not a failure of the install', async () => {
    const { deploy, finished } = setup(androidOk, false);
    deploy.start({ platform: 'android', address: '192.168.1.40', port: 5555, pairing: null });
    expect(await finished()).toMatchObject({ status: 'error', errorCode: 'DEPLOY_TIMEOUT', step: 'handshake' });
    const slow = setup((exe, args) => androidOk(exe, args));
    slow.deploy.start({ platform: 'android', address: '192.168.1.40', port: 5555, pairing: null });
    slow.deploy.cancel();
    expect(await slow.finished()).toMatchObject({ status: 'cancelled', errorCode: 'DEPLOY_CANCELLED' });
  });
});

describe('Deploy to TV — Samsung Tizen (D-84)', () => {
  const tizenOk = (exe: string, args: string[]): RunResult => {
    if (args[0] === 'connect') return ok('connecting to 192.168.1.50:26101 ...\nconnected to 192.168.1.50:26101');
    if (args[0] === 'devices')
      return ok(
        'List of devices attached\n192.168.1.51:26101   device   OTHER\n192.168.1.50:26101   device   QE55Q80A\n',
      );
    if (args.includes('getduid')) return ok('7DCAYFTRK6RGO\n');
    if (args[0] === 'package') return ok('Package File Location: C:\\work\\out\\Adrenaline.wgt');
    if (args[0] === 'install')
      return ok(
        'Installing the package...\nTizen application is successfully installed.\nInstalled the package: Id(AdrnlnTV01)',
      );
    return ok('');
  };

  it('signs with the chosen profile, installs on that TV with the PC address inside and reads the DUID', async () => {
    const { deploy, finished, calls, base } = setup(tizenOk);
    deploy.start({ platform: 'tizen', address: '192.168.1.50', profile: 'myprofile' });
    const end = await finished();
    expect(end).toMatchObject({ status: 'done', duid: '7DCAYFTRK6RGO' });
    const pack = calls.find((c) => c.args[0] === 'package')!;
    expect(pack.args.slice(0, 5)).toEqual(['package', '-t', 'wgt', '-s', 'myprofile']);
    expect(calls.find((c) => c.args[0] === 'install')?.args).toEqual([
      'install',
      '-n',
      'Adrenaline.wgt',
      '-t',
      'QE55Q80A',
      '--',
      expect.stringMatching(/out$/),
    ]);
    const server = JSON.parse(readFileSync(join(base, 'work', 'tizen', 'web', 'server.json'), 'utf8')) as {
      server: string;
    };
    expect(server.server).toBe('http://192.168.1.20:18790');
    expect(calls.at(-1)?.args).toEqual(['-s', '192.168.1.50:26101', 'shell', '0', 'execute', 'AdrnlnTV01.Adrenaline']);
  });

  it('explains certificate problems (unknown profile, wrong distributor/DUID)', async () => {
    const unknown = setup(tizenOk);
    unknown.deploy.start({ platform: 'tizen', address: '192.168.1.50', profile: 'other' });
    expect(await unknown.finished()).toMatchObject({ errorCode: 'DEPLOY_CERTIFICATE' });
    const wrong = setup((exe, args) =>
      args[0] === 'install'
        ? ok(
            'install failed[118, -12], reason: Check certificate error : Invalid certificate chain with certificate in signature.',
          )
        : tizenOk(exe, args),
    );
    wrong.deploy.start({ platform: 'tizen', address: '192.168.1.50', profile: 'myprofile' });
    expect(await wrong.finished()).toMatchObject({ errorCode: 'DEPLOY_CERTIFICATE', step: 'installing' });
  });

  it('stops when the TV is not in developer mode (connection refused)', async () => {
    const { deploy, finished } = setup((exe, args) =>
      args[0] === 'connect' ? ok('failed to connect to 192.168.1.50:26101') : tizenOk(exe, args),
    );
    deploy.start({ platform: 'tizen', address: '192.168.1.50', profile: 'myprofile' });
    expect(await finished()).toMatchObject({ errorCode: 'DEPLOY_CONNECT_FAILED', step: 'connecting' });
  });
});

describe('deploy tools', () => {
  it('finds adb and Tizen Studio with its certificate profiles', () => {
    const files: Record<string, string> = {
      'C:\\tizen-studio\\tools\\sdb.exe': '',
      'C:\\tizen-studio\\tools\\ide\\bin\\tizen.bat': '',
      'C:\\tizen-studio\\sdk.info': 'TIZEN_SDK_INSTALLED_PATH=C:\\tizen-studio\nTIZEN_SDK_DATA_PATH=D:\\tizen-data\n',
      'D:\\tizen-data\\profile\\profiles.xml':
        '<profiles active="tv"><profile name="tv"><profileitem/></profile><profile name="bad name&"/></profiles>',
      'C:\\Users\\me\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe': '',
    };
    const t = detectToolchain({
      adbPath: '',
      tizenStudioPath: '',
      env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', PATH: '' },
      platform: 'win32',
      exists: (p) => p.replace(/\//g, '\\') in files,
      readFile: (p) => files[p.replace(/\//g, '\\')] ?? null,
    });
    if (process.platform !== 'win32') return; // path joining differs outside Windows
    expect(t).toMatchObject({
      adb: 'C:\\Users\\me\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe',
      sdb: 'C:\\tizen-studio\\tools\\sdb.exe',
      tizen: 'C:\\tizen-studio\\tools\\ide\\bin\\tizen.bat',
      profiles: ['tv'],
    });
  });

  it('builds a cmd.exe line for the Tizen CLI and refuses shell metacharacters', () => {
    expect(
      cmdLine('C:\\tizen-studio\\tools\\ide\\bin\\tizen.bat', [
        'package',
        '-s',
        'tv',
        '-o',
        'C:\\Users\\Jan Kowalski\\out',
      ]),
    ).toBe('"C:\\tizen-studio\\tools\\ide\\bin\\tizen.bat package -s tv -o "C:\\Users\\Jan Kowalski\\out""');
    for (const bad of ['a&calc', 'x|y', '%PATH%', 'a"b', 'a^b', 'a\nb', 'a<b'])
      expect(() => cmdLine('C:\\t\\tizen.bat', [bad]), bad).toThrow();
  });
});
