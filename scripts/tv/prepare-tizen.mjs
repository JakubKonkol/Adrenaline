// Prepares the Tizen widget content (D-81) in resources/tv/tizen/web from the TV build (out/tv):
// config.xml with the app version and the page CSP, the launcher icon, and the Samsung webapis script (AVPlay,
// productinfo, avinfo) that only exists on the TV. The widget is packaged and signed later on the user's PC with
// their certificate profile (Deploy to TV), so no private key is involved here.
// Usage: npm run build:tv && node scripts/tv/prepare-tizen.mjs
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = join(root, 'out', 'tv');
const target = join(root, 'resources', 'tv', 'tizen', 'web');
if (!existsSync(join(source, 'index.html'))) throw new Error('out/tv is missing: run `npm run build:tv` first');

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// Tizen widget versions are x.y.z numbers; a prerelease suffix (1.0.0-beta.1) is dropped.
const widgetVersion = /^(\d+\.\d+\.\d+)/.exec(version)?.[1];
if (!widgetVersion) throw new Error(`Unexpected version ${version}`);

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });

let html = readFileSync(join(target, 'index.html'), 'utf8');
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
if (!csp) throw new Error('The TV build has no CSP meta tag');
// $WEBAPIS is resolved by the TV runtime; it must load before the app script.
html = html.replace(
  '<script defer src="./app.js"></script>',
  '<script src="$WEBAPIS/webapis/webapis.js"></script>\n    <script defer src="./app.js"></script>',
);
if (!html.includes('$WEBAPIS')) throw new Error('Could not add the webapis script');
// On Tizen the policy lives in config.xml (one policy, applied by the runtime to the whole widget).
html = html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
writeFileSync(join(target, 'index.html'), html);

const config = readFileSync(join(root, 'tv', 'tizen', 'config.xml'), 'utf8')
  .replace('__VERSION__', widgetVersion)
  // AVPlay is a native <object> without a data URL. It needs the widget's own origin allowed.
  .replace('__CSP__', csp.replace("object-src 'none'", "object-src 'self' file:").replace(/&/g, '&amp;'));
writeFileSync(join(target, 'config.xml'), config);
cpSync(join(root, 'tv', 'assets', 'icon-512.png'), join(target, 'icon.png'));
console.log(`Tizen widget content ${widgetVersion} ready in resources/tv/tizen/web`);
