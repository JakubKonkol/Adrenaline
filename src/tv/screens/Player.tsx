import { useEffect, useMemo, useRef, useState } from 'react';
import type { TvPlayback, TvSubtitleTrack } from '@shared/contracts/tv';
import { ApiError, type PlaybackRequest } from '../api';
import { invalidate } from '../data';
import { errorText, t } from '../i18n';
import { useBackHandler, useMediaKeys, useNav } from '../nav';
import { type NativePlayerEvent, platform } from '../platform';
import { avplayAvailable, createAvPlayEngine, createVideoEngine, type PlayerEngine } from '../player/engines';
import { deviceProfile } from '../player/profile';
import { type Cue, cueAt, parseVtt } from '../player/vtt';
import { useSession } from '../session';
import { Message, Spinner } from '../ui';

const SAVE_EVERY_MS = 15_000;
const CONTROLS_MS = 4_000;
const HLS = 'application/vnd.apple.mpegurl';

export function formatTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '--:--';
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

type Request = Omit<PlaybackRequest, 'profile'>;

/** Subtitle choice → what the PC must do (only image subtitles change the stream: they are burned in). */
export function subtitleRequest(track: TvSubtitleTrack | null): PlaybackRequest['subtitle'] {
  if (!track || track.kind !== 'embedded-image') return { kind: 'none' };
  return { kind: 'embedded', index: Number(track.id.slice(2)) };
}

/**
 * Player screen (D-85): asks the PC for a stream with this TV's profile. The answer is the file itself (direct play)
 * or an HLS stream the PC converts (remux / audio / video). A seek outside the converted part, another audio track
 * (for HLS) or image subtitles start a new stream from the current position.
 */
export function Player({ itemId }: { itemId: string }) {
  const { api } = useSession();
  const nav = useNav();
  const profile = useMemo(() => deviceProfile(platform.name), []);
  const [request, setRequest] = useState<Request>({});
  const [playback, setPlayback] = useState<TvPlayback | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.playback(itemId, { profile, ...request }).then(
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
  }, [api, itemId, profile, request]);

  // Leaving the player stops the PC's conversion right away.
  useEffect(() => () => void api.stopPlayback().catch(() => undefined), [api]);

  useBackHandler(() => {
    nav.pop();
    return true;
  }, !playback || !!error);

  const restart = (next: Request) => {
    setPlayback(null);
    setRequest(next);
  };

  if (error) return <Message title={error} action={t('app.back')} onAction={nav.pop} />;
  if (!playback) return <Spinner />;
  return platform.playNative ? (
    <NativePlayer playback={playback} request={request} onRestart={restart} />
  ) : (
    <WebPlayer key={playback.streamUrl} playback={playback} request={request} onRestart={restart} />
  );
}

/** Android: the Media3 activity plays; this screen waits for it and handles restarts and the final position. */
function NativePlayer({
  playback,
  request,
  onRestart,
}: {
  playback: TvPlayback;
  request: Request;
  onRestart: (r: Request) => void;
}) {
  const { api } = useSession();
  const nav = useNav();
  useEffect(() => {
    window.__adrenalineNativeEvent = (raw: string) => {
      let e: NativePlayerEvent;
      try {
        e = JSON.parse(raw) as NativePlayerEvent;
      } catch {
        nav.pop();
        return;
      }
      if (e.itemId !== playback.itemId) return;
      if (e.type === 'restart') {
        const track = playback.subtitleTracks.find((s) => s.id === e.subtitleId) ?? null;
        onRestart({ startMs: e.positionMs, audioIndex: e.audioIndex, subtitle: subtitleRequest(track) });
        return;
      }
      void api
        .saveProgress(playback.itemId, e.ended ? (e.durationMs ?? e.positionMs) : e.positionMs, e.durationMs)
        .catch(() => undefined)
        .finally(() => invalidate('library'));
      nav.pop();
    };
    platform.playNative!({
      itemId: playback.itemId,
      url: playback.streamUrl,
      title: playback.title,
      mimeType: playback.mimeType,
      offsetMs: playback.offsetMs,
      durationMs: playback.durationMs,
      startMs: playback.mimeType === HLS ? 0 : (request.startMs ?? playback.resumeMs ?? 0),
      audioTracks: playback.audioTracks,
      subtitleTracks: playback.subtitleTracks,
    });
    return () => {
      window.__adrenalineNativeEvent = undefined;
    };
  }, [api, nav, playback, request, onRestart]);
  return <Spinner label={playback.title} />;
}

type MenuChoice =
  { kind: 'subtitle'; track: TvSubtitleTrack | null } | { kind: 'audio'; index: number; ordinal: number };

interface MenuOption {
  label: string;
  selected: boolean;
  choice: MenuChoice;
}

function WebPlayer({
  playback,
  request,
  onRestart,
}: {
  playback: TvPlayback;
  request: Request;
  onRestart: (r: Request) => void;
}) {
  const { api } = useSession();
  const nav = useNav();
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<PlayerEngine | null>(null);
  const hls = playback.mimeType === HLS;
  const openAt = hls ? 0 : (request.startMs ?? playback.resumeMs ?? 0);
  const [time, setTime] = useState(playback.offsetMs + openAt);
  const [duration, setDuration] = useState<number | null>(playback.durationMs);
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [failed, setFailed] = useState(false);
  const [controls, setControls] = useState(true);
  const [menu, setMenu] = useState<{ column: 0 | 1; row: number } | null>(null);
  const burned = playback.subtitleTracks.find((s) => s.burnedIn) ?? null;
  const [subtitleId, setSubtitleId] = useState<string | null>(
    burned?.id ?? playback.subtitleTracks.find((s) => s.kind === 'external')?.id ?? null,
  );
  const [audioIndex, setAudioIndex] = useState<number | null>(
    playback.audioTracks.find((a) => a.selected)?.index ?? null,
  );
  const [loaded, setLoaded] = useState<{ url: string; cues: Cue[] } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSave = useRef(0);
  const useAvPlay = avplayAvailable();

  /** Position in the film (the HLS stream may start later than 0). */
  const absolute = () => playback.offsetMs + (engineRef.current?.position() ?? 0);

  const save = (force = false) => {
    if (!force && Date.now() - lastSave.current < SAVE_EVERY_MS) return;
    lastSave.current = Date.now();
    void api.saveProgress(playback.itemId, absolute(), playback.durationMs).catch(() => undefined);
  };

  const showControls = () => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), CONTROLS_MS);
  };

  useEffect(() => {
    const events = {
      onTime: (ms: number) => {
        setTime(playback.offsetMs + ms);
        save();
      },
      onReady: (d: number | null) => {
        if (!playback.durationMs && d) setDuration(playback.offsetMs + d);
        setBuffering(false);
        showControls();
      },
      onEnded: () => {
        void api
          .saveProgress(playback.itemId, playback.durationMs ?? absolute(), playback.durationMs)
          .catch(() => undefined);
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
    engine.open(playback.streamUrl, openAt);
    return () => {
      save(true);
      invalidate('library');
      engine.destroy();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // One engine per stream (the component is keyed by the stream URL).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Text subtitles: fetched as WebVTT and drawn by the app (AVPlay draws video on its own plane).
  const subtitleUrl = playback.subtitleTracks.find((s) => s.id === subtitleId && !s.burnedIn)?.url ?? null;
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

  /** Seek in the film: inside the converted part locally, otherwise a new stream from there. */
  const seekTo = (target: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    const clamped = Math.max(0, Math.min(target, (playback.durationMs ?? Infinity) - 1_000));
    if (!hls) {
      engine.seek(clamped);
      return;
    }
    const local = clamped - playback.offsetMs;
    const available = engine.duration();
    if (local >= 0 && available !== null && local < available - 2_000) engine.seek(local);
    else onRestart({ ...request, startMs: Math.round(clamped), audioIndex, subtitle: subtitleRequest(burned) });
  };

  // Menu entries are plain data; choosing one runs `choose` (event handler).
  const subtitleOptions: MenuOption[] = [
    { label: t('player.off'), selected: subtitleId === null, choice: { kind: 'subtitle', track: null } },
    ...playback.subtitleTracks.map((track) => ({
      label: track.label,
      selected: track.id === subtitleId,
      choice: { kind: 'subtitle' as const, track },
    })),
  ];
  const audioOptions: MenuOption[] = playback.audioTracks.map((track, ordinal) => ({
    label: track.label,
    selected: track.index === audioIndex,
    choice: { kind: 'audio', index: track.index, ordinal },
  }));
  const columns = [subtitleOptions, audioOptions.length > 1 ? audioOptions : []];

  const choose = (choice: MenuChoice) => {
    const here = Math.round(absolute());
    if (choice.kind === 'subtitle') {
      const track = choice.track;
      setSubtitleId(track?.id ?? null);
      // Burned-in subtitles live in the picture: switching to or away from them needs a new stream.
      if (track?.kind === 'embedded-image' || burned)
        onRestart({ ...request, startMs: here, audioIndex, subtitle: subtitleRequest(track) });
      return;
    }
    if (choice.index === audioIndex) return;
    const engineTracks = engineRef.current?.audioTracks() ?? [];
    const inFile = engineTracks[choice.ordinal];
    if (!hls && inFile) {
      // Direct play on AVPlay: switch inside the file.
      engineRef.current?.selectAudio(inFile.index);
      setAudioIndex(choice.index);
    } else {
      onRestart({ ...request, startMs: here, audioIndex: choice.index, subtitle: subtitleRequest(burned) });
    }
  };

  const handle = (action: string): boolean => {
    const engine = engineRef.current;
    if (!engine) return false;
    showControls();
    if (menu) {
      const options = columns[menu.column]!;
      if (action === 'up') setMenu({ ...menu, row: Math.max(0, menu.row - 1) });
      else if (action === 'down') setMenu({ ...menu, row: Math.min(options.length - 1, menu.row + 1) });
      else if (action === 'left' || action === 'right') {
        const column = action === 'left' ? 0 : 1;
        if (columns[column]!.length > 0)
          setMenu({
            column,
            row: Math.max(
              0,
              columns[column]!.findIndex((o) => o.selected),
            ),
          });
      } else if (action === 'select') {
        const option = options[menu.row];
        if (option) choose(option.choice);
        setMenu(null);
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
        seekTo(absolute() - 10_000);
        return true;
      case 'right':
      case 'forward':
        seekTo(absolute() + 30_000);
        return true;
      case 'up':
        if (subtitleOptions.length > 1 || audioOptions.length > 1)
          setMenu({
            column: 0,
            row: Math.max(
              0,
              subtitleOptions.findIndex((o) => o.selected),
            ),
          });
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
      setMenu(null);
      return true;
    }
    nav.pop();
    return true;
  });

  const progress = duration ? (time / duration) * 100 : 0;
  const text = cueAt(cues, time);
  const titles = [t('player.subtitles'), t('player.audio')];
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
        <div className="player-menu" role="listbox">
          {columns.map((options, c) =>
            options.length > 0 ? (
              <div key={c} className={`player-column ${menu.column === c ? 'is-active' : ''}`}>
                <h3>{titles[c]}</h3>
                {options.map((o, i) => (
                  <div
                    key={`${c}-${i}`}
                    className={`player-option ${menu.column === c && menu.row === i ? 'is-focused' : ''}`}
                    role="option"
                    aria-selected={o.selected}
                  >
                    {o.label}
                    {o.selected ? ' ✓' : ''}
                  </div>
                ))}
              </div>
            ) : null,
          )}
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
        <div className="player-hint">
          {paused ? '❚❚ ' : ''}
          {playback.mode !== 'direct' ? <span className="player-mode">{t(`player.mode.${playback.mode}`)}</span> : null}
        </div>
      </div>
    </div>
  );
}
