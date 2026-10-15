import { BrowserWindow, nativeTheme } from 'electron';
import appIcon from '../../resources/icons/app.png?asset';
import { appPaths } from './paths';
import { hardenWebContents, secureWebPreferences } from './security';

/** Native chrome per theme (mirrors --bg-app / --text-secondary in tokens.css; main cannot read CSS). */
const CHROME = {
  dark: { background: '#0b0d10', symbols: '#a8b0bb' },
  light: { background: '#e9ecf0', symbols: '#4b5563' },
} as const;
const chrome = () => CHROME[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];

export const TITLE_BAR_HEIGHT = 36;

function titleBarOverlay() {
  const c = chrome();
  return { color: c.background, symbolColor: c.symbols, height: TITLE_BAR_HEIGHT };
}

export function createMainWindow(isTrusted: (url: string) => boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Adrenaline',
    icon: appIcon,
    backgroundColor: chrome().background,
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlay(),
    webPreferences: secureWebPreferences(appPaths.preload),
  });
  hardenWebContents(win.webContents, isTrusted);

  const onTheme = () => {
    if (!win.isDestroyed()) win.setTitleBarOverlay(titleBarOverlay());
  };
  nativeTheme.on('updated', onTheme);
  win.on('closed', () => nativeTheme.off('updated', onTheme));

  win.once('ready-to-show', () => win.show());
  const dev = appPaths.devRendererUrl();
  if (dev) void win.loadURL(dev);
  else void win.loadFile(appPaths.rendererIndex);
  return win;
}
