import { describe, expect, it } from 'vitest';
import { isAllowedExternalUrl } from './external-links';

describe('isAllowedExternalUrl', () => {
  it.each([
    ['https://www.themoviedb.org/settings/api', true],
    ['https://github.com/JakubKonkol/Adrenaline/releases', true],
    ['http://www.themoviedb.org/', false],
    ['https://evil.example/', false],
    ['https://user:pass@github.com/', false],
    ['file:///C:/Windows/system32/calc.exe', false],
    ['javascript:alert(1)', false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(isAllowedExternalUrl(url)).toBe(expected);
  });
});
