import { useEffect, useRef, useState } from 'react';
import type { TvPlayback } from '@shared/contracts/tv';
import { ApiError } from '../api';
import { invalidate } from '../data';
import { errorText, t } from '../i18n';
import { useBackHandler, useMediaKeys, useNav } from '../nav';
import { type NativePlayerEvent, platform } from '../platform';
import { avplayAvailable, createAvPlayEngine, createVideoEngine, type PlayerEngine } from '../player/engines';
import { type Cue, cueAt, parseVtt } from '../player/vtt';
import { useSession } from '../session';
import { Message, Spinner } from '../ui';

const SAVE_EVERY_MS = 15_000;
const CONTROLS_MS = 4_000;

export function formatTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '--:--';
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function Player({ itemId }: { itemId: string }) {
  const { api } = useSession();
  const nav = useNav();
  const [playback, setPlayback] = useState<TvPlayback | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.playback(itemId).then(
      (p) => alive && setPlayback(p),
      (e: unknown) => {
        if (!alive) return;
        const code = e instanceof ApiError ? e.code : 'NETWORK';
        setError(code === 'TV_UNSUPPORTED_MEDIA' ? t('player.unsupported') : errorText(code));
      },
    );
    return () => {
      alive = false;
    };
  }, [api, itemId]);

  useBackHandler(() => {
    nav.pop();
    return true;
  }, !playback || !!error);

  if (error) return <Message title={error} action={t('app.back')} onAction={nav.pop} />;
  if (!playback) return <Spinner />;
  return platform.playNative ? <NativePlayer playback={playback} /> : <WebPlayer playback={playback} />;
}

/** Android: the Media3 activity plays; this screen waits for it to close and stores the position. */
function NativePlayer({ playback }: { playback: TvPlayback }) {
  const { api } = useSession();
  const nav = useNav();
  useEffect(() => {
    window.__adrenalineNativeEvent = (raw: string) => {
      try {
        const e = JSON.parse(raw) as NativePlayerEvent;
        if (e.type === 'closed' && e.itemId === playback.itemId) {
          void api
            .saveProgress(playback.itemId, e.ended ? (e.durationMs ?? e.positionMs) : e.positionMs, e.durationMs)
            .catch(() => undefined)
            .finally(() => invalidate('library'));
          nav.pop();
        }
      } catch {
        nav.pop();
      }
    };
    platform.playNative!({
      itemId: playback.itemId,
      url: playback.streamUrl,
      title: playback.title,
      mimeType: playback.mimeType,
      subtitles: playback.subtitles,
      startMs: playback.resumeMs ?? 0,
    });
    return () => {
      window.__adrenalineNativeEvent = undefined;
    };
  }, [api, nav, playback]);
  return <Spinner label={playback.title} />;
}

function WebPlayer({ playback }: { playback: TvPlayback }) {
  const { api } = useSession();
  const nav = useNav();
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<PlayerEngine | null>(null);
  const [time, setTime] = useState(playback.resumeMs ?? 0);
  const [duration, setDuration] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [failed, setFailed] = useState(false);
  const [controls, setControls] = useState(true);
  const [menu, setMenu] = useState(false);
  const [loaded, setLoaded] = useState<{ url: string; cues: Cue[] } | null>(null);
  const [subtitle, setSubtitle] = useState<string | null>(playback.subtitles[0]?.lang ?? null);
  const [menuIndex, setMenuIndex] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSave = useRef(0);
  const useAvPlay = avplayAvailable();

  const save = (ms: number, force = false) => {
    if (!force && Date.now() - lastSave.current < SAVE_EVERY_MS) return;
    lastSave.current = Date.now();
    void api.saveProgress(playback.itemId, ms, engineRef.current?.duration() ?? null).catch(() => undefined);
  };

  const showControls = () => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), CONTROLS_MS);
  };

  useEffect(() => {
    const events = {
      onTime: (ms: number) => {
        setTime(ms);
        save(ms);
      },
      onReady: (d: number | null) => {
        setDuration(d);
        setBuffering(false);
        showControls();
      },
      onEnded: () => {
        save(engineRef.current?.duration() ?? 0, true);
        invalidate('library');
        nav.pop();
      },
      onError: () => setFailed(true),
      onBuffering: setBuffering,
    };
    const engine =
      useAvPlay && window.webapis?.avplay
        ? createAvPlayEngine(window.webapis.avplay, events)
        : createVideoEngine(videoRef.current!, events);
    engineRef.current = engine;
    engine.open(playback.streamUrl, playback.resumeMs ?? 0);
    return () => {
      save(engine.position(), true);
      invalidate('library');
      engine.destroy();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // The engine lives as long as this playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback]);

  // Subtitles: fetched as text and drawn by the app.
  const subtitleUrl = playback.subtitles.find((s) => s.lang === subtitle)?.url ?? null;
  const cues = loaded && loaded.url === subtitleUrl ? loaded.cues : [];
  useEffect(() => {
    if (!subtitleUrl) return;
    let alive = true;
    fetch(subtitleUrl)
      .then((r) => r.text())
      .then((text) => alive && setLoaded({ url: subtitleUrl, cues: parseVtt(text) }))
      .catch(() => alive && setLoaded({ url: subtitleUrl, cues: [] }));
    return () => {
      alive = false;
    };
  }, [subtitleUrl]);

  const options: { label: string; lang: string | null }[] = [
    { label: t('player.off'), lang: null },
    ...playback.subtitles.map((s) => ({ label: s.lang.toUpperCase(), lang: s.lang })),
  ];

  const handle = (action: string): boolean => {
    const engine = engineRef.current;
    if (!engine) return false;
    showControls();
    if (menu) {
      if (action === 'up' || action === 'left') setMenuIndex((i) => Math.max(0, i - 1));
      else if (action === 'down' || action === 'right') setMenuIndex((i) => Math.min(options.length - 1, i + 1));
      else if (action === 'select') {
        setSubtitle(options[menuIndex]?.lang ?? null);
        setMenu(false);
      }
      return true;
    }
    const toggle = () => {
      if (engine.paused) engine.play();
      else engine.pause();
      setPaused(engine.paused);
    };
    switch (action) {
      case 'select':
      case 'playPause':
        toggle();
        return true;
      case 'play':
        engine.play();
        setPaused(false);
        return true;
      case 'pause':
        engine.pause();
        setPaused(true);
        return true;
      case 'left':
      case 'rewind':
        engine.seek(engine.position() - 10_000);
        return true;
      case 'right':
      case 'forward':
        engine.seek(engine.position() + 30_000);
        return true;
      case 'up':
        if (options.length > 1) {
          setMenuIndex(
            Math.max(
              0,
              options.findIndex((o) => o.lang === subtitle),
            ),
          );
          setMenu(true);
        }
        return true;
      case 'down':
        setControls(false);
        return true;
      case 'stop':
        nav.pop();
        return true;
      default:
        return false;
    }
  };

  useMediaKeys(handle);
  useBackHandler(() => {
    if (menu) {
      setMenu(false);
      return true;
    }
    nav.pop();
    return true;
  });

  const progress = duration ? (time / duration) * 100 : 0;
  const text = cueAt(cues, time);
  return (
    <div className={`player ${useAvPlay ? 'is-avplay' : ''} ${controls || paused ? 'controls-on' : ''}`}>
      {useAvPlay ? (
        <object className="player-plane" type="application/avplayer" aria-hidden="true" />
      ) : (
        <video ref={videoRef} className="player-video" playsInline />
      )}
      {failed ? (
        <div className="player-message">
          <Message title={t('player.unsupported')} action={t('app.back')} onAction={nav.pop} />
        </div>
      ) : null}
      {buffering && !failed ? <Spinner /> : null}
      {text ? (
        <div className="subtitle-line">
          {text.split('\n').map((line, i) => (
            <span key={i}>{line}</span>
          ))}
        </div>
      ) : null}
      {menu ? (
        <div className="player-menu" role="listbox" aria-label={t('player.subtitles')}>
          <h3>{t('player.subtitles')}</h3>
          {options.map((o, i) => (
            <div key={o.label} className={`player-option ${i === menuIndex ? 'is-focused' : ''}`} role="option">
              {o.label}
              {o.lang === subtitle ? ' ✓' : ''}
            </div>
          ))}
        </div>
      ) : null}
      <div className={`player-controls ${controls || paused ? 'is-visible' : ''}`}>
        <div className="player-title">{playback.title}</div>
        <div className="player-bar">
          <span className="player-time">{formatTime(time)}</span>
          <div className="progress progress-large">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="player-time">{formatTime(duration)}</span>
        </div>
        <div className="player-hint">{paused ? '❚❚' : ''}</div>
      </div>
    </div>
  );
}
