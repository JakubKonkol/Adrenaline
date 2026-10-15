import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';

// Explicit live probe; never part of CI. Default uses no download quota.
if (existsSync('.env')) process.loadEnvFile('.env');
const key = process.env.OPENSUBTITLES_API_KEY?.trim();
const username = process.env.OPENSUBTITLES_USERNAME?.trim();
const password = process.env.OPENSUBTITLES_PASSWORD;
const hosts = new Set(['api.opensubtitles.com', 'vip-api.opensubtitles.com']);
const output = 'tests/fixtures/opensubtitles/live';
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
let base = 'api.opensubtitles.com',
  token;
async function request(path, body, method = body ? 'POST' : 'GET') {
  const res = await fetch(`https://${base}/api/v1${path}`, {
    method,
    headers: {
      'Api-Key': key,
      'User-Agent': 'Adrenaline v0.7.0',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
async function save(name, value) {
  await writeFile(`${output}/${name}.json`, JSON.stringify(value, null, 2) + '\n');
  console.log(`Zapisano ${name}.json (bez sekretów).`);
}
if (!key || !username || !password) {
  console.error('Ustaw OPENSUBTITLES_API_KEY, OPENSUBTITLES_USERNAME i OPENSUBTITLES_PASSWORD w .env.');
  process.exitCode = 1;
} else
  try {
    await mkdir(output, { recursive: true });
    const login = await request('/login', { username, password });
    if (!hosts.has(login.base_url) || typeof login.token !== 'string') throw new Error('Invalid API session');
    base = login.base_url;
    token = login.token;
    await save('login', { base_url: base, user: pick(login.user, ['allowed_downloads', 'level', 'vip']) });
    const account = await request('/infos/user');
    await save('account', { data: pick(account.data, ['allowed_downloads', 'remaining_downloads', 'level']) });
    const tmdb = process.env.OPENSUBTITLES_TEST_TMDB_ID || '10331';
    if (!/^\d+$/.test(tmdb)) throw new Error('Invalid TMDB ID');
    const result = await request(`/subtitles?languages=pl&tmdb_id=${tmdb}`);
    const data = result.data.slice(0, 10).map((row) => ({
      id: row.id,
      attributes: pick(row.attributes, [
        'language',
        'release',
        'hearing_impaired',
        'foreign_parts_only',
        'moviehash_match',
        'download_count',
        'ratings',
        'from_trusted',
        'machine_translated',
        'files',
      ]),
    }));
    await save('search', { data });
    // Optional explicit file ID, one quota-consuming call, never retried. Temporary URL is never saved.
    const id = process.env.OPENSUBTITLES_TEST_FILE_ID;
    if (id) {
      if (!/^\d+$/.test(id) || !data.some((row) => row.attributes.files?.some((f) => String(f.file_id) === id)))
        throw new Error('Select a file ID from this search');
      const download = await request('/download', { file_id: Number(id) });
      await save('download', pick(download, ['file_name', 'remaining', 'reset_time_utc']));
    }
    await save('provenance', { capturedAt: new Date().toISOString(), tmdbId: tmdb, downloadRequests: id ? 1 : 0 });
  } catch {
    console.error(
      'Test OpenSubtitles nie powiódł się. Sprawdź konto, klucz i połączenie. Sekrety nie zostały zapisane.',
    );
    process.exitCode = 1;
  } finally {
    if (token) await request('/logout', undefined, 'DELETE').catch(() => undefined);
  }
