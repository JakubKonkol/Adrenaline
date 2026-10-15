import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPathTooLong, isSafeSegment, resolveInside, sanitizeFileName } from './safe-path';

const W = path.win32;
const BASE = 'C:\\Users\\Jakub\\Videos\\Adrenaline\\Film (2024)\\Release';

describe('resolveInside (Windows rules)', () => {
  it('resolves normal relative paths with either separator', () => {
    expect(resolveInside(BASE, 'Film.2024.1080p/Film.mkv', W)).toBe(`${BASE}\\Film.2024.1080p\\Film.mkv`);
    expect(resolveInside(BASE, 'Sub\\pl.srt', W)).toBe(`${BASE}\\Sub\\pl.srt`);
  });

  it('accepts Unicode names (NFR12)', () => {
    expect(resolveInside(BASE, 'Zażółć gęślą jaźń/Łódź.mkv', W)).toBe(`${BASE}\\Zażółć gęślą jaźń\\Łódź.mkv`);
    expect(resolveInside(BASE, '日本語/映画.mkv', W)).toBe(`${BASE}\\日本語\\映画.mkv`);
  });

  it.each([
    ['../evil.exe'],
    ['a/../../evil.exe'],
    ['..\\..\\Windows\\system32\\x.dll'],
    ['C:\\Windows\\x.exe'],
    ['c:relative.txt'],
    ['/etc/passwd'],
    ['\\\\server\\share\\x'],
    ['CON'],
    ['folder/nul.txt'],
    ['COM1.mkv'],
    ['lpt9'],
    ['a<b.mkv'],
    ['what?.mkv'],
    ['star*.mkv'],
    ['pipe|.mkv'],
    ['quote".mkv'],
    ['colon:stream.mkv'],
    ['trailing.'],
    ['trailing /x.mkv'],
    ['ctrl\u0001.mkv'],
    [''],
  ])('rejects %j', (rel) => {
    expect(() => resolveInside(BASE, rel, W)).toThrow(expect.objectContaining({ code: 'UNSAFE_TORRENT_PATH' }));
  });

  it('works with POSIX paths too (dev)', () => {
    expect(resolveInside('/home/u/dl', 'a/b.mkv', path.posix)).toBe('/home/u/dl/a/b.mkv');
    expect(() => resolveInside('/home/u/dl', '../x', path.posix)).toThrow();
  });
});

describe('sanitizeFileName', () => {
  it.each([
    ['Mission: Impossible', 'Mission - Impossible'],
    ['AC/DC: Live', 'AC-DC - Live'],
    ['What If...?', 'What If'],
    ['Szybcy i wściekli 7', 'Szybcy i wściekli 7'],
    ['  spaces   inside  ', 'spaces inside'],
    ['CON', '_CON'],
    ['"Quoted" <title>', "'Quoted' -title-"],
    ['???', 'Adrenaline'],
  ])('%j → %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('limits length and never ends with a dot or space', () => {
    const out = sanitizeFileName(`${'a'.repeat(119)} .`);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out).not.toMatch(/[. ]$/);
    expect(isSafeSegment(out)).toBe(true);
  });
});

describe('isPathTooLong', () => {
  it('warns above 240 characters', () => {
    expect(isPathTooLong('C:\\' + 'a'.repeat(237))).toBe(false);
    expect(isPathTooLong('C:\\' + 'a'.repeat(238))).toBe(true);
  });
});
