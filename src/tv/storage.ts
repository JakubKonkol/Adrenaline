/**
 * What the TV remembers between launches. The web view writes localStorage to disk lazily, so a TV that stops the app
 * soon after pairing forgot it (seen on Tizen 6.5 and Android TV 14): the connection is kept in the platform's own
 * storage as well (Android SharedPreferences, a file in the Tizen app's private folder). When nothing works the app
 * asks again.
 */
export interface Connection {
  server: string;
  token: string;
  deviceId: string;
  serverName: string;
}

const KEY = 'adrenaline.connection.v1';

/** Key-value storage of the platform, written synchronously; null when there is none (browser). */
interface DurableStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

function durable(): DurableStore | null {
  const native = window.AdrenalineNative;
  if (native?.setValue && native.getValue && native.removeValue) {
    return {
      get: (k) => native.getValue!(k) || null,
      set: (k, v) => native.setValue!(k, v),
      remove: (k) => native.removeValue!(k),
    };
  }
  const files = window.tizen?.filesystem;
  const openFile = files?.openFile?.bind(files);
  if (files && openFile) {
    const path = (k: string) => `wgt-private/${k.replace(/[^\w.-]/g, '_')}.json`;
    return {
      get: (k) => {
        try {
          const handle = openFile(path(k), 'r');
          try {
            return handle.readString() || null;
          } finally {
            handle.close();
          }
        } catch {
          return null; // not written yet
        }
      },
      set: (k, v) => {
        const handle = openFile(path(k), 'w');
        try {
          handle.writeString(v);
          handle.flush();
        } finally {
          handle.close();
        }
      },
      remove: (k) => {
        try {
          files.deleteFile(path(k));
        } catch {
          /* not there */
        }
      },
    };
  }
  return null;
}

/** A small value kept across launches (platform storage first, localStorage as a fallback). */
export function loadValue(key: string): string | null {
  try {
    const value = durable()?.get(key);
    if (value) return value;
  } catch {
    /* fall back to localStorage */
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveValue(key: string, value: string): void {
  try {
    durable()?.set(key, value);
  } catch {
    /* localStorage below */
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    /* lost on the next launch */
  }
}

function removeValue(key: string): void {
  try {
    durable()?.remove(key);
  } catch {
    /* nothing stored */
  }
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing stored */
  }
}

export function loadConnection(): Connection | null {
  try {
    const raw = loadValue(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Connection>;
    return typeof value.server === 'string' && typeof value.token === 'string' && typeof value.deviceId === 'string'
      ? { server: value.server, token: value.token, deviceId: value.deviceId, serverName: value.serverName ?? '' }
      : null;
  } catch {
    return null;
  }
}

export function saveConnection(connection: Connection): void {
  saveValue(KEY, JSON.stringify(connection));
}

export function clearConnection(): void {
  removeValue(KEY);
}

/**
 * "192.168.1.20", "192.168.1.20:18790" or a full URL → `http://host:port`. Only http(s) URLs without a path are
 * accepted; the default port is the TV server's default.
 */
export function normalizeServer(input: string, defaultPort = 18790): string | null {
  const text = input.trim();
  if (!text) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : `http://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.username || url.password || (url.pathname !== '/' && url.pathname !== '')) return null;
    if (url.search || url.hash) return null;
    const port = url.port || String(defaultPort);
    return `${url.protocol}//${url.hostname}:${port}`;
  } catch {
    return null;
  }
}
