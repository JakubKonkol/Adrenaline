/** Polish strings shown by main itself (tray, notifications, dialogs); the renderer has its own dictionary. */
export const mainText = {
  tray: {
    tooltip: 'Adrenaline',
    show: 'Pokaż Adrenaline',
    pauseAll: 'Wstrzymaj wszystko',
    resumeAll: 'Wznów wszystko',
    quit: 'Zakończ',
  },
  notice: {
    trayTitle: 'Adrenaline działa w tle',
    trayBody: 'Pobieranie trwa dalej. Aby zamknąć aplikację, wybierz „Zakończ” w menu ikony w zasobniku.',
  },
  dialog: {
    chooseFolder: 'Wybierz folder pobierania',
  },
} as const;
