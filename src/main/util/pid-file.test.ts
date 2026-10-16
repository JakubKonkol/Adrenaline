import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { nullLogger } from '../logger';
import { clearPidFile, killStaleProcess, sameImage, writePidFile } from './pid-file';

function setup(content: string | null) {
  const dir = mkdtempSync(join(tmpdir(), 'adrenaline-pid-'));
  const file = join(dir, 'x.pid');
  if (content !== null) writeFileSync(file, content);
  return file;
}

describe('pid file', () => {
  it('stops a leftover process with the expected executable', () => {
    const file = setup('4242');
    const kill = vi.fn();
    expect(
      killStaleProcess(file, 'JackettConsole.exe', nullLogger, { imageName: () => 'JackettConsole.exe', kill }),
    ).toBe(true);
    expect(kill).toHaveBeenCalledWith(4242);
    expect(existsSync(file)).toBe(false);
  });

  it('never kills a reused PID that belongs to another program', () => {
    const file = setup('4242');
    const kill = vi.fn();
    expect(killStaleProcess(file, 'JackettConsole.exe', nullLogger, { imageName: () => 'chrome.exe', kill })).toBe(
      false,
    );
    expect(kill).not.toHaveBeenCalled();
    expect(existsSync(file)).toBe(false);
  });

  it('ignores a missing file, garbage and processes that are gone', () => {
    const kill = vi.fn();
    const probe = { imageName: () => null, kill };
    expect(killStaleProcess(setup(null), 'a.exe', nullLogger, probe)).toBe(false);
    expect(killStaleProcess(setup('not a pid'), 'a.exe', nullLogger, probe)).toBe(false);
    expect(killStaleProcess(setup('-1'), 'a.exe', nullLogger, probe)).toBe(false);
    expect(killStaleProcess(setup('4242'), 'a.exe', nullLogger, probe)).toBe(false);
    expect(kill).not.toHaveBeenCalled();
  });

  it('matches names case-insensitively and with the Linux 15-character comm limit', () => {
    expect(sameImage('jackettconsole.exe', 'JackettConsole.exe')).toBe(true);
    expect(sameImage('adrenaline-engi', 'adrenaline-engine')).toBe(true);
    expect(sameImage('adrenaline-engine', 'adrenaline-engine.exe')).toBe(true);
    expect(sameImage('node', 'JackettConsole.exe')).toBe(false);
  });

  it('writes and clears the file', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'adrenaline-pid-')), 'sub', 'y.pid');
    writePidFile(file, 77);
    expect(existsSync(file)).toBe(true);
    clearPidFile(file);
    expect(existsSync(file)).toBe(false);
    writePidFile(file, undefined);
    expect(existsSync(file)).toBe(false);
  });
});
