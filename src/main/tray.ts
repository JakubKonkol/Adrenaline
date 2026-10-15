import { Menu, Tray, nativeImage } from 'electron';
import trayIcon from '../../resources/icons/tray.png?asset';
import { mainText } from './i18n';

export interface TrayActions {
  show: () => void;
  pauseAll: () => void;
  resumeAll: () => void;
  quit: () => void;
}

/** System tray icon (etap 3.7): show window, pause/resume all, quit (through the shared shutdown). */
export function createTray(actions: TrayActions) {
  const tray = new Tray(nativeImage.createFromPath(trayIcon));
  tray.setToolTip(mainText.tray.tooltip);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: mainText.tray.show, click: actions.show },
      { type: 'separator' },
      { label: mainText.tray.pauseAll, click: actions.pauseAll },
      { label: mainText.tray.resumeAll, click: actions.resumeAll },
      { type: 'separator' },
      { label: mainText.tray.quit, click: actions.quit },
    ]),
  );
  tray.on('click', actions.show);
  return {
    setTooltip(text: string) {
      if (!tray.isDestroyed()) tray.setToolTip(text);
    },
    destroy() {
      if (!tray.isDestroyed()) tray.destroy();
    },
  };
}

export type AppTray = ReturnType<typeof createTray>;
