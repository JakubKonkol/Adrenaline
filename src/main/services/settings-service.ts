import {
  type AppSettings,
  appSettingsSchema,
  STATIC_DEFAULTS,
  type SettingsPatch,
  settingsPatchSchema,
} from '@shared/contracts/settings';
import { AppError } from '@shared/errors';
import type { Database } from '../persistence/db';
import { Emitter } from '../util/emitter';

export interface SettingsDefaults {
  downloadDir: string;
  /** Random port 49152–65535, generated once and stored. */
  randomPort: () => number;
}

/**
 * Settings stored as one row per key (JSON). Invalid stored values fall back to defaults; updates are validated
 * as a whole before anything is written. Listeners get the new settings (engine limits, theme, updater).
 */
export class SettingsService extends Emitter<{ changed: { settings: AppSettings; patch: SettingsPatch } }> {
  private cache: AppSettings;

  constructor(
    private readonly db: Database,
    defaults: SettingsDefaults,
  ) {
    super();
    const stored = this.readAll();
    const base: AppSettings = { ...STATIC_DEFAULTS, downloadDir: defaults.downloadDir, listenPort: 0 };
    const merged: Record<string, unknown> = { ...base };
    const shape = appSettingsSchema.shape;
    for (const [key, value] of Object.entries(stored)) {
      if (!(key in shape)) continue;
      const parsed = shape[key as keyof typeof shape].safeParse(value);
      if (parsed.success) merged[key] = parsed.data;
    }
    if (merged['listenPort'] === 0) {
      merged['listenPort'] = defaults.randomPort();
      this.write({ listenPort: merged['listenPort'] as number });
    }
    this.cache = appSettingsSchema.parse(merged);
  }

  get(): AppSettings {
    return this.cache;
  }

  update(patch: unknown): AppSettings {
    const parsedPatch = settingsPatchSchema.safeParse(patch);
    if (!parsedPatch.success) throw new AppError('BAD_REQUEST', parsedPatch.error.issues[0]?.message ?? 'invalid');
    const next = appSettingsSchema.safeParse({ ...this.cache, ...parsedPatch.data });
    if (!next.success) throw new AppError('BAD_REQUEST', next.error.issues[0]?.message ?? 'invalid');
    this.write(parsedPatch.data);
    this.cache = next.data;
    this.emit('changed', { settings: this.cache, patch: parsedPatch.data });
    return this.cache;
  }

  private readAll(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT key, value_json FROM settings').all() as { key: string; value_json: string }[];
    const out: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        out[row.key] = JSON.parse(row.value_json);
      } catch {
        // ignore a corrupted value: the default applies
      }
    }
    return out;
  }

  private write(patch: Partial<AppSettings>): void {
    const stmt = this.db.prepare(
      'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json',
    );
    this.db.exec('BEGIN');
    try {
      for (const [key, value] of Object.entries(patch)) stmt.run(key, JSON.stringify(value));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

export function randomListenPort(): number {
  return 49152 + Math.floor(Math.random() * (65535 - 49152));
}
