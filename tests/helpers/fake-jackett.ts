import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * In-memory Jackett for tests: the admin API and Torznab endpoints observed in the 5.1 spike (D-57), served through
 * an injected `fetch`. Torznab answers come from tests/fixtures/torznab or from `results[indexerId]`.
 */
export class FakeJackett {
  password: string | null = null;
  readonly configured = new Set<string>();
  readonly known = ['yts', 'thepiratebay', 'torrentdownloads', 'limetorrents', 'eztv'];
  failAdd = new Set<string>();
  results: Record<string, string | ((params: URLSearchParams) => string | Response)> = {};
  apiKey = '';
  calls: string[] = [];
  private sessions = new Set<string>();
  private nextSession = 1;

  static fixture(name: string): string {
    return readFileSync(join(import.meta.dirname, '../fixtures/torznab', name), 'utf8');
  }

  readonly fetch: typeof fetch = (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    return Promise.resolve(this.handle(req, init));
  };

  private authed(req: Request): boolean {
    const cookie = req.headers.get('Cookie') ?? '';
    return [...this.sessions].some((s) => cookie.includes(`Jackett=${s}`));
  }

  private respond(req: Request, body: string | null): Response {
    const url = new URL(req.url);
    const path = url.pathname;
    this.calls.push(`${req.method} ${path}`);
    if (path === '/UI/Login') return new Response(null, { status: 302, headers: { Location: '/UI/TestCookie' } });
    if (path === '/UI/Dashboard' && req.method === 'POST') {
      const pw = new URLSearchParams(body ?? '').get('password') ?? '';
      if (this.password === null || pw === this.password) {
        const s = String(this.nextSession++);
        this.sessions.add(s);
        return new Response(null, {
          status: 302,
          headers: { Location: '/UI/Dashboard', 'Set-Cookie': `Jackett=${s}; path=/` },
        });
      }
      return new Response(null, { status: 302, headers: { Location: '/UI/Login' } });
    }
    const torznab = path.match(/^\/api\/v2\.0\/indexers\/([^/]+)\/results\/torznab\/api$/);
    if (torznab) {
      const id = torznab[1]!;
      if (url.searchParams.get('apikey') !== this.apiKey) return new Response(FakeJackett.fixture('error-apikey.xml'));
      if (url.searchParams.get('t') === 'caps') return new Response(FakeJackett.fixture('caps.xml'));
      const r = this.results[id];
      if (typeof r === 'function') {
        const out = r(url.searchParams);
        return out instanceof Response ? out : new Response(out);
      }
      return new Response(r ?? FakeJackett.fixture('empty.xml'));
    }
    if (path.startsWith('/api/v2.0/')) {
      if (!this.authed(req)) return new Response(null, { status: 302, headers: { Location: '/UI/Login' } });
      if (path === '/api/v2.0/server/config') return Response.json({ app_version: 'v0.24.2856', api_key: this.apiKey });
      if (path === '/api/v2.0/server/adminpassword') {
        this.password = JSON.parse(body ?? '""') as string;
        this.sessions.clear();
        return new Response(null, { status: 204 });
      }
      if (path === '/api/v2.0/indexers') {
        const configured = url.searchParams.get('configured');
        return Response.json(
          this.known
            .map((id) => ({ id, name: id, type: 'public', configured: this.configured.has(id) }))
            .filter((i) => configured === null || String(i.configured) === configured),
        );
      }
      const cfg = path.match(/^\/api\/v2\.0\/indexers\/([^/]+)\/config$/);
      if (cfg) {
        const id = cfg[1]!;
        if (!this.known.includes(id)) return new Response(null, { status: 404 });
        if (req.method === 'GET') return Response.json([{ id: 'sitelink', value: `https://${id}.example/` }]);
        if (this.failAdd.has(id)) return Response.json({ error: 'Site unreachable' }, { status: 500 });
        this.configured.add(id);
        return new Response(null, { status: 204 });
      }
      const del = path.match(/^\/api\/v2\.0\/indexers\/([^/]+)$/);
      if (del && req.method === 'DELETE') {
        this.configured.delete(del[1]!);
        return new Response(null, { status: 200 });
      }
    }
    return new Response(null, { status: 404 });
  }

  private handle(req: Request, init?: RequestInit): Promise<Response> {
    const body = typeof init?.body === 'string' ? init.body : null;
    return Promise.resolve(this.respond(req, body));
  }
}
