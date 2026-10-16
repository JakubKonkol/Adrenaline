import { createContext, useContext } from 'react';
import type { TvSession } from '@shared/contracts/tv';
import type { Api } from './api';

export interface SessionContextValue {
  api: Api;
  session: TvSession;
  /** Forget the PC and its token (Settings → Disconnect, or the token was revoked). */
  disconnect: (reason?: 'revoked') => void;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside SessionContext');
  return value;
}
