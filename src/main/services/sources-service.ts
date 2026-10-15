import { randomUUID } from 'node:crypto';
import type { AddCustomSource, Source } from '@shared/contracts/sources';
import { AppError } from '@shared/errors';
import { builtinSourceId, DEFAULT_INDEXERS, indexerIdOf } from '../jackett/default-indexers';
import type { JackettManager } from '../jackett/jackett-manager';
import type { Logger } from '../logger';
import type { SourceRow, SourcesRepository } from '../persistence/repositories/sources';
import { isValidEndpoint, type TorznabClient, type TorznabSource } from '../providers/torznab/torznab-client';
import type { Secrets } from '../secrets';

export interface SearchableSources {
  sources: TorznabSource[];
  /** Enabled sources that cannot be searched now (e.g. Jackett down), with the reason. */
  failed: { id: string; name: string; code: string }[];
}

const codeOf = (error: unknown) => (error instanceof AppError ? error.code : 'INTERNAL');

/**
 * Sources (FR18): built-in Jackett indexers (D-53, configured through the admin API, D-57) and the user's own
 * Torznab endpoints (D-52). Each keeps its last health check.
 */
export class SourcesService {
  private synced = false;

  constructor(
    private readonly deps: {
      repo: SourcesRepository;
      jackett: JackettManager;
      secrets: Secrets;
      torznab: TorznabClient;
      log: Logger;
      now?: () => number;
    },
  ) {}

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  private toDto(row: SourceRow | null, fallback?: { id: string; name: string; description: string }): Source {
    const description = DEFAULT_INDEXERS.find((d) => builtinSourceId(d.id) === (row?.id ?? fallback?.id))?.description;
    return {
      id: row?.id ?? fallback!.id,
      kind: row?.kind ?? 'jackett_builtin',
      name: row?.name ?? fallback!.name,
      ...(description ? { description } : {}),
      enabled: row?.enabled ?? false,
      health: row?.health ?? 'unknown',
      healthCode: row?.healthCode ?? null,
      checkedAt: row?.checkedAt ?? null,
      endpoint: row?.kind === 'torznab_custom' ? row.endpoint : null,
      hasApiKey: row?.apiKeySecret ? this.deps.secrets.has(row.apiKeySecret) : false,
    };
  }

  list(): Source[] {
    const rows = this.deps.repo.all();
    const defaults = DEFAULT_INDEXERS.map((d) => {
      const id = builtinSourceId(d.id);
      return this.toDto(rows.find((r) => r.id === id) ?? null, { id, name: d.name, description: d.description });
    });
    const others = rows.filter((r) => !defaults.some((d) => d.id === r.id)).map((r) => this.toDto(r));
    return [...defaults, ...others];
  }

  private builtinRow(id: string): SourceRow {
    const existing = this.deps.repo.get(id);
    if (existing) return existing;
    const indexerId = indexerIdOf(id);
    const known = DEFAULT_INDEXERS.find((d) => d.id === indexerId);
    if (!indexerId || !known) throw new AppError('NOT_FOUND', 'unknown source');
    return {
      id,
      kind: 'jackett_builtin',
      name: known.name,
      endpoint: null,
      indexerId,
      enabled: false,
      apiKeySecret: null,
      health: 'unknown',
      healthCode: null,
      checkedAt: null,
      createdAt: this.now(),
    };
  }

  async setEnabled(id: string, enabled: boolean): Promise<Source[]> {
    const row = id.startsWith('jackett:') ? this.builtinRow(id) : this.deps.repo.get(id);
    if (!row) throw new AppError('NOT_FOUND', 'unknown source');
    if (row.kind === 'jackett_builtin' && row.indexerId) {
      if (enabled) {
        const { admin } = await this.deps.jackett.ensureRunning();
        try {
          await admin.addIndexer(row.indexerId);
        } catch (error) {
          this.deps.repo.upsert({
            ...row,
            enabled: false,
            health: 'error',
            healthCode: codeOf(error),
            checkedAt: this.now(),
          });
          throw error;
        }
        this.deps.repo.upsert({ ...row, enabled: true, health: 'ok', healthCode: null, checkedAt: this.now() });
      } else {
        this.deps.repo.upsert({ ...row, enabled: false });
        if (this.deps.jackett.status.state === 'running') {
          const { admin } = await this.deps.jackett.ensureRunning();
          await admin
            .removeIndexer(row.indexerId)
            .catch((e: unknown) => this.deps.log.warn('remove indexer failed', e));
        }
      }
    } else {
      this.deps.repo.upsert({ ...row, enabled });
    }
    return this.list();
  }

  private async toTorznab(row: SourceRow): Promise<TorznabSource> {
    if (row.kind === 'jackett_builtin') {
      const conn = await this.deps.jackett.ensureRunning();
      await this.syncBuiltins();
      return {
        id: row.id,
        name: row.name,
        endpoint: `${conn.baseUrl}/api/v2.0/indexers/${encodeURIComponent(row.indexerId ?? '')}/results/torznab/api`,
        apiKey: () => conn.apiKey,
      };
    }
    const secret = row.apiKeySecret;
    return {
      id: row.id,
      name: row.name,
      endpoint: row.endpoint ?? '',
      apiKey: () => (secret ? this.deps.secrets.get(secret) : null),
    };
  }

  /** After Jackett (re)starts: enabled built-in indexers missing in its data folder are added again. */
  private async syncBuiltins(): Promise<void> {
    if (this.synced) return;
    const { admin } = await this.deps.jackett.ensureRunning();
    const configured = new Set((await admin.listIndexers(true)).map((i) => i.id));
    for (const row of this.deps.repo.all()) {
      if (row.kind !== 'jackett_builtin' || !row.enabled || !row.indexerId || configured.has(row.indexerId)) continue;
      try {
        await admin.addIndexer(row.indexerId);
      } catch (error) {
        this.recordHealth(row.id, codeOf(error));
      }
    }
    this.synced = true;
  }

  /** Called when Jackett restarted (its data may have been reset). */
  resetSync(): void {
    this.synced = false;
  }

  async searchable(): Promise<SearchableSources> {
    const out: SearchableSources = { sources: [], failed: [] };
    for (const row of this.deps.repo.all().filter((r) => r.enabled)) {
      try {
        out.sources.push(await this.toTorznab(row));
      } catch (error) {
        out.failed.push({ id: row.id, name: row.name, code: codeOf(error) });
      }
    }
    return out;
  }

  /** Records the outcome of a search or test (null = ok). */
  recordHealth(id: string, code: string | null): void {
    this.deps.repo.setHealth(id, code ? 'error' : 'ok', code, this.now());
  }

  /** "Sprawdź połączenie": caps + an empty search. */
  async test(id: string): Promise<Source> {
    const row = this.deps.repo.get(id);
    if (!row) throw new AppError('NOT_FOUND', 'source not configured');
    try {
      const source = await this.toTorznab(row);
      await this.deps.torznab.caps(source);
      await this.deps.torznab.search(source, { t: 'search', q: '' });
      this.recordHealth(id, null);
    } catch (error) {
      this.recordHealth(id, codeOf(error));
    }
    return this.list().find((s) => s.id === id)!;
  }

  async addCustom(input: AddCustomSource): Promise<Source[]> {
    if (!isValidEndpoint(input.endpoint)) throw new AppError('BAD_REQUEST', 'endpoint must be http(s)');
    const id = `custom:${randomUUID()}`;
    const secretName = input.apiKey ? `source.${id}.apiKey` : null;
    if (secretName && input.apiKey) this.deps.secrets.set(secretName, input.apiKey);
    const row: SourceRow = {
      id,
      kind: 'torznab_custom',
      name: input.name,
      endpoint: input.endpoint,
      indexerId: null,
      enabled: true,
      apiKeySecret: secretName,
      health: 'unknown',
      healthCode: null,
      checkedAt: null,
      createdAt: this.now(),
    };
    // The endpoint must answer caps before it is saved.
    try {
      await this.deps.torznab.caps(await this.toTorznab(row));
    } catch (error) {
      if (secretName) this.deps.secrets.set(secretName, null);
      throw error;
    }
    this.deps.repo.upsert({ ...row, health: 'ok', checkedAt: this.now() });
    return this.list();
  }

  remove(id: string): Source[] {
    const row = this.deps.repo.get(id);
    if (!row || row.kind !== 'torznab_custom') throw new AppError('NOT_FOUND', 'only custom sources can be removed');
    if (row.apiKeySecret) this.deps.secrets.set(row.apiKeySecret, null);
    this.deps.repo.remove(id);
    return this.list();
  }
}
