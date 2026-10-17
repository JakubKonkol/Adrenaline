import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TvLibraryItem, TvPlayback, TvSubtitleTrack } from '@shared/contracts/tv';
import { ApiError, type PlaybackRequest } from '../api';
import { invalidate } from '../data';
import { errorText, t } from '../i18n';
import { useQuery } from '../data';
import { useBackHandler, useMediaKeys, useNav } from '../nav';
import { type NativePlayerEvent, platform } from '../platform';
import { avplayAvailable, createAvPlayEngine, createVideoEngine, type PlayerEngine } from '../player/engines';
import { OsdButton, Scrubber, Sheet, type SheetItem, Stats } from '../player/osd';
import { episodeLabel, nextEpisode } from '../player/next';
import { cycle, loadPrefs, type PlayerPrefs, savePrefs, SUBTITLE_POSITIONS, SUBTITLE_SIZES } from '../player/prefs';
import { deviceProfile } from '../player/profile';
import { type Cue, cueAt, parseVtt } from '../player/vtt';
import { useSession } from '../session';
import { Button, Message, Spinner } from '../ui';

const SAVE_EVERY_MS = 15_000;
const CONTROLS_MS = 5_000;
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
 * or a VOD HLS stream of the whole film that the PC converts on demand (remux / audio / video), so seeking is native.
 * Another audio track (for HLS) or image subtitles start a new stream from the current position.
 */
/** Set while the player hands over to the next episode: the PC's conversion must not be stopped then. */
let handingOver = false;

export function Player({ itemId }: { itemId: string }) {
  const { api } = useSession();
  const nav = useNav();
  const profile = useMemo(() => deviceProfile(platform.name), []);
  const [request, setRequest] = useState<Request>({});
  const [playback, setPlayback] = useState<TvPlayback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upNext, setUpNext] = useState(false);
  // The next episode on the PC, for the "next" button and the "Up next" screen (Jellyfin style).
  const library = useQuery('library', () => api.library());
  const next = useMemo(() => nextEpisode(library.data ?? [], itemId), [library.data, itemId]);

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

  // Leaving the player stops the PC's conversion right away (the next episode replaces it by itself).
  useEffect(
    () => () => {
      if (!handingOver) void api.stopPlayback().catch(() => undefined);
      handingOver = false;
    },
    [api],
  );

  useBackHandler(() => {
    nav.pop();
    return true;
  }, !playback || !!error);

  const restart = useCallback((r: Request) => {
    setPlayback(null);
    setRequest(r);
  }, []);
  const playNext = useCallback(() => {
    if (!next) return;
    handingOver = true;
    nav.replace({ name: 'player', itemId: next.id });
  }, [nav, next]);
  const ended = useCallback(() => (next ? setUpNext(true) : nav.pop()), [nav, next]);

  if (upNext && next) return <UpNext next={next} onPlay={playNext} onCancel={nav.pop} />;
  if (error) return <Message title={error} action={t('app.back')} onAction={nav.pop} />;
  if (!playback) return <Spinner />;
  return platform.playNative ? (
    <NativePlayer playback={playback} request={request} onRestart={restart} onEnded={ended} />
  ) : (
    <WebPlayer
      key={playback.streamUrl}
      playback={playback}
      request={request}
      onRestart={restart}
      onEnded={ended}
      onNext={next ? playNext : null}
    />
  );
}

const UP_NEXT_SECONDS = 10;

/** After an episode: the next one starts in a few seconds unless the viewer goes back. */
function UpNext({ next, onPlay, onCancel }: { next: TvLibraryItem; onPlay: () => void; onCancel: () => void }) {
  const [left, setLeft] = useState(UP_NEXT_SECONDS);
  useEffect(() => {
    const timer = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (left <= 0) onPlay();
  }, [left, onPlay]);
  useBackHandler(() => {
    onCancel();
    return true;
  });
  return (
    <div className="up-next" data-page="">
      <div className="up-next-card">
        <div className="up-next-kicker">{t('player.upNext')}</div>
        <h1>{next.title}</h1>
        <p>{episodeLabel(next)}</p>
        <div className="up-next-count">{t('player.startsIn', { seconds: Math.max(0, left) })}</div>
        <div className="actions">
          <Button primary autoFocus focusKey="up-next-play" onSelect={onPlay}>
            {t('player.playNow')}
          </Button>
          <Button focusKey="up-next-back" onSelect={onCancel}>
            {t('app.back')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Android: the Media3 activity plays; this screen waits for it and handles restarts and the final position. */
function NativePlayer({
  playback,
  request,
  onRestart,
  onEnded,
}: {
  playback: TvPlayback;
  request: Request;
  onRestart: (r: Request) => void;
  onEnded: () => void;
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
      if (e.ended) onEnded();
      else nav.pop();
    };
    platform.playNative!({
      itemId: playback.itemId,
      url: playback.streamUrl,
      title: playback.title,
      mimeType: playback.mimeType,
      durationMs: playback.durationMs,
      startMs: request.startMs ?? playback.resumeMs ?? 0,
      audioTracks: playback.audioTracks,
      subtitleTracks: playback.subtitleTracks,
    });
    return () => {
      window.__adrenalineNativeEvent = undefined;
    };
  }, [api, nav, playback, request, onRestart, onEnded]);
  return <Spinner label={playback.title} />;
}

type Panel = 'subtitles' | 'audio' | 'settings' | 'style';
type ButtonId = 'rewind' | 'play' | 'forward' | 'next' | 'subtitles' | 'audio' | 'settings';

/** One row of a sheet and what it does (choose on OK, change with left/right). */
interface Row extends SheetItem {
  /** What the row does, run by the key handler: `sub:off`, `sub:<track id>`, `audio:<ordinal>`, `size`, … */
  id: string;
  /** Left/right change its value. */
  adjustable?: boolean;
}

const SEEK_BACK_MS = 10_000;
const SEEK_FORWARD_MS = 30_000;
/** Scrubbing collects presses and seeks once the remote is quiet for this long. */
const SCRUB_COMMIT_MS = 800;
const DELAY_STEP_MS = 250;

/** The subtitle track to show first: burned in, the language chosen last time, or the PC's sidecar file. */
export function initialSubtitle(tracks: TvSubtitleTrack[], lang: string | null): TvSubtitleTrack | null {
  const burned = tracks.find((s) => s.burnedIn);
  if (burned) return burned;
  if (lang === '') return null;
  const shown = tracks.filter((s) => s.kind !== 'embedded-image');
  if (lang) {
    const same = shown.filter((s) => s.lang && s.lang.toLowerCase().startsWith(lang.toLowerCase().slice(0, 2)));
    const pick = same.find((s) => s.kind === 'external') ?? same[0];
    if (pick) return pick;
  }
  return shown.find((s) => s.kind === 'external') ?? null;
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Tizen (AVPlay) and browser player with a Jellyfin-style OSD: scrubber with preview, rewind/play/forward, subtitle
 * and audio track sheets, subtitle look and sync, picture fit and playback info. Text subtitles are drawn by the app.
 */
function WebPlayer({
  playback,
  request,
  onRestart,
  onEnded,
  onNext,
}: {
  playback: TvPlayback;
  request: Request;
  onRestart: (r: Request) => void;
  onEnded: () => void;
  /** Plays the next episode (null for films and the last episode). */
  onNext: (() => void) | null;
}) {
  const { api } = useSession();
  const nav = useNav();
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<PlayerEngine | null>(null);
  const hls = playback.mimeType === HLS;
  const openAt = request.startMs ?? playback.resumeMs ?? 0;
  const [time, setTime] = useState(openAt);
  const [duration, setDuration] = useState<number | null>(playback.durationMs);
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [failed, setFailed] = useState(false);
  const [controls, setControls] = useState(true);
  const [zone, setZone] = useState<'bar' | 'buttons'>('buttons');
  const [button, setButton] = useState<ButtonId>('play');
  const [panel, setPanel] = useState<{ kind: Panel; row: number } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [prefs, setPrefs] = useState<PlayerPrefs>(loadPrefs);
  const [delay, setDelay] = useState(0);
  const [stats, setStats] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const burned = playback.subtitleTracks.find((s) => s.burnedIn) ?? null;
  const [subtitleId, setSubtitleId] = useState<string | null>(
    () => initialSubtitle(playback.subtitleTracks, prefs.subtitleLang)?.id ?? null,
  );
  const [audioIndex, setAudioIndex] = useState<number | null>(
    playback.audioTracks.find((a) => a.selected)?.index ?? null,
  );
  const [loaded, setLoaded] = useState<{ url: string; cues: Cue[] } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrubTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSave = useRef(0);
  const useAvPlay = avplayAvailable();

  const position = () => engineRef.current?.position() ?? 0;

  const save = (force = false) => {
    if (!force && Date.now() - lastSave.current < SAVE_EVERY_MS) return;
    lastSave.current = Date.now();
    void api.saveProgress(playback.itemId, position(), playback.durationMs).catch(() => undefined);
  };

  const updatePrefs = (next: Partial<PlayerPrefs>) => {
    setPrefs((p) => {
      const merged = { ...p, ...next };
      savePrefs(merged);
      return merged;
    });
  };

  useEffect(() => {
    // AVPlay renders below the web page, including its html/body backgrounds.
    if (useAvPlay) document.documentElement.classList.add('avplay-active');
    const events = {
      onTime: (ms: number) => {
        setTime(ms);
        save();
      },
      onReady: (d: number | null) => {
        if (!playback.durationMs && d) setDuration(d);
        setBuffering(false);
        engineRef.current?.setFit(prefs.fit);
      },
      onEnded: () => {
        void api
          .saveProgress(playback.itemId, playback.durationMs ?? position(), playback.durationMs)
          .catch(() => undefined);
        invalidate('library');
        onEnded();
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
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      save(true);
      invalidate('library');
      engine.destroy();
      clearInterval(tick);
      document.documentElement.classList.remove('avplay-active');
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (scrubTimer.current) clearTimeout(scrubTimer.current);
    };
    // One engine per stream (the component is keyed by the stream URL).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The OSD hides itself after a few seconds of playback without remote input.
  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (controls && !paused && !panel && preview === null)
      hideTimer.current = setTimeout(() => setControls(false), CONTROLS_MS);
  }, [controls, paused, panel, preview, zone, button]);

  // Text subtitles: fetched as WebVTT and drawn by the app (AVPlay draws video on its own plane).
  const subtitle = playback.subtitleTracks.find((s) => s.id === subtitleId) ?? null;
  const subtitleUrl = subtitle && !subtitle.burnedIn ? subtitle.url : null;
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

  const clampSeek = (target: number) => Math.max(0, Math.min(target, (duration ?? Infinity) - 1_000));

  /** Seek in the film (HLS too: the PC starts converting at the new position by itself). */
  const seekTo = (target: number) => {
    const clamped = clampSeek(target);
    engineRef.current?.seek(clamped);
    setTime(clamped);
  };

  /** Scrubbing: each press moves the preview; the seek happens when the presses stop. */
  const scrub = (delta: number) => {
    const target = clampSeek((preview ?? position()) + delta);
    setPreview(target);
    if (scrubTimer.current) clearTimeout(scrubTimer.current);
    scrubTimer.current = setTimeout(() => {
      seekTo(target);
      setPreview(null);
    }, SCRUB_COMMIT_MS);
  };

  const commitScrub = () => {
    if (preview === null) return false;
    if (scrubTimer.current) clearTimeout(scrubTimer.current);
    seekTo(preview);
    setPreview(null);
    return true;
  };

  const togglePlay = () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.paused) engine.play();
    else engine.pause();
    setPaused(engine.paused);
  };

  const chooseSubtitle = (track: TvSubtitleTrack | null) => {
    setSubtitleId(track?.id ?? null);
    updatePrefs({ subtitleLang: track ? (track.lang ?? '') : '' });
    // Burned-in subtitles live in the picture: switching to or away from them needs a new stream.
    if (track?.kind === 'embedded-image' || burned)
      onRestart({ ...request, startMs: Math.round(position()), audioIndex, subtitle: subtitleRequest(track) });
  };

  const chooseAudio = (index: number, ordinal: number) => {
    if (index === audioIndex) return;
    const inFile = engineRef.current?.audioTracks()[ordinal];
    if (!hls && inFile) {
      // Direct play on AVPlay: switch inside the file.
      engineRef.current?.selectAudio(inFile.index);
      setAudioIndex(index);
    } else {
      onRestart({ ...request, startMs: Math.round(position()), audioIndex: index, subtitle: subtitleRequest(burned) });
    }
  };

  const signed = (ms: number) => `${ms > 0 ? '+' : ms < 0 ? '−' : ''}${(Math.abs(ms) / 1000).toFixed(2)} s`;
  const sheets: Record<Panel, { title: string; rows: Row[] }> = {
    subtitles: {
      title: t('player.subtitles'),
      rows: [
        { id: 'sub:off', label: t('player.off'), selected: subtitleId === null },
        ...playback.subtitleTracks.map((track) => ({
          id: `sub:${track.id}`,
          label: track.label,
          hint:
            track.kind === 'external'
              ? t('player.downloaded')
              : track.kind === 'embedded-image'
                ? t('player.burnIn')
                : undefined,
          selected: track.id === subtitleId,
        })),
        { id: 'open:style', label: t('player.subtitleSettings') },
      ],
    },
    audio: {
      title: t('player.audio'),
      rows: playback.audioTracks.map((track, ordinal) => ({
        id: `audio:${ordinal}`,
        label: track.label,
        selected: track.index === audioIndex,
      })),
    },
    style: {
      title: t('player.subtitleSettings'),
      rows: [
        { id: 'size', adjustable: true, label: t('player.size'), value: t(`player.sizes.${prefs.subtitleSize}`) },
        {
          id: 'background',
          adjustable: true,
          label: t('player.background'),
          value: t(`player.backgrounds.${prefs.subtitleBackground}`),
        },
        {
          id: 'position',
          adjustable: true,
          label: t('player.position'),
          value: String(SUBTITLE_POSITIONS.indexOf(prefs.subtitlePosition) + 1),
        },
        { id: 'delay', adjustable: true, label: t('player.delay'), hint: t('player.delayHint'), value: signed(delay) },
      ],
    },
    settings: {
      title: t('player.settings'),
      rows: [
        { id: 'fit', adjustable: true, label: t('player.picture'), value: t(`player.fits.${prefs.fit}`) },
        { id: 'open:style', label: t('player.subtitleSettings') },
        { id: 'info', label: t('player.info'), selected: stats },
      ],
    },
  };

  /** Runs a sheet row: OK (step 0) or left/right (±1). */
  const runRow = (id: string, step: 0 | 1 | -1) => {
    const by: 1 | -1 = step === -1 ? -1 : 1;
    if (id === 'sub:off') chooseSubtitle(null);
    else if (id.startsWith('sub:')) chooseSubtitle(playback.subtitleTracks.find((x) => `sub:${x.id}` === id) ?? null);
    else if (id.startsWith('audio:')) {
      const ordinal = Number(id.slice(6));
      const track = playback.audioTracks[ordinal];
      if (track) chooseAudio(track.index, ordinal);
    } else if (id === 'open:style') setPanel({ kind: 'style', row: 0 });
    else if (id === 'size') updatePrefs({ subtitleSize: cycle(SUBTITLE_SIZES, prefs.subtitleSize, by) });
    else if (id === 'background')
      updatePrefs({ subtitleBackground: prefs.subtitleBackground === 'box' ? 'shadow' : 'box' });
    else if (id === 'position')
      updatePrefs({ subtitlePosition: cycle(SUBTITLE_POSITIONS, prefs.subtitlePosition, by) });
    else if (id === 'delay') setDelay((d) => (step === 0 ? 0 : d + step * DELAY_STEP_MS));
    else if (id === 'fit') {
      const fit = prefs.fit === 'fit' ? 'fill' : 'fit';
      updatePrefs({ fit });
      engineRef.current?.setFit(fit);
    } else if (id === 'info') setStats((x) => !x);
  };

  const buttons: ButtonId[] = ['rewind', 'play', 'forward'];
  if (onNext) buttons.push('next');
  buttons.push('subtitles');
  if (playback.audioTracks.length > 1) buttons.push('audio');
  buttons.push('settings');

  const openPanel = (kind: Panel) => {
    const rows = sheets[kind].rows;
    setPanel({
      kind,
      row: Math.max(
        0,
        rows.findIndex((r) => r.selected),
      ),
    });
  };

  const press = (id: ButtonId) => {
    if (id === 'rewind') scrub(-SEEK_BACK_MS);
    else if (id === 'forward') scrub(SEEK_FORWARD_MS);
    else if (id === 'play') togglePlay();
    else if (id === 'next') onNext?.();
    else openPanel(id);
  };

  const showControls = () => {
    setControls(true);
  };

  const handle = (action: string): boolean => {
    if (!engineRef.current) return false;
    // Media keys work the same in every state.
    switch (action) {
      case 'playPause':
        togglePlay();
        showControls();
        return true;
      case 'play':
        engineRef.current.play();
        setPaused(false);
        return true;
      case 'pause':
        engineRef.current.pause();
        setPaused(true);
        showControls();
        return true;
      case 'rewind':
        showControls();
        setZone('bar');
        scrub(-SEEK_BACK_MS);
        return true;
      case 'forward':
        showControls();
        setZone('bar');
        scrub(SEEK_FORWARD_MS);
        return true;
      case 'stop':
        nav.pop();
        return true;
    }
    if (panel) {
      const rows = sheets[panel.kind].rows;
      const focusable = (i: number) => i >= 0 && i < rows.length && !rows[i]!.heading;
      if (action === 'up' || action === 'down') {
        let i = panel.row + (action === 'up' ? -1 : 1);
        while (i >= 0 && i < rows.length && !focusable(i)) i += action === 'up' ? -1 : 1;
        if (focusable(i)) setPanel({ ...panel, row: i });
      } else if (action === 'left' || action === 'right') {
        const row = rows[panel.row];
        if (row?.adjustable) runRow(row.id, action === 'left' ? -1 : 1);
      } else if (action === 'select') {
        const row = rows[panel.row];
        if (row) {
          runRow(row.id, 0);
          // Choosing a track closes the sheet; settings stay open to change more.
          if ((panel.kind === 'subtitles' || panel.kind === 'audio') && !row.id.startsWith('open:')) setPanel(null);
        }
      }
      return true;
    }
    if (!controls) {
      // Hidden OSD: left/right scrub at once, anything else brings the OSD up.
      showControls();
      if (action === 'left' || action === 'right') {
        setZone('bar');
        scrub(action === 'left' ? -SEEK_BACK_MS : SEEK_FORWARD_MS);
      } else {
        setZone('buttons');
        setButton('play');
      }
      return true;
    }
    showControls();
    if (zone === 'bar') {
      if (action === 'left' || action === 'right') scrub(action === 'left' ? -SEEK_BACK_MS : SEEK_FORWARD_MS);
      else if (action === 'down') {
        commitScrub();
        setZone('buttons');
      } else if (action === 'select') {
        if (!commitScrub()) togglePlay();
      }
      return true;
    }
    const i = buttons.indexOf(button);
    if (action === 'left') setButton(buttons[Math.max(0, i - 1)]!);
    else if (action === 'right') setButton(buttons[Math.min(buttons.length - 1, i + 1)]!);
    else if (action === 'up') setZone('bar');
    else if (action === 'down') setControls(false);
    else if (action === 'select') press(button);
    return true;
  };

  useMediaKeys(handle);
  useBackHandler(() => {
    if (panel) {
      setPanel(panel.kind === 'style' ? { kind: 'subtitles', row: 0 } : null);
      return true;
    }
    if (preview !== null) {
      if (scrubTimer.current) clearTimeout(scrubTimer.current);
      setPreview(null);
      return true;
    }
    if (controls && !paused) {
      setControls(false);
      return true;
    }
    nav.pop();
    return true;
  });

  const osd = controls || paused || !!panel;
  const shown = time;
  const text = cueAt(cues, shown - delay);
  const remaining = duration !== null ? Math.max(0, duration - (preview ?? shown)) : null;
  // Only the data of the rows goes to the view (their actions run in the key handler).
  const sheetView = panel
    ? {
        title: sheets[panel.kind].title,
        row: panel.row,
        items: sheets[panel.kind].rows.map(({ label, value, selected, heading, hint }): SheetItem => ({
          label,
          value,
          selected,
          heading,
          hint,
        })),
      }
    : null;
  const audioLabel = playback.audioTracks.find((a) => a.index === audioIndex)?.label ?? '—';
  const labels: Record<ButtonId, string> = {
    rewind: t('player.rewind'),
    play: paused ? t('player.play') : t('player.pause'),
    forward: t('player.forward'),
    next: t('player.nextEpisode'),
    subtitles: t('player.subtitles'),
    audio: t('player.audio'),
    settings: t('player.settings'),
  };
  return (
    <div
      className={`player ${useAvPlay ? 'is-avplay' : ''} ${osd ? 'controls-on' : ''} fit-${prefs.fit}`}
      aria-label={playback.title}
    >
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
        <div
          className={`subtitle-line sub-${prefs.subtitleSize} sub-${prefs.subtitleBackground}`}
          style={{ bottom: `${osd ? Math.max(prefs.subtitlePosition, 30) : prefs.subtitlePosition}%` }}
        >
          {text.split('\n').map((line, i) => (
            <span key={i}>{line}</span>
          ))}
        </div>
      ) : null}
      {stats ? (
        <Stats
          rows={[
            [
              t('player.statsMode'),
              playback.mode === 'direct' ? t('player.direct') : t(`player.mode.${playback.mode}`),
            ],
            [t('player.statsSource'), playback.source],
            [t('player.statsOutput'), playback.output],
            [t('player.audio'), audioLabel],
            [t('player.subtitles'), subtitle ? subtitle.label : t('player.off')],
            [t('player.statsWhy'), playback.reasons.join('; ')],
          ]}
        />
      ) : null}
      <div className={`osd-top ${osd ? 'is-visible' : ''}`}>
        <div>
          <div className="osd-title">{playback.title}</div>
          {playback.mode !== 'direct' ? <div className="player-mode">{t(`player.mode.${playback.mode}`)}</div> : null}
        </div>
        <div className="osd-clock">{clock(now)}</div>
      </div>
      <div className={`osd ${osd ? 'is-visible' : ''}`}>
        <div className="osd-times">
          <span className="player-time">{formatTime(preview ?? shown)}</span>
          <span className="osd-ends">
            {remaining !== null ? t('player.endsAt', { time: clock(now + remaining) }) : ''}
          </span>
          <span className="player-time">{remaining !== null ? `−${formatTime(remaining)}` : ''}</span>
        </div>
        <Scrubber
          time={shown}
          duration={duration}
          preview={preview}
          focused={zone === 'bar' && !panel}
          format={formatTime}
        />
        <div className="osd-buttons">
          <div className="osd-group">
            {buttons
              .filter((id) => id === 'rewind' || id === 'play' || id === 'forward' || id === 'next')
              .map((id) => (
                <OsdButton
                  key={id}
                  icon={id === 'play' ? (paused ? 'play' : 'pause') : id}
                  label={labels[id]}
                  focused={zone === 'buttons' && button === id && !panel}
                />
              ))}
          </div>
          <div className="osd-group osd-group-end">
            {buttons
              .filter((id) => id === 'subtitles' || id === 'audio' || id === 'settings')
              .map((id) => (
                <OsdButton
                  key={id}
                  icon={id}
                  label={labels[id]}
                  focused={zone === 'buttons' && button === id && !panel}
                />
              ))}
          </div>
        </div>
      </div>
      {sheetView ? <Sheet title={sheetView.title} items={sheetView.items} row={sheetView.row} /> : null}
    </div>
  );
}
