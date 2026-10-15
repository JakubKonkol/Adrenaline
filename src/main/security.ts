import { pathToFileURL } from 'node:url';
import { session, shell, type WebContents, type WebPreferences } from 'electron';
import { buildCsp } from '@shared/security/csp';
import { isAllowedExternalUrl } from './external-links';

export function secureWebPreferences(preload: string): WebPreferences {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: false,
  };
}

/** Builds the check for "our own renderer": the packaged index.html (any hash route) or the dev server origin. */
export function createTrustedUrlCheck(opts: { indexHtmlPath: string; devUrl: string | null }) {
  const indexUrl = pathToFileURL(opts.indexHtmlPath).href;
  const devOrigin = opts.devUrl ? new URL(opts.devUrl).origin : null;
  return (raw: string): boolean => {
    try {
      const url = new URL(raw);
      if (devOrigin !== null) return url.origin === devOrigin;
      url.hash = '';
      url.search = '';
      return url.href === indexUrl;
    } catch {
      return false;
    }
  };
}

/** Blocks navigation outside the renderer, new windows and webviews; https links go to the browser after checks. */
export function hardenWebContents(contents: WebContents, isTrusted: (url: string) => boolean): void {
  contents.on('will-navigate', (event, url) => {
    if (!isTrusted(url)) {
      event.preventDefault();
      if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    }
  });
  contents.on('will-redirect', (event, url) => {
    if (!isTrusted(url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

/** Denies all permission requests (camera, notifications from the page, etc.) and sets the CSP header. */
export function hardenSession(opts: { dev: boolean }): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  const csp = buildCsp(opts);
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') {
      callback({});
      return;
    }
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
}
