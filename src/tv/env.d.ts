/// <reference types="vite/client" />

declare const __TV_VERSION__: string;

/** Android shell (tv/android): `@JavascriptInterface` methods of `AdrenalineBridge`. */
interface AdrenalineNativeBridge {
  deviceName(): string;
  /** PC address passed by Deploy to TV (intent extra), or an empty string. */
  serverUrl(): string;
  /** Marker of the last installation by Deploy to TV (intent extra), or an empty string. */
  installMarker?(): string;
  /** Opens the native Media3 player with a JSON `NativePlayRequest`. */
  play(request: string): void;
  /** JSON DeviceProfile from MediaCodecList, Display HDR capabilities and AudioCapabilities (D-85). */
  deviceProfile?(): string;
  /** Durable key-value storage (SharedPreferences, written synchronously); '' when the key is missing. */
  getValue?(key: string): string;
  setValue?(key: string, value: string): void;
  removeValue?(key: string): void;
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
  /** Tizen Filesystem API (5.0+), used for the app's private folder (`wgt-private`, privileges in config.xml). */
  filesystem?: {
    openFile?(
      path: string,
      mode: 'r' | 'w',
    ): {
      readString(): string;
      writeString(value: string): void;
      flush(): void;
      close(): void;
    };
    deleteFile(path: string): void;
  };
}

interface Window {
  AdrenalineNative?: AdrenalineNativeBridge;
  tizen?: TizenApi;
  /** Called by the Android shell on the Back button; returns true when the app handled it. */
  __adrenalineBack?: () => boolean;
  /** Called by the Android shell when the native player closes (JSON `NativePlayerEvent`). */
  __adrenalineNativeEvent?: (event: string) => void;
}
