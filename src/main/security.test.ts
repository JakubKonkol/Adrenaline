import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ session: {}, shell: {} }));

const { createTrustedUrlCheck } = await import('./security');

describe('createTrustedUrlCheck', () => {
  const indexHtmlPath = resolve('out/renderer/index.html');
  const indexUrl = pathToFileURL(indexHtmlPath).href;

  it('accepts the packaged index.html with any hash route', () => {
    const check = createTrustedUrlCheck({ indexHtmlPath, devUrl: null });
    expect(check(indexUrl)).toBe(true);
    expect(check(`${indexUrl}#/settings`)).toBe(true);
    expect(check(indexUrl.replace('index.html', 'other.html'))).toBe(false);
    expect(check('https://example.com/')).toBe(false);
    expect(check('')).toBe(false);
  });

  it('accepts only the dev server origin in dev', () => {
    const check = createTrustedUrlCheck({ indexHtmlPath, devUrl: 'http://localhost:5173' });
    expect(check('http://localhost:5173/#/downloads')).toBe(true);
    expect(check('http://localhost:5174/')).toBe(false);
    expect(check(indexUrl)).toBe(false);
  });
});
