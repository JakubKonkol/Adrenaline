/// <reference types="vite/client" />

declare const __TV_VERSION__: string;

/** Android shell (tv/android): `@JavascriptInterface` methods of `AdrenalineBridge`. */
interface AdrenalineNativeBridge {
  deviceName(): string;
  /** PC address passed by Deploy to TV (intent extra), or an empty string. */
  serverUrl(): string;
  /** Opens the native Media3 player with a JSON `NativePlayRequest`. */
  play(request: string): void;
  exit(): void;
}

interface TizenApplication {
  exit(): void;
  hide(): void;
}

interface TizenApi {
  application: { getCurrentApplication(): TizenApplication };
  tvinputdevice?: { registerKey(name: string): void };
  systeminfo?: { getCapability(key: string): unknown };
}

interface Window {
  AdrenalineNative?: AdrenalineNativeBridge;
  tizen?: TizenApi;
  /** Called by the Android shell on the Back button; returns true when the app handled it. */
  __adrenalineBack?: () => boolean;
  /** Called by the Android shell when the native player closes (JSON `NativePlayerEvent`). */
  __adrenalineNativeEvent?: (event: string) => void;
}
