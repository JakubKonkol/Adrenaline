// Downloads the pinned FFmpeg Windows build into vendor/ffmpeg (D-85, docs/1.0-adrenaline-tv/06-playback-negotiation.md).
// Build: Gyan.dev "full_build-shared" (GPLv3; NVENC/QSV/AMF, libx264/x265, libplacebo + Vulkan, zscale, libass),
// from the permanent version tag on GyanD/codexffmpeg. Version: scripts/ffmpeg-version.txt, SHA-256:
// scripts/ffmpeg-sha256.txt. Only ffmpeg.exe, ffprobe.exe, their DLLs and the licence/readme are kept.
// Usage: node scripts/fetch-ffmpeg.mjs [--force]
import { createHash } from 'node:crypto';
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
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
const version = readFileSync(join(root, 'scripts/ffmpeg-version.txt'), 'utf8').trim();
const expected = readFileSync(join(root, 'scripts/ffmpeg-sha256.txt'), 'utf8').trim().toLowerCase();
const target = join(root, 'vendor/ffmpeg');
const marker = join(target, '.adrenaline-version');
const force = process.argv.includes('--force');

if (!force && existsSync(marker) && readFileSync(marker, 'utf8').trim() === version) {
  console.log(`FFmpeg ${version} already in vendor/ffmpeg`);
  process.exit(0);
}

const name = `ffmpeg-${version}-full_build-shared`;
const url = `https://github.com/GyanD/codexffmpeg/releases/download/${version}/${name}.zip`;
const work = join(tmpdir(), `adrenaline-ffmpeg-${process.pid}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const zip = join(work, 'ffmpeg.zip');

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
const inner = join(unpacked, name);
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
// bin/: ffmpeg.exe, ffprobe.exe and the shared libraries; ffplay is not needed.
for (const file of readdirSync(join(inner, 'bin'))) {
  if (/^ffplay/i.test(file)) continue;
  cpSync(join(inner, 'bin', file), join(target, file));
}
for (const file of ['LICENSE', 'README.txt']) {
  if (existsSync(join(inner, file))) cpSync(join(inner, file), join(target, file));
}
writeFileSync(
  join(target, 'SOURCE.txt'),
  [
    `FFmpeg ${version} (${name}), built by Gyan Doshi (https://www.gyan.dev/ffmpeg/builds/).`,
    'Licensed under the GNU General Public License v3 (see LICENSE). Adrenaline runs it as a separate program.',
    `Binaries: ${url}`,
    `Source code of this exact version: https://github.com/FFmpeg/FFmpeg/tree/n${version}`,
    'Build configuration: run `ffmpeg -version`; library sources are listed in README.txt.',
    '',
  ].join('\n'),
);
writeFileSync(marker, `${version}\n`);
rmSync(work, { recursive: true, force: true });
console.log(`FFmpeg ${version} ready in vendor/ffmpeg (sha256 ${actual})`);
