import { afterEach, describe, expect, it } from 'vitest';
import { nullLogger } from '../logger';
import { type Database, openDatabase } from '../persistence/db';
import { clearRegisteredSecrets, redact } from '../redact';
import { Secrets, type SafeStorageLike } from '../secrets';
import { SettingsService } from './settings-service';

const defaults = { downloadDir: 'C:\\Users\\u\\Videos\\Adrenaline', randomPort: () => 50001 };
let db: Database;
afterEach(() => {
  db?.close();
  clearRegisteredSecrets();
});

describe('SettingsService', () => {
  it('starts with defaults and stores a random port once', () => {
    db = openDatabase(':memory:', { log: nullLogger });
    const s = new SettingsService(db, defaults);
    expect(s.get()).toMatchObject({
      downloadDir: defaults.downloadDir,
      subtitleLang: 'en',
      maxActiveDownloads: 3,
      seedRatioLimit: 1,
      seedTimeLimitMin: 60,
      closeToTray: true,
      listenPort: 50001,
    });
    const again = new SettingsService(db, { ...defaults, randomPort: () => 60000 });
    expect(again.get().listenPort).toBe(50001);
  });

  it('persists valid updates and notifies listeners', () => {
    db = openDatabase(':memory:', { log: nullLogger });
    const s = new SettingsService(db, defaults);
    const seen: unknown[] = [];
    s.on('changed', (c) => seen.push(c.patch));
    s.update({ subtitleLang: 'en', maxActiveDownloads: 5, onboardingDone: true });
    expect(new SettingsService(db, defaults).get()).toMatchObject({
      subtitleLang: 'en',
      maxActiveDownloads: 5,
      onboardingDone: true,
    });
    expect(seen).toEqual([{ subtitleLang: 'en', maxActiveDownloads: 5, onboardingDone: true }]);
  });

  it('rejects invalid patches without writing', () => {
    db = openDatabase(':memory:', { log: nullLogger });
    const s = new SettingsService(db, defaults);
    expect(() => s.update({ maxActiveDownloads: 0 })).toThrow();
    expect(() => s.update({ unknownKey: 1 })).toThrow();
    expect(() => s.update({ subtitleLang: 'xx' })).toThrow();
    expect(new SettingsService(db, defaults).get().maxActiveDownloads).toBe(3);
  });

  it('ignores corrupted stored values', () => {
    db = openDatabase(':memory:', { log: nullLogger });
    db.prepare(
      "INSERT INTO settings (key, value_json) VALUES ('maxActiveDownloads', '\"lots\"'), ('closeToTray', '{bad')",
    ).run();
    const s = new SettingsService(db, defaults);
    expect(s.get().maxActiveDownloads).toBe(3);
    expect(s.get().closeToTray).toBe(true);
  });
});

const fakeSafeStorage = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`),
  decryptString: (b) => Buffer.from(b.toString().slice(4), 'base64').toString(),
});

describe('Secrets', () => {
  it('stores encrypted values that survive a restart and are redacted in logs', () => {
    db = openDatabase(':memory:', { log: nullLogger });
    const secrets = new Secrets(db, fakeSafeStorage(), nullLogger);
    secrets.set('tmdb.token', '  my-tmdb-token  ');
    const row = db.prepare('SELECT ciphertext FROM secrets').get() as { ciphertext: Uint8Array };
    expect(Buffer.from(row.ciphertext).toString()).not.toContain('my-tmdb-token');
    clearRegisteredSecrets();
    const reopened = new Secrets(db, fakeSafeStorage(), nullLogger);
    expect(reopened.get('tmdb.token')).toBe('my-tmdb-token');
    expect(redact('token my-tmdb-token')).toBe('token <secret>');
    reopened.set('tmdb.token', '');
    expect(reopened.has('tmdb.token')).toBe(false);
  });

  it('keeps secrets in memory only when encryption is unavailable', () => {
    db = openDatabase(':memory:', { log: nullLogger });
    const secrets = new Secrets(db, fakeSafeStorage(false), nullLogger);
    secrets.set('opensubtitles.password', 'pass1234');
    expect(secrets.get('opensubtitles.password')).toBe('pass1234');
    expect(db.prepare('SELECT COUNT(*) AS n FROM secrets').get()).toEqual({ n: 0 });
    expect(new Secrets(db, fakeSafeStorage(false), nullLogger).has('opensubtitles.password')).toBe(false);
  });
});
