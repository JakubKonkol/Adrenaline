// Copies the TV web build (out/tv) into out/tv-android/tv, the assets folder of the Android app (tv/android).
// Usage: npm run build:tv && node scripts/tv/prepare-android.mjs && (cd tv/android && ./gradlew assembleRelease)
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = join(root, 'out', 'tv');
const target = join(root, 'out', 'tv-android', 'tv');
if (!existsSync(join(source, 'index.html'))) throw new Error('out/tv is missing: run `npm run build:tv` first');
rmSync(join(root, 'out', 'tv-android'), { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
console.log('TV web app copied to out/tv-android/tv (Android assets)');
