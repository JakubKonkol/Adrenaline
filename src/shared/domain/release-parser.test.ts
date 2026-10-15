import { describe, expect, it } from 'vitest';
import cases from '../../../tests/fixtures/release-names.json';
import { parseReleaseName } from './release-parser';

describe('parseReleaseName', () => {
  it('has at least 40 cases (03-testy.md)', () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
  });

  it.each(cases.map((c) => [c.name, c.expect] as const))('%s', (name, expected) => {
    expect(parseReleaseName(name)).toMatchObject(expected);
  });
});
