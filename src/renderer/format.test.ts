import { describe, expect, it } from 'vitest';
import { formatAgo, formatBytes, formatDuration, formatRate } from './format';

describe('formatBytes', () => {
  it.each([
    [null, null],
    [0, '0 B'],
    [1023, '1023 B'],
    [1536, '1.5 KB'],
    [1288490189, '1.2 GB'],
    [150 * 1024 * 1024, '150 MB'],
  ])('%s → %s', (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });
});

describe('formatAgo', () => {
  const now = 10_000_000_000;
  it.each([
    [now - 5_000, 'just now'],
    [now - 5 * 60_000, '5 min ago'],
    [now - 3 * 3600_000, '3 h ago'],
    [now - 26 * 3600_000, 'yesterday'],
    [now - 4 * 86400_000, '4 days ago'],
  ])('%s', (ts, expected) => {
    expect(formatAgo(ts, now)).toBe(expected);
  });
});

describe('formatRate / formatDuration', () => {
  it('formats speeds and durations', () => {
    expect(formatRate(1.5 * 1024 * 1024)).toBe('1.5 MB/s');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(240)).toBe('4 min');
    expect(formatDuration(7500)).toBe('2 h 5 min');
    expect(formatDuration(3 * 86400)).toBe('3 days');
  });
});
