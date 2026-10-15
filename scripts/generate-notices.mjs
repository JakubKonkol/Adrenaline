import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, resolve, relative } from 'node:path';

const mit = (holder) => `MIT License (no LICENSE file in the package; text per its "license": "MIT" field)

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

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
  // Some MIT packages ship no LICENSE file and the checker falls back to the README: use the MIT text with the
  // author declared in the package instead of the README.
  if (/^readme/i.test(basename(file)) && entry.licenses === 'MIT') {
    const pkg = JSON.parse(readFileSync(resolve(dirname(file), 'package.json'), 'utf8'));
    const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name;
    if (!author) throw new Error(`No author for the MIT notice of ${name}`);
    output += mit(author.replace(/\s*[(<].*$/, '')) + '\n\n';
  } else output += readFileSync(file, 'utf8').trim() + '\n\n';
}
output += native;
writeFileSync('resources/licenses/THIRD_PARTY_NOTICES.md', output);
console.log('Updated THIRD_PARTY_NOTICES.md (package license texts and native notices).');
