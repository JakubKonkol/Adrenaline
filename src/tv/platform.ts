import type { TvPlatform } from '@shared/contracts/tv';

/** What the Android player gets (TvPlayback + where to start). */
export interface NativePlayRequest {
  itemId: string;
  url: string;
  title: string;
  mimeType: string;
  durationMs: number | null;
  startMs: number;
  audioTracks: { index: number; label: string; selected: boolean }[];
  subtitleTracks: { id: string; label: string; kind: string; url: string | null; burnedIn: boolean }[];
}

/**
 * Events from the Android player. `closed`: back to the app with the position. `restart`: the user chose another
 * audio track or burned-in subtitles of an HLS stream; the app asks the PC for a new stream from that position.
 */
export type NativePlayerEvent =
  | { type: 'closed'; itemId: string; positionMs: number; durationMs: number | null; ended: boolean }
  | { type: 'restart'; itemId: string; positionMs: number; audioIndex: number | null; subtitleId: string | null };

export interface Platform {
  name: TvPlatform;
  deviceName(): string;
  /** PC address prepared by Deploy to TV (Tizen: server.json in the package; Android: intent extra). */
  initialServer(): Promise<string | null>;
  /** Marker of the last installation from the PC (changes with every Deploy to TV), or null. */
  installMarker(): Promise<string | null>;
  exit(): void;
  /** Android plays in a native Media3 activity; Tizen and the browser use the <video> element. */
  playNative: ((request: NativePlayRequest) => void) | null;
}

/** Remote keys to receive on Tizen (the rest are handled by the system). */
const TIZEN_KEYS = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind'];

/** server.json written into the package by Deploy to TV. */
let serverJsonCache: Promise<{ server?: unknown; install?: unknown }> | null = null;
function serverJson() {
  serverJsonCache ??= fetch('server.json')
    .then((r) => r.json() as Promise<{ server?: unknown; install?: unknown }>)
    .catch(() => ({}));
  return serverJsonCache;
}

function tizenPlatform(tizen: TizenApi): Platform {
  for (const key of TIZEN_KEYS) {
    try {
      tizen.tvinputdevice?.registerKey(key);
    } catch {
      /* key not available on this model */
    }
  }
  return {
    name: 'tizen',
    deviceName() {
      try {
        const model = tizen.systeminfo?.getCapability('http://tizen.org/system/model_name');
        return typeof model === 'string' && model ? `Samsung ${model}`.slice(0, 60) : 'Samsung TV';
      } catch {
        return 'Samsung TV';
      }
    },
    async initialServer() {
      const body = await serverJson();
      return typeof body.server === 'string' ? body.server : null;
    },
    async installMarker() {
      const body = await serverJson();
      return typeof body.install === 'string' ? body.install.slice(0, 40) : null;
    },
    exit() {
      tizen.application.getCurrentApplication().exit();
    },
    playNative: null,
  };
}

function androidPlatform(bridge: AdrenalineNativeBridge): Platform {
  return {
    name: 'android',
    deviceName: () => bridge.deviceName().slice(0, 60) || 'Android TV',
    initialServer: () => Promise.resolve(bridge.serverUrl() || null),
    installMarker: () => Promise.resolve(bridge.installMarker?.() || null),
    exit: () => bridge.exit(),
    playNative: (request) => bridge.play(JSON.stringify(request)),
  };
}

function webPlatform(): Platform {
  return {
    name: 'web',
    deviceName: () => 'Browser',
    initialServer: () => Promise.resolve(new URLSearchParams(location.search).get('server')),
    installMarker: () => Promise.resolve(null),
    exit: () => undefined,
    playNative: null,
  };
}

export function detectPlatform(): Platform {
  if (window.tizen) return tizenPlatform(window.tizen);
  if (window.AdrenalineNative) return androidPlatform(window.AdrenalineNative);
  return webPlatform();
}

export const platform: Platform = detectPlatform();
