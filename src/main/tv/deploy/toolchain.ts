import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import type { TvToolchain } from '@shared/contracts/tv';

export interface ToolchainEnv {
  /** Paths chosen by the user in the TV tab (empty = detect). */
  adbPath: string;
  tizenStudioPath: string;
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
  readFile?: (path: string) => string | null;
}

/**
 * Deploy tools from official installations (D-84): Android platform-tools (adb) and Tizen Studio (sdb, the tizen CLI
 * and the certificate profiles made in its Certificate Manager). Nothing is downloaded or bundled.
 */
export function detectToolchain(opts: ToolchainEnv): TvToolchain {
  const win = (opts.platform ?? process.platform) === 'win32';
  const exists = opts.exists ?? existsSync;
  const read =
    opts.readFile ??
    ((p: string) => {
      try {
        return readFileSync(p, 'utf8');
      } catch {
        return null;
      }
    });
  const env = opts.env;
  const exe = (name: string) => (win ? `${name}.exe` : name);
  const pathDirs = (env['PATH'] ?? env['Path'] ?? '').split(delimiter).filter(Boolean);

  const adbCandidates = [
    opts.adbPath,
    ...pathDirs.map((d) => join(d, exe('adb'))),
    env['ANDROID_HOME'] && join(env['ANDROID_HOME'], 'platform-tools', exe('adb')),
    env['ANDROID_SDK_ROOT'] && join(env['ANDROID_SDK_ROOT'], 'platform-tools', exe('adb')),
    env['LOCALAPPDATA'] && join(env['LOCALAPPDATA'], 'Android', 'Sdk', 'platform-tools', exe('adb')),
  ].filter((p): p is string => !!p);
  const adb = adbCandidates.find((p) => exists(p)) ?? null;

  const studioCandidates = [
    opts.tizenStudioPath,
    win ? 'C:\\tizen-studio' : null,
    env['USERPROFILE'] && join(env['USERPROFILE'], 'tizen-studio'),
    env['HOME'] && join(env['HOME'], 'tizen-studio'),
  ].filter((p): p is string => !!p);
  const studio = studioCandidates.find((p) => exists(join(p, 'tools', exe('sdb')))) ?? null;
  const sdb = studio ? join(studio, 'tools', exe('sdb')) : null;
  const cli = studio ? join(studio, 'tools', 'ide', 'bin', win ? 'tizen.bat' : 'tizen') : null;
  const tizen = cli && exists(cli) ? cli : null;

  // Certificate profiles: <data>/profile/profiles.xml, the data folder is named in <studio>/sdk.info.
  let profiles: string[] = [];
  if (studio) {
    const info = read(join(studio, 'sdk.info')) ?? '';
    const dataDir = /TIZEN_SDK_DATA_PATH=(.+)/.exec(info)?.[1]?.trim() ?? join(dirname(studio), 'tizen-studio-data');
    const xml = read(join(dataDir, 'profile', 'profiles.xml')) ?? '';
    profiles = [...xml.matchAll(/<profile\s+name="([^"]+)"/g)].map((m) => m[1]!).filter((n) => /^[\w-]{1,64}$/.test(n));
  }
  return { adb, sdb, tizen, tizenStudio: studio, profiles };
}
