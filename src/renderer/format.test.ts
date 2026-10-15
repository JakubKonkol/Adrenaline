import { describe, expect, it } from 'vitest';
import { formatAgo, formatBytes } from './format';

describe('formatBytes', () => {
  it.each([
    [null, null],
    [0, '0 B'],
    [1023, '1023 B'],
    [1536, '1,5 KB'],
    [1288490189, '1,2 GB'],
    [150 * 1024 * 1024, '150 MB'],
  ])('%s → %s', (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });
});

describe('formatAgo', () => {
  const now = 10_000_000_000;
  it.each([
    [now - 5_000, 'przed chwilą'],
    [now - 5 * 60_000, '5 min temu'],
    [now - 3 * 3600_000, '3 godz. temu'],
    [now - 26 * 3600_000, 'wczoraj'],
    [now - 4 * 86400_000, '4 dni temu'],
  ])('%s', (ts, expected) => {
    expect(formatAgo(ts, now)).toBe(expected);
  });
});
