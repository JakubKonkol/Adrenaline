import { afterEach, describe, expect, it } from 'vitest';
import { clearRegisteredSecrets, redact, registerSecret } from './redact';

afterEach(() => clearRegisteredSecrets());

describe('redact', () => {
  it('masks magnets', () => {
    expect(redact('add magnet:?xt=urn:btih:abcdef&dn=Film now')).toBe('add magnet:?<redacted> now');
  });

  it('masks bearer tokens, query keys and JSON secrets', () => {
    expect(redact('Authorization: Bearer eyJhbGciOi.abc.def')).toBe('Authorization: <redacted>');
    expect(redact('sent Bearer abc.def')).toBe('sent Bearer <redacted>');
    expect(redact('GET /api?t=caps&apikey=12345abc&q=x')).toBe('GET /api?t=caps&apikey=<redacted>&q=x');
    expect(redact('{"username":"u","password":"hunter22"}')).toBe('{"username":"u","password":"<redacted>"}');
    expect(redact('Api-Key: abcdef123')).toBe('Api-Key: <redacted>');
  });

  it('masks registered secret values anywhere', () => {
    registerSecret('s3cr3t-value');
    expect(redact('error with s3cr3t-value inside')).toBe('error with <secret> inside');
  });

  it('replaces the home directory and other user folders', () => {
    expect(redact('C:\\Users\\Jakub\\Videos\\x.mkv', { homeDir: 'C:\\Users\\Jakub' })).toBe('~\\Videos\\x.mkv');
    expect(redact('C:/Users/Jakub/Videos', { homeDir: 'C:\\Users\\Jakub' })).toBe('~/Videos');
    expect(redact('D:\\Users\\Other\\file')).toBe('D:\\Users\\<user>\\file');
    expect(redact('/home/alice/.config')).toBe('/home/<user>/.config');
  });
});
