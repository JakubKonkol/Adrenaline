import { readFileSync } from 'node:fs';

const [file, tag] = process.argv.slice(2);
if (!file || !/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag ?? ''))
  throw new Error('Expected asset manifest and version tag');
const { assets } = JSON.parse(readFileSync(file, 'utf8'));
const name = `Adrenaline-Setup-${tag.slice(1)}.exe`;
for (const required of [name, `${name}.blockmap`, tag.includes('-') ? 'beta.yml' : 'latest.yml']) {
  const matches = assets.filter((a) => a.name === required);
  if (matches.length !== 1 || !(matches[0].size > 0)) throw new Error(`Missing or empty release asset: ${required}`);
}
console.log('Installer, blockmap and update metadata verified before publication.');
