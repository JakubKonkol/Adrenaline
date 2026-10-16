import type { TvPlatform } from '@shared/contracts/tv';

export interface NativePlayRequest {
  itemId: string;
  url: string;
  title: string;
  mimeType: string;
  subtitles: { lang: string; url: string }[];
  startMs: number;
}

export interface NativePlayerEvent {
  type: 'closed';
  itemId: string;
  positionMs: number;
  durationMs: number | null;
  ended: boolean;
}

export interface Platform {
  name: TvPlatform;
  deviceName(): string;
  /** PC address prepared by Deploy to TV (Tizen: server.json in the package; Android: intent extra). */
  initialServer(): Promise<string | null>;
  exit(): void;
  /** Android plays in a native Media3 activity; Tizen and the browser use the <video> element. */
  playNative: ((request: NativePlayRequest) => void) | null;
}

/** Remote keys to receive on Tizen (the rest are handled by the system). */
const TIZEN_KEYS = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind'];

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
      try {
        const res = await fetch('server.json');
        const body = (await res.json()) as { server?: unknown };
        return typeof body.server === 'string' ? body.server : null;
      } catch {
        return null;
      }
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
    exit: () => bridge.exit(),
    playNative: (request) => bridge.play(JSON.stringify(request)),
  };
}

function webPlatform(): Platform {
  return {
    name: 'web',
    deviceName: () => 'Browser',
    initialServer: () => Promise.resolve(new URLSearchParams(location.search).get('server')),
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
