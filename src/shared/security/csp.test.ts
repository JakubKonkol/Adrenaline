import { describe, expect, it } from 'vitest';
import { buildCsp } from './csp';

describe('buildCsp', () => {
  it('allows only own scripts and TMDB images in production', () => {
    const csp = buildCsp({ dev: false });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("img-src 'self' https://image.tmdb.org data:");
    expect(csp).toContain("connect-src 'self';");
    expect(csp).not.toContain('localhost');
  });

  it('adds the dev server only in dev', () => {
    expect(buildCsp({ dev: true })).toContain('ws://localhost:*');
  });
});
