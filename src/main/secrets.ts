import type { Logger } from './logger';
import type { Database } from './persistence/db';
import { registerSecret } from './redact';

/** The part of Electron's `safeStorage` used here (injected for tests). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/**
 * Secrets (etap 3.3): API keys, passwords and tokens encrypted with `safeStorage` (DPAPI on Windows) in the
 * `secrets` table. Without encryption they are kept in memory for the session only. Every value is registered for
 * log redaction. Values never leave main: the renderer can only set them and ask whether they exist.
 */
export class Secrets {
  private readonly memory = new Map<string, string>();
  readonly encryptionAvailable: boolean;

  constructor(
    private readonly db: Database,
    private readonly safeStorage: SafeStorageLike,
    private readonly log: Logger,
  ) {
    this.encryptionAvailable = safeStorage.isEncryptionAvailable();
    if (!this.encryptionAvailable)
      log.warn('safeStorage encryption unavailable: secrets are kept for this session only');
    for (const name of this.storedNames()) {
      const value = this.get(name);
      if (value) registerSecret(value);
    }
  }

  private storedNames(): string[] {
    return (this.db.prepare('SELECT name FROM secrets').all() as { name: string }[]).map((r) => r.name);
  }

  get(name: string): string | null {
    if (this.memory.has(name)) return this.memory.get(name) ?? null;
    if (!this.encryptionAvailable) return null;
    const row = this.db.prepare('SELECT ciphertext FROM secrets WHERE name = ?').get(name) as
      { ciphertext: Uint8Array } | undefined;
    if (!row) return null;
    try {
      const value = this.safeStorage.decryptString(Buffer.from(row.ciphertext));
      this.memory.set(name, value);
      return value;
    } catch (error) {
      this.log.warn(`cannot decrypt secret ${name}`, error);
      return null;
    }
  }

  has(name: string): boolean {
    return this.get(name) !== null;
  }

  /** Sets (or with null/empty removes) a secret. */
  set(name: string, value: string | null): void {
    const trimmed = value?.trim() ?? '';
    if (!trimmed) {
      this.memory.delete(name);
      this.db.prepare('DELETE FROM secrets WHERE name = ?').run(name);
      return;
    }
    registerSecret(trimmed);
    this.memory.set(name, trimmed);
    if (!this.encryptionAvailable) return;
    const ciphertext = this.safeStorage.encryptString(trimmed);
    this.db
      .prepare(
        `INSERT INTO secrets (name, ciphertext, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
      )
      .run(name, ciphertext, Date.now());
  }
}
