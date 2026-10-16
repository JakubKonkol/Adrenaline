/** Hosts the app may open in the user's browser (`shell.openExternal`); everything else is ignored. */
const ALLOWED_HOSTS = new Set([
  'www.themoviedb.org',
  'themoviedb.org',
  'developer.themoviedb.org',
  'www.opensubtitles.com',
  'opensubtitles.com',
  'github.com',
  // Deploy to TV instructions (official tools and developer mode, D-84).
  'developer.android.com',
  'developer.samsung.com',
]);

export function isAllowedExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.username === '' && url.password === '' && ALLOWED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}
