/** What the TV remembers between launches. localStorage can be unavailable or throw; the app then asks again. */
export interface Connection {
  server: string;
  token: string;
  deviceId: string;
  serverName: string;
}

const KEY = 'adrenaline.connection.v1';

export function loadConnection(): Connection | null {
  try {
    const raw = localStorage.getItem(KEY);
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
  try {
    localStorage.setItem(KEY, JSON.stringify(connection));
  } catch {
    /* the TV pairs again on the next launch */
  }
}

export function clearConnection(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
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
