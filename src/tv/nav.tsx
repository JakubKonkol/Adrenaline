import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Selection } from './api';
import { current } from './focus';

export type Tab = 'discover' | 'library';

export type Route =
  | { name: 'home'; tab: Tab }
  | { name: 'details'; type: 'movie' | 'tv'; tmdbId: number }
  | { name: 'releases'; selection: Selection; title: string; subtitle: string | null }
  | { name: 'show'; tmdbId: number; title: string }
  | { name: 'player'; itemId: string }
  | { name: 'settings' };

interface Entry {
  id: number;
  route: Route;
  /** `data-focus-key` focused when the user left this screen; restored on the way back. */
  focusKey: string | null;
}

interface Nav {
  top: Entry;
  depth: number;
  push: (route: Route) => void;
  pop: () => void;
  /** Replaces the whole stack (e.g. after starting a download → Library). */
  reset: (route: Route) => void;
  /** Changes the route of the current screen without a new history entry (tabs). */
  replace: (route: Route) => void;
  toast: string | null;
  showToast: (text: string) => void;
}

const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav outside NavProvider');
  return nav;
}

let nextId = 1;

export function NavProvider({ initial, children }: { initial: Route; children: ReactNode }) {
  const [stack, setStack] = useState<Entry[]>(() => [{ id: nextId++, route: initial, focusKey: null }]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rememberFocus = (entries: Entry[]): Entry[] => {
    const key = current()?.dataset['focusKey'] ?? null;
    const last = entries[entries.length - 1]!;
    return [...entries.slice(0, -1), { ...last, focusKey: key }];
  };

  const push = useCallback((route: Route) => {
    setStack((s) => [...rememberFocus(s), { id: nextId++, route, focusKey: null }]);
  }, []);
  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = useCallback((route: Route) => setStack([{ id: nextId++, route, focusKey: null }]), []);
  const replace = useCallback(
    (route: Route) => setStack((s) => [...s.slice(0, -1), { ...s[s.length - 1]!, route, focusKey: null }]),
    [],
  );
  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4_000);
  }, []);

  const value = useMemo<Nav>(
    () => ({ top: stack[stack.length - 1]!, depth: stack.length, push, pop, reset, replace, toast, showToast }),
    [stack, push, pop, reset, replace, toast, showToast],
  );
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

// ---------------------------------------------------------------- Back handlers

type BackHandler = () => boolean;
const backHandlers: BackHandler[] = [];

/** Screens and dialogs that handle Back themselves (the most recently mounted one wins). */
export function useBackHandler(handler: BackHandler, active = true): void {
  const ref = useRef(handler);
  useLayoutEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!active) return;
    const wrapped: BackHandler = () => ref.current();
    backHandlers.push(wrapped);
    return () => {
      const i = backHandlers.lastIndexOf(wrapped);
      if (i >= 0) backHandlers.splice(i, 1);
    };
  }, [active]);
}

/** Runs the Back handlers from the newest; true when one of them consumed the key. */
export function runBackHandlers(): boolean {
  for (let i = backHandlers.length - 1; i >= 0; i--) if (backHandlers[i]!()) return true;
  return false;
}

// ---------------------------------------------------------------- media keys (player)

type MediaHandler = (action: string) => boolean;
let mediaHandler: MediaHandler | null = null;

export function useMediaKeys(handler: MediaHandler): void {
  const ref = useRef(handler);
  useLayoutEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const wrapped: MediaHandler = (a) => ref.current(a);
    mediaHandler = wrapped;
    return () => {
      if (mediaHandler === wrapped) mediaHandler = null;
    };
  }, []);
}

export function runMediaHandler(action: string): boolean {
  return mediaHandler ? mediaHandler(action) : false;
}
