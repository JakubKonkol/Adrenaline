import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';

// First: npx license-checker-rseidelsohn@5.0.1 --production --json --out node_modules/.cache-licenses.json
// Then: node scripts/generate-notices.mjs
const report = JSON.parse(readFileSync('node_modules/.cache-licenses.json', 'utf8'));
const native = readFileSync('resources/licenses/NATIVE_NOTICES.md', 'utf8');
let output = '# Third-party notices\n\nAdrenaline © 2026 Jakub Konkol.\n\n';
output +=
  'Production npm dependencies: license-checker-rseidelsohn 5.0.1 --production. Generated from the pinned installation.\n\n';
for (const [name, entry] of Object.entries(report).sort(([a], [b]) => a.localeCompare(b))) {
  if (name.startsWith('adrenaline@')) continue;
  const file = entry.licenseFile;
  if (
    !file ||
    !existsSync(file) ||
    !relative(resolve('node_modules'), resolve(file)) ||
    relative(resolve('node_modules'), resolve(file)).startsWith('..')
  )
    throw new Error(`Missing or unsafe license: ${name}`);
  output += `## ${name}\n\nLicense: ${entry.licenses}\nSource: ${entry.repository || 'npm package distribution'}\n\n`;
  output += readFileSync(file, 'utf8').trim() + '\n\n';
}
output += native;
writeFileSync('resources/licenses/THIRD_PARTY_NOTICES.md', output);
console.log('Updated THIRD_PARTY_NOTICES.md (package license texts and native notices).');
