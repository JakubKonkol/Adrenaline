/** Polish UI dictionary (D-22). Every UI string goes through `t()`. `{name}` marks a parameter. */
export const pl = {
  app: {
    name: 'Adrenaline',
    version: 'Wersja {version}',
    loading: 'Ładowanie…',
  },
  nav: {
    label: 'Nawigacja',
    search: 'Szukaj',
    about: 'O aplikacji',
  },
  home: {
    title: 'Znajdź film lub odcinek',
    subtitle: 'Wyszukaj tytuł, wybierz wydanie i język napisów, a Adrenaline przygotuje gotowy folder.',
  },
  updater: {
    bannerReady: 'Dostępna jest wersja {version}. Uruchom ponownie, aby zaktualizować.',
    restart: 'Uruchom ponownie i zaktualizuj',
    check: 'Sprawdź aktualizacje',
    state: {
      disabled: 'Aktualizacje są wyłączone w wersji deweloperskiej.',
      idle: 'Masz najnowszą wersję.',
      checking: 'Sprawdzanie aktualizacji…',
      downloading: 'Pobieranie aktualizacji…',
      downloadingVersion: 'Pobieranie wersji {version}… {percent}%',
      ready: 'Wersja {version} jest gotowa do instalacji.',
      error: 'Nie udało się sprawdzić aktualizacji.',
    },
  },
  engine: {
    label: 'Silnik pobierania',
    state: {
      stopped: 'Zatrzymany',
      starting: 'Uruchamianie…',
      running: 'Działa',
      restarting: 'Silnik pobierania uruchamia się ponownie…',
      crashed: 'Silnik pobierania przestał działać.',
      unavailable: 'Silnik pobierania jest niedostępny.',
    },
    versions: 'adrenaline-engine {engine} · libtorrent {libtorrent}',
    fake: 'Tryb symulacji (wersja deweloperska)',
    restart: 'Uruchom ponownie',
  },
  about: {
    title: 'O aplikacji',
    tagline: 'Film i napisy w jednym folderze.',
    versionLabel: 'Wersja',
    updatesLabel: 'Aktualizacje',
    logsLabel: 'Logi',
    engineLabel: 'Silnik',
    openLogs: 'Otwórz folder logów',
    author: 'Autor: Jakub Konkol',
  },
} as const;
