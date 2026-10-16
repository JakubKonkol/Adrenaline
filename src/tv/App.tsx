import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { TvSession } from '@shared/contracts/tv';
import { Api, ApiError } from './api';
import { clearCache } from './data';
import { current, focus, focusFirst, focusKey, move, select, setPendingFocus } from './focus';
import { t } from './i18n';
import { keyAction } from './keys';
import { NavProvider, runBackHandlers, runMediaHandler, useNav } from './nav';
import { platform } from './platform';
import { Connect } from './screens/Connect';
import { Details } from './screens/Details';
import { Home } from './screens/Home';
import { Show } from './screens/Library';
import { Player } from './screens/Player';
import { Releases } from './screens/Releases';
import { Settings } from './screens/Settings';
import { SessionContext, type SessionContextValue } from './session';
import { clearConnection, type Connection, loadConnection, saveConnection } from './storage';
import { Button, Message, Spinner } from './ui';

type Phase =
  | { kind: 'loading' }
  | { kind: 'connect'; initialServer: string | null; reason: 'revoked' | null }
  | { kind: 'offline'; connection: Connection }
  | { kind: 'ready'; api: Api; session: TvSession };

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  /** Checks the saved token with the PC (async state updates only). */
  const check = useCallback((connection: Connection) => {
    const api = new Api(connection.server, connection.token);
    api.session().then(
      (session) => {
        saveConnection({ ...connection, serverName: session.server.serverName });
        setPhase({ kind: 'ready', api, session });
      },
      (error: unknown) => {
        const code = error instanceof ApiError ? error.code : 'NETWORK';
        if (code === 'TV_UNAUTHORIZED') {
          clearConnection();
          setPhase({ kind: 'connect', initialServer: connection.server, reason: 'revoked' });
        } else {
          setPhase({ kind: 'offline', connection });
        }
      },
    );
  }, []);

  const open = useCallback(
    (connection: Connection) => {
      setPhase({ kind: 'loading' });
      check(connection);
    },
    [check],
  );

  useEffect(() => {
    const saved = loadConnection();
    if (saved) check(saved);
    else
      void platform
        .initialServer()
        .then((server) => setPhase({ kind: 'connect', initialServer: server, reason: null }));
  }, [check]);

  const disconnect = useCallback((reason?: 'revoked') => {
    const saved = loadConnection();
    clearConnection();
    clearCache();
    setPhase({ kind: 'connect', initialServer: saved?.server ?? null, reason: reason ?? null });
  }, []);

  useRemote(phase.kind !== 'ready');
  // Screens outside the navigator (connect, offline) get their default focus here.
  useLayoutEffect(() => {
    if (phase.kind !== 'ready' && !current()) focusFirst();
  });

  if (phase.kind === 'loading') return <Spinner />;
  if (phase.kind === 'connect')
    return <Connect initialServer={phase.initialServer} reason={phase.reason} onConnected={open} />;
  if (phase.kind === 'offline')
    return (
      <div className="screen center" data-page="">
        <Message
          title={t('offline.title')}
          body={t('offline.body', { server: phase.connection.server.replace(/^https?:\/\//, '') })}
          action={t('app.retry')}
          onAction={() => open(phase.connection)}
        />
        <div className="actions center-actions">
          <Button focusKey="offline-change" onSelect={() => disconnect()}>
            {t('offline.change')}
          </Button>
        </div>
      </div>
    );
  return <Ready api={phase.api} session={phase.session} disconnect={disconnect} />;
}

function Ready({
  api,
  session,
  disconnect,
}: {
  api: Api;
  session: TvSession;
  disconnect: SessionContextValue['disconnect'];
}) {
  const value = useMemo(() => ({ api, session, disconnect }), [api, session, disconnect]);
  return (
    <SessionContext.Provider value={value}>
      <NavProvider initial={{ name: 'home', tab: 'discover' }}>
        <Screens />
      </NavProvider>
    </SessionContext.Provider>
  );
}

function Screens() {
  const nav = useNav();
  const { top, depth } = nav;
  const route = top.route;

  // Back: dialogs and the player first, then the screen stack, then Library → Discover, then leave the app.
  useEffect(() => {
    rootBack = () => {
      if (runBackHandlers()) return true;
      if (depth > 1) {
        nav.pop();
        return true;
      }
      if (route.name === 'home' && route.tab !== 'discover') {
        nav.replace({ name: 'home', tab: 'discover' }, 'tab-discover');
        return true;
      }
      return false;
    };
    return () => {
      rootBack = null;
    };
  }, [nav, depth, route]);

  // Focus on every screen change: the remembered element when coming back, else the screen's default.
  useLayoutEffect(() => {
    setPendingFocus(null);
    if (top.focusKey && focusKey(top.focusKey)) return;
    // Not on screen yet (data still loading): focus it as soon as it appears.
    if (top.focusKey) setPendingFocus(top.focusKey);
    if (!current()) focusFirst();
  }, [top.id, top.focusKey]);

  return (
    <>
      {route.name === 'home' ? (
        <Home tab={route.tab} />
      ) : route.name === 'details' ? (
        <Details key={`${route.type}-${route.tmdbId}`} type={route.type} tmdbId={route.tmdbId} />
      ) : route.name === 'releases' ? (
        <Releases selection={route.selection} title={route.title} subtitle={route.subtitle} />
      ) : route.name === 'show' ? (
        <Show tmdbId={route.tmdbId} title={route.title} />
      ) : route.name === 'player' ? (
        <Player itemId={route.itemId} />
      ) : (
        <Settings />
      )}
      {nav.toast ? (
        <div className="toast" role="status">
          {nav.toast}
        </div>
      ) : null}
    </>
  );
}

let rootBack: (() => boolean) | null = null;

/** Remote control: arrows move focus, Enter selects, Back goes back, media keys go to the player. */
function useRemote(outsideApp: boolean) {
  useEffect(() => {
    const onBack = (): boolean => {
      // Android sends Back to the app, not to the text field: close the TV keyboard first.
      const active = document.activeElement;
      if (active instanceof HTMLInputElement) {
        active.blur();
        focus(active.closest<HTMLElement>('.focusable'));
        return true;
      }
      if (rootBack?.()) return true;
      if (outsideApp && runBackHandlers()) return true;
      return false;
    };
    // Android shell: the system Back button arrives here instead of as a key event.
    window.__adrenalineBack = onBack;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT') return; // the text field handles its own keys
      const action = keyAction(e);
      if (!action) return;
      e.preventDefault();
      // Nothing focused (first key press, or the focused element disappeared): focus the screen's default first.
      if (!current() && action !== 'back' && focusFirst()) return;
      if (action === 'back') {
        if (!onBack()) platform.exit();
        return;
      }
      if (runMediaHandler(action)) return;
      if (action === 'select') {
        select();
        return;
      }
      if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
        move(action);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.__adrenalineBack = undefined;
    };
  }, [outsideApp]);
}
