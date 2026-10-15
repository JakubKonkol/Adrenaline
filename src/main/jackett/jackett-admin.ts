import { AppError } from '@shared/errors';

export interface JackettIndexerInfo {
  id: string;
  name: string;
  type: string;
  configured: boolean;
}

interface Options {
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Jackett admin API (D-57): cookie login with `POST /UI/Dashboard` (form field `password`), indexers through
 * `/api/v2.0/indexers…`. Requests that get redirected to the login page log in once more and are retried.
 */
export class JackettAdmin {
  private cookies = new Map<string, string>();
  private password = '';

  constructor(private readonly options: Options) {}

  private async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size) headers.set('Cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    let res: Response;
    try {
      res = await (this.options.fetch ?? fetch)(this.options.baseUrl + path, {
        ...init,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
      });
    } catch {
      throw new AppError('JACKETT_UNAVAILABLE');
    }
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const eq = pair?.indexOf('=') ?? -1;
      if (pair && eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    return res;
  }

  /** Logs in (an empty password works until one is set). Returns whether the admin API is now reachable. */
  async login(password: string): Promise<boolean> {
    this.password = password;
    this.cookies.clear();
    const res = await this.raw('/UI/Dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password }).toString(),
    });
    await res.body?.cancel();
    const probe = await this.raw('/api/v2.0/server/config');
    await probe.body?.cancel();
    return probe.status === 200;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    let res = await this.raw(path, init);
    if (res.status === 302 || res.status === 401) {
      await res.body?.cancel();
      await this.login(this.password);
      res = await this.raw(path, init);
    }
    if (res.status === 302 || res.status === 401) {
      await res.body?.cancel();
      throw new AppError('JACKETT_UNAVAILABLE', 'admin login failed');
    }
    return res;
  }

  private async json<T>(path: string): Promise<T> {
    const res = await this.request(path);
    if (!res.ok) {
      await res.body?.cancel();
      throw new AppError('JACKETT_UNAVAILABLE', `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  async serverConfig(): Promise<{ app_version?: string; api_key?: string }> {
    return this.json('/api/v2.0/server/config');
  }

  async setAdminPassword(password: string): Promise<void> {
    const res = await this.request('/api/v2.0/server/adminpassword', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(password),
    });
    await res.body?.cancel();
    if (!res.ok) throw new AppError('JACKETT_UNAVAILABLE', `HTTP ${res.status}`);
    this.password = password;
  }

  async listIndexers(configured?: boolean): Promise<JackettIndexerInfo[]> {
    const q = configured === undefined ? '' : `?configured=${configured}`;
    const list = await this.json<{ id: string; name: string; type: string; configured: boolean }[]>(
      `/api/v2.0/indexers${q}`,
    );
    return list.map((i) => ({ id: i.id, name: i.name, type: i.type, configured: i.configured }));
  }

  /** Adds an indexer with its default configuration; Jackett tests it on save (D-57). */
  async addIndexer(id: string): Promise<void> {
    const path = `/api/v2.0/indexers/${encodeURIComponent(id)}/config`;
    const config = await this.json<unknown[]>(path);
    const res = await this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error.slice(0, 300);
      } catch {
        /* keep the status */
      }
      throw new AppError('SOURCE_UNAVAILABLE', message);
    }
    await res.body?.cancel();
  }

  async removeIndexer(id: string): Promise<void> {
    const res = await this.request(`/api/v2.0/indexers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await res.body?.cancel();
    if (!res.ok && res.status !== 404) throw new AppError('JACKETT_UNAVAILABLE', `HTTP ${res.status}`);
  }
}
