/** Content Security Policy of the renderer (01-architektura.md). TMDB posters load straight from image.tmdb.org. */
export const CSP_DIRECTIVES: Readonly<Record<string, string>> = {
  'default-src': "'self'",
  'script-src': "'self'",
  'style-src': "'self' 'unsafe-inline'",
  'img-src': "'self' https://image.tmdb.org data:",
  'font-src': "'self' data:",
  'connect-src': "'self'",
  'object-src': "'none'",
  'base-uri': "'none'",
  'form-action': "'none'",
  'frame-src': "'none'",
};

/** Dev server extras: Vite HMR websocket and the React Refresh inline preamble. */
const DEV_EXTRAS: Readonly<Record<string, string>> = {
  'script-src': "'unsafe-inline' http://localhost:*",
  'connect-src': 'ws://localhost:* http://localhost:*',
  'img-src': 'http://localhost:*',
  'font-src': 'http://localhost:*',
  'style-src': 'http://localhost:*',
};

export function buildCsp(opts: { dev: boolean }): string {
  return Object.entries(CSP_DIRECTIVES)
    .map(([name, value]) => {
      const extra = opts.dev ? DEV_EXTRAS[name] : undefined;
      return `${name} ${extra ? `${value} ${extra}` : value}`;
    })
    .join('; ');
}
