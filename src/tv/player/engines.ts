/**
 * Playback engines behind one interface. Tizen: AVPlay (Samsung's native player: HLS, audio passthrough, track
 * selection — D-85). Browser/dev: the <video> element. Android uses a native Media3 activity instead (platform.ts).
 */
export interface EngineEvents {
  onTime(ms: number): void;
  onReady(durationMs: number | null): void;
  onEnded(): void;
  onError(code: string): void;
  onBuffering(buffering: boolean): void;
}

export interface PlayerEngine {
  open(url: string, startMs: number): void;
  play(): void;
  pause(): void;
  seek(ms: number): void;
  readonly paused: boolean;
  position(): number;
  duration(): number | null;
  /** Audio tracks reported by the engine (Tizen); empty when not available. */
  audioTracks(): { index: number; label: string }[];
  selectAudio(index: number): void;
  /** Whole picture with bars (fit) or the screen filled, cropping the edges (fill). */
  setFit(fit: 'fit' | 'fill'): void;
  destroy(): void;
}

// ---------------------------------------------------------------- AVPlay (Tizen)

interface AvPlayTrack {
  index: number;
  type: string;
  extra_info: string;
}

export interface AvPlay {
  open(url: string): void;
  close(): void;
  prepareAsync(ok: () => void, err: (e: unknown) => void): void;
  play(): void;
  pause(): void;
  stop(): void;
  seekTo(ms: number, ok?: () => void, err?: (e: unknown) => void): void;
  getCurrentTime(): number;
  getDuration(): number;
  getState(): string;
  setDisplayRect(x: number, y: number, w: number, h: number): void;
  setDisplayMethod?(method: string): void;
  setListener(listener: Record<string, (...args: unknown[]) => void>): void;
  getTotalTrackInfo?(): AvPlayTrack[];
  setSelectTrack?(type: string, index: number): void;
}

declare global {
  interface Window {
    webapis?: {
      avplay?: AvPlay;
      avinfo?: Record<string, (...args: unknown[]) => unknown>;
      productinfo?: Record<string, (...args: unknown[]) => unknown>;
    };
  }
}

export function avplayAvailable(): boolean {
  return !!window.webapis?.avplay;
}

function audioLabel(extra: string, index: number): string {
  try {
    const info = JSON.parse(extra) as { language?: string; fourCC?: string; channels?: number };
    return (
      [info.language, info.fourCC, info.channels ? `${info.channels}ch` : null].filter(Boolean).join(' · ') ||
      `Audio ${index + 1}`
    );
  } catch {
    return `Audio ${index + 1}`;
  }
}

export function createAvPlayEngine(av: AvPlay, events: EngineEvents): PlayerEngine {
  let paused = false;
  let opened = false;
  return {
    open(url, startMs) {
      av.open(url);
      opened = true;
      // The video plane covers the whole 1920×1080 widget (the web layer stays on top for controls/subtitles).
      av.setDisplayRect(0, 0, 1920, 1080);
      av.setDisplayMethod?.('PLAYER_DISPLAY_MODE_LETTER_BOX');
      av.setListener({
        onbufferingstart: () => events.onBuffering(true),
        onbufferingcomplete: () => events.onBuffering(false),
        oncurrentplaytime: (ms) => events.onTime(Number(ms)),
        onstreamcompleted: () => events.onEnded(),
        onerror: (e) => events.onError(String(e)),
      });
      av.prepareAsync(
        () => {
          const start = () => {
            av.play();
            const d = av.getDuration();
            events.onReady(d > 0 ? d : null);
          };
          if (startMs > 0) av.seekTo(startMs, start, start);
          else start();
        },
        (e) => events.onError(String(e)),
      );
    },
    play() {
      av.play();
      paused = false;
    },
    pause() {
      av.pause();
      paused = true;
    },
    seek(ms) {
      av.seekTo(Math.max(0, Math.round(ms)));
    },
    get paused() {
      return paused;
    },
    position: () => av.getCurrentTime(),
    duration: () => {
      const d = av.getDuration();
      return d > 0 ? d : null;
    },
    audioTracks: () =>
      (av.getTotalTrackInfo?.() ?? [])
        .filter((t) => t.type === 'AUDIO')
        .map((t) => ({ index: t.index, label: audioLabel(t.extra_info, t.index) })),
    selectAudio: (index) => av.setSelectTrack?.('AUDIO', index),
    setFit(fit) {
      try {
        av.setDisplayMethod?.(fit === 'fill' ? 'PLAYER_DISPLAY_MODE_FULL_SCREEN' : 'PLAYER_DISPLAY_MODE_LETTER_BOX');
      } catch {
        /* not available in this state */
      }
    },
    destroy() {
      if (!opened) return;
      try {
        av.stop();
      } catch {
        /* already stopped */
      }
      av.close();
      opened = false;
    },
  };
}

// ---------------------------------------------------------------- <video> (browser)

export function createVideoEngine(video: HTMLVideoElement, events: EngineEvents): PlayerEngine {
  const on = <K extends keyof HTMLVideoElementEventMap>(name: K, fn: () => void) => video.addEventListener(name, fn);
  on('timeupdate', () => events.onTime(video.currentTime * 1000));
  on('waiting', () => events.onBuffering(true));
  on('playing', () => events.onBuffering(false));
  on('ended', () => events.onEnded());
  on('error', () => events.onError(String(video.error?.code ?? 'MEDIA_ERROR')));
  return {
    open(url, startMs) {
      video.src = url;
      video.addEventListener(
        'loadedmetadata',
        () => {
          if (startMs > 0) video.currentTime = startMs / 1000;
          events.onReady(Number.isFinite(video.duration) ? video.duration * 1000 : null);
          void video.play().catch(() => undefined);
        },
        { once: true },
      );
      video.load();
    },
    play: () => void video.play().catch(() => undefined),
    pause: () => video.pause(),
    seek: (ms) => {
      video.currentTime = Math.max(0, ms / 1000);
    },
    get paused() {
      return video.paused;
    },
    position: () => video.currentTime * 1000,
    duration: () => (Number.isFinite(video.duration) ? video.duration * 1000 : null),
    audioTracks: () => [],
    selectAudio: () => undefined,
    setFit(fit) {
      video.style.objectFit = fit === 'fill' ? 'cover' : 'contain';
    },
    destroy() {
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
  };
}
