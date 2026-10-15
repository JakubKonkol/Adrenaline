import { describe, expect, it } from 'vitest';
import { APP_ERROR_CODES } from '@shared/errors';
import { errorTexts } from './errors';

describe('error texts (NFR09)', () => {
  it('has a Polish message and action for every error code', () => {
    for (const code of APP_ERROR_CODES) {
      expect(errorTexts[code]?.message, code).toBeTruthy();
      expect(errorTexts[code]?.action, code).toBeTruthy();
    }
  });
});
