// Downloads the pinned Jackett Windows build into vendor/jackett (04-release-i-autoupdate.md, D-50).
// Version: scripts/jackett-version.txt, expected SHA-256: scripts/jackett-sha256.txt.
// Usage: node scripts/fetch-jackett.mjs [--force]
import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import extract from 'extract-zip';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = readFileSync(join(root, 'scripts/jackett-version.txt'), 'utf8').trim();
const expected = readFileSync(join(root, 'scripts/jackett-sha256.txt'), 'utf8').trim().toLowerCase();
const target = join(root, 'vendor/jackett');
const marker = join(target, '.adrenaline-version');
const force = process.argv.includes('--force');

if (!force && existsSync(marker) && readFileSync(marker, 'utf8').trim() === version) {
  console.log(`Jackett ${version} already in vendor/jackett`);
  process.exit(0);
}

const url = `https://github.com/Jackett/Jackett/releases/download/${version}/Jackett.Binaries.Windows.zip`;
const work = join(tmpdir(), `adrenaline-jackett-${process.pid}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const zip = join(work, 'jackett.zip');

console.log(`Downloading ${url}`);
const res = await fetch(url);
if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));

const actual = createHash('sha256').update(readFileSync(zip)).digest('hex');
if (actual !== expected) {
  console.error(`SHA-256 mismatch for ${version}: expected ${expected}, got ${actual}`);
  process.exit(1);
}

const unpacked = join(work, 'unpacked');
await extract(zip, { dir: unpacked });
// The archive contains a top-level "Jackett/" folder: flatten it.
const inner = existsSync(join(unpacked, 'Jackett')) ? join(unpacked, 'Jackett') : unpacked;
rmSync(target, { recursive: true, force: true });
mkdirSync(dirname(target), { recursive: true });
renameSync(inner, target);

// Updates come with Adrenaline (--NoUpdates); the updater and Windows service helpers are not shipped.
for (const name of readdirSync(target)) {
  if (/^JackettUpdater|^JackettService|^JackettTray|\.bat$|install_service|uninstall_service/i.test(name)) {
    rmSync(join(target, name), { recursive: true, force: true });
  }
}
writeFileSync(marker, `${version}\n`);
rmSync(work, { recursive: true, force: true });
console.log(`Jackett ${version} ready in vendor/jackett (sha256 ${actual})`);
