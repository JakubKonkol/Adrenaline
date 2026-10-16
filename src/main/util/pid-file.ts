import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from '../logger';

export interface ProcessProbe {
  /** Executable name of a running process (e.g. `JackettConsole.exe`), null when there is no such process. */
  imageName(pid: number): string | null;
  kill(pid: number): void;
}

/** Windows: `tasklist` (no shell); Linux (dev container): `/proc/<pid>/comm`. */
export const systemProbe: ProcessProbe = {
  imageName(pid) {
    try {
      if (process.platform === 'win32') {
        const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 5_000,
        });
        const match = /^"([^"]+)","(\d+)"/m.exec(out);
        return match && Number(match[2]) === pid ? match[1]! : null;
      }
      return readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
    } catch {
      return null;
    }
  },
  kill(pid) {
    process.kill(pid);
  },
};

/** Linux truncates `comm` to 15 characters; Windows names are case-insensitive. */
export function sameImage(actual: string, expected: string): boolean {
  const a = actual.toLowerCase();
  const e = expected.toLowerCase();
  return a === e || (a.length === 15 && e.startsWith(a)) || a === e.replace(/\.exe$/, '');
}

/**
 * Helper processes record their PID next to their data. If Adrenaline crashed or was killed, the previous helper may
 * still run (Jackett does not watch its parent). On the next start the leftover is stopped — only when the PID still
 * belongs to a process with the expected executable name, so a reused PID of another program is never touched.
 */
export function killStaleProcess(pidFile: string, expectedImage: string, log: Logger, probe = systemProbe): boolean {
  let pid: number;
  try {
    pid = Number(readFileSync(pidFile, 'utf8').trim());
  } catch {
    return false;
  }
  rmSync(pidFile, { force: true });
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  const image = probe.imageName(pid);
  if (!image || !sameImage(image, expectedImage)) return false;
  try {
    probe.kill(pid);
    log.warn(`stopped a leftover ${expectedImage} (pid ${pid}) from a previous run`);
    return true;
  } catch (error) {
    log.warn(`could not stop a leftover ${expectedImage} (pid ${pid})`, error);
    return false;
  }
}

export function writePidFile(pidFile: string, pid: number | undefined): void {
  if (!pid) return;
  try {
    mkdirSync(dirname(pidFile), { recursive: true });
    writeFileSync(pidFile, String(pid));
  } catch {
    /* best effort: only used to clean up after a crash */
  }
}

export function clearPidFile(pidFile: string): void {
  rmSync(pidFile, { force: true });
}
