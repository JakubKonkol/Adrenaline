/** Strings shown by main itself (tray, notifications, dialogs); the renderer has its own dictionary. */
export const mainText = {
  tray: {
    tooltip: 'Adrenaline',
    show: 'Show Adrenaline',
    pauseAll: 'Pause all',
    resumeAll: 'Resume all',
    quit: 'Quit',
  },
  notice: {
    trayTitle: 'Adrenaline is running in the background',
    trayBody: 'Downloads keep running. To close the app, choose “Quit” in the tray icon menu.',
  },
  dialog: {
    chooseFolder: 'Choose the download folder',
  },
} as const;
