import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without type declarations
import { checkVersionTag } from './check-version-tag.mjs';

const check = checkVersionTag as (tag: string | undefined, version: string) => string | null;

describe('checkVersionTag', () => {
  it('accepts a matching tag', () => {
    expect(check('v0.1.0', '0.1.0')).toBeNull();
    expect(check('v1.0.0-beta.1', '1.0.0-beta.1')).toBeNull();
  });

  it('rejects a mismatched or missing tag', () => {
    expect(check('v0.1.1', '0.1.0')).toMatch(/does not match/);
    expect(check('0.1.0', '0.1.0')).toMatch(/does not match/);
    expect(check(undefined, '0.1.0')).toMatch(/Missing tag/);
  });
});
