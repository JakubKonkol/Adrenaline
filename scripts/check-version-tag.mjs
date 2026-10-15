// Release guard: the pushed tag (e.g. v0.3.1) must equal "v" + package.json version (04-release-i-autoupdate.md).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Returns null when the tag matches, otherwise an error message. */
export function checkVersionTag(tag, version) {
  if (!tag) return 'Missing tag argument (expected e.g. v1.2.3).';
  const expected = `v${version}`;
  if (tag !== expected) return `Tag ${tag} does not match package.json version ${version} (expected ${expected}).`;
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const error = checkVersionTag(process.argv[2], pkg.version);
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log(`Tag ${process.argv[2]} matches package.json.`);
}
