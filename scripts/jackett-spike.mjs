// Jackett spike (etap 5.1): verifies the bundled Jackett the way Adrenaline will run it.
// - own data folder, no administrator rights, port and API key written to ServerConfig.json before start
//   (the --Port flag requires admin on Windows),
// - listens on 127.0.0.1 only, admin API behind a random password (cookie login),
// - add a public indexer through the admin API, Torznab t=caps, remove it.
// Usage: node scripts/jackett-spike.mjs [--jackett vendor/jackett] [--indexer yts] [--keep]
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const jackettDir = resolve(arg('jackett', 'vendor/jackett'));
const indexer = arg('indexer', 'yts');
const exe = join(jackettDir, process.platform === 'win32' ? 'JackettConsole.exe' : 'jackett');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const freePort = () =>
  new Promise((res) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });

const dataDir = mkdtempSync(join(tmpdir(), 'adrenaline-jackett-data-'));
const port = await freePort();
const apiKey = randomBytes(16).toString('hex');
const password = randomBytes(18).toString('base64url');
writeFileSync(
  join(dataDir, 'ServerConfig.json'),
  JSON.stringify(
    { Port: port, LocalBindAddress: '127.0.0.1', AllowExternal: false, UpdateDisabled: true, APIKey: apiKey },
    null,
    2,
  ),
);

console.log(`Jackett: ${exe}\nData: ${dataDir}\nPort: ${port}`);
const log = [];
const child = spawn(exe, ['--NoUpdates', '--NoRestart', '--ListenPrivate', '--DataFolder', dataDir], {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => log.push(String(d)));
child.stderr.on('data', (d) => log.push(String(d)));
const base = `http://127.0.0.1:${port}`;

let cookie = '';
async function http(path, init = {}) {
  const res = await fetch(base + path, {
    ...init,
    redirect: 'manual',
    headers: { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) },
    signal: AbortSignal.timeout(60_000),
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) {
    const jar = new Map(
      cookie
        .split('; ')
        .filter(Boolean)
        .map((c) => c.split(/=(.*)/s).slice(0, 2)),
    );
    for (const c of set) {
      const [kv] = c.split(';');
      const [k, v] = kv.split(/=(.*)/s);
      jar.set(k, v);
    }
    cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  return res;
}

try {
  const started = Date.now();
  let up = false;
  while (Date.now() - started < 30_000 && !up) {
    await new Promise((r) => setTimeout(r, 300));
    up = await fetch(`${base}/UI/Login`, { redirect: 'manual' }).then(
      () => true,
      () => false,
    );
    if (child.exitCode !== null) break;
  }
  check('starts without --Port/admin, health < 30 s', up, `${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (!up) throw new Error('Jackett did not start');

  const files = readdirSync(dataDir);
  check('writes into the given data folder', files.includes('log.txt'), files.join(', '));
  const config = JSON.parse(readFileSync(join(dataDir, 'ServerConfig.json'), 'utf8'));
  check('keeps the pre-written API key and port', config.APIKey === apiKey && config.Port === port);
  const runtime =
    log.join('').match(/Environment version: ([^\r\n]+)/) ??
    readFileSync(join(dataDir, 'log.txt'), 'utf8').match(/Environment version: ([^\r\n]+)/);
  console.log(`      .NET: ${runtime?.[1] ?? 'not reported'}`);

  if (process.platform === 'win32') {
    const netstat = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
    const listening = netstat.split('\n').filter((l) => l.includes(`:${port} `) && /LISTENING/.test(l));
    check(
      'listens on 127.0.0.1 only',
      listening.length > 0 && listening.every((l) => l.includes(`127.0.0.1:${port}`)),
      listening.map((l) => l.trim()).join(' | '),
    );
  }

  // Without an admin password the login form still has to be posted (empty password) to get the cookie.
  const login = (pw) =>
    http('/UI/Dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: pw }).toString(),
    });
  await login('');
  const setPw = await http('/api/v2.0/server/adminpassword', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(password),
  });
  check('sets a random admin password', setPw.status === 204, `HTTP ${setPw.status}`);
  cookie = '';
  check('admin API requires login', (await http('/api/v2.0/server/config')).status === 302);
  await login('wrong-password');
  check('wrong password is rejected', (await http('/api/v2.0/server/config')).status === 302);
  await login(password);
  const cfg = await http('/api/v2.0/server/config');
  check('cookie login with the password', cfg.status === 200);

  const list = await (await http('/api/v2.0/indexers?configured=false')).json();
  const wanted = ['thepiratebay', 'yts', 'torrentdownloads', 'limetorrents'];
  check(
    'lists indexers incl. D-53 defaults',
    wanted.every((id) => list.some((i) => i.id === id)),
    `${list.length} indexers`,
  );

  const conf = await (await http(`/api/v2.0/indexers/${indexer}/config`)).json();
  const add = await http(`/api/v2.0/indexers/${indexer}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conf),
  });
  check(`adds ${indexer} through the admin API`, add.status === 204, `HTTP ${add.status}`);

  const torznab = `/api/v2.0/indexers/${indexer}/results/torznab/api`;
  const caps = await (await http(`${torznab}?apikey=${apiKey}&t=caps`)).text();
  check('Torznab t=caps', caps.includes('<caps>') && caps.includes('<searching>'));
  const bad = await (await http(`${torznab}?apikey=wrong&t=caps`)).text();
  check('wrong API key → <error code="100">', /<error code="100"/.test(bad));

  if (!process.argv.includes('--keep')) {
    const del = await http(`/api/v2.0/indexers/${indexer}`, { method: 'DELETE' });
    check(`removes ${indexer}`, del.status === 200 || del.status === 204, `HTTP ${del.status}`);
  }
} catch (error) {
  check('spike completed', false, error instanceof Error ? error.message : String(error));
} finally {
  child.kill();
  await new Promise((r) => setTimeout(r, 1000));
  if (existsSync(dataDir) && !process.argv.includes('--keep')) rmSync(dataDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
