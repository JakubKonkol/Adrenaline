// Collects the TV apps for the installer (D-79, D-81) into resources/tv and writes resources/tv/manifest.json:
// product version, TV API range, the Android APK (copied from the Gradle output or a CI artifact) and the Tizen widget
// content (scripts/tv/prepare-tizen.mjs), each with SHA-256. Deploy to TV checks these hashes before installing.
// Usage: node scripts/tv/write-manifest.mjs [path/to/app-release.apk]
// ADRENALINE_ANDROID_SIGNING=release marks an APK signed with the release key (CI secrets); otherwise "debug".
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const constants = readFileSync(join(root, 'src/shared/contracts/tv-constants.ts'), 'utf8');
const apiVersion = Number(/TV_API_VERSION = (\d+)/.exec(constants)?.[1]);
const apiMin = Number(/TV_API_MIN = (\d+)/.exec(constants)?.[1]);
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const apkSource = process.argv[2] ?? join(root, 'tv/android/app/build/outputs/apk/release/app-release.apk');
if (!existsSync(apkSource)) throw new Error(`APK not found: ${apkSource}`);
const apkName = `Adrenaline-TV-${version}.apk`;
mkdirSync(join(root, 'resources/tv/android'), { recursive: true });
copyFileSync(apkSource, join(root, 'resources/tv/android', apkName));

const tizenDir = join(root, 'resources/tv/tizen/web');
if (!existsSync(join(tizenDir, 'config.xml'))) throw new Error('Run scripts/tv/prepare-tizen.mjs first');
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else files.push({ path: relative(tizenDir, full).split(sep).join('/'), sha256: sha256(full) });
  }
};
walk(tizenDir);

const manifest = {
  product: 'adrenaline',
  version,
  api: { version: apiVersion, min: apiMin },
  android: {
    file: `android/${apkName}`,
    sha256: sha256(join(root, 'resources/tv/android', apkName)),
    applicationId: 'com.jakubkonkol.adrenaline.tv',
    activity: 'com.jakubkonkol.adrenaline.tv/.MainActivity',
    minSdk: 28,
    signing: process.env.ADRENALINE_ANDROID_SIGNING === 'release' ? 'release' : 'debug',
  },
  tizen: {
    dir: 'tizen/web',
    packageId: 'AdrnlnTV01',
    appId: 'AdrnlnTV01.Adrenaline',
    requiredVersion: '5.5',
    files,
  },
};
writeFileSync(join(root, 'resources/tv/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`resources/tv/manifest.json: ${apkName} (${manifest.android.signing}), Tizen ${files.length} files`);
