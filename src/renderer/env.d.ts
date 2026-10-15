import type { AdrenalineApi } from '@shared/contracts/api';

declare global {
  interface Window {
    adrenaline: AdrenalineApi;
  }
}
