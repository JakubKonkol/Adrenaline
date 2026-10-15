import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileLogger } from './logger';
import { clearRegisteredSecrets, registerSecret } from './redact';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'adr-log-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  clearRegisteredSecrets();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('createFileLogger', () => {
  it('writes redacted lines with level and scope', async () => {
    const dir = tmp();
    registerSecret('tmdb-token-123');
    const log = createFileLogger({ dir, now: () => new Date('2026-10-15T10:00:00Z') });
    log.child('tmdb').error('request failed with tmdb-token-123', { url: 'https://x/?api_key=abc' });
    await log.flush();
    const text = readFileSync(join(dir, 'adrenaline.log'), 'utf8');
    expect(text).toContain('2026-10-15T10:00:00.000Z ERROR [tmdb] request failed with <secret>');
    expect(text).toContain('api_key=<redacted>');
    expect(text).not.toContain('tmdb-token-123');
  });

  it('rotates at maxBytes and keeps maxFiles', async () => {
    const dir = tmp();
    const log = createFileLogger({ dir, maxBytes: 200, maxFiles: 3 });
    for (let i = 0; i < 40; i++) log.info(`line ${i} ${'x'.repeat(40)}`);
    await log.flush();
    const files = readdirSync(dir).sort();
    expect(files).toEqual(['adrenaline.log', 'adrenaline.log.1', 'adrenaline.log.2']);
    expect(readFileSync(join(dir, 'adrenaline.log'), 'utf8')).toContain('line 39');
  });
});
