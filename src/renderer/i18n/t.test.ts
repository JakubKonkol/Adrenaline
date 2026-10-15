import { describe, expect, it } from 'vitest';
import { t, tDynamic } from './t';

describe('t', () => {
  it('returns Polish strings', () => {
    expect(t('home.title')).toBe('Znajdź film lub odcinek');
  });

  it('replaces parameters', () => {
    expect(t('app.version', { version: '0.1.0' })).toBe('Wersja 0.1.0');
  });

  it('falls back for unknown dynamic keys', () => {
    expect(tDynamic('errors.NOPE.message', 'fallback')).toBe('fallback');
  });
});
