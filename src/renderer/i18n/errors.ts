import type { AppErrorCode } from '@shared/errors';

/** Polish message and suggested action for every stable error code (NFR09, 01-architektura.md "Kody błędów"). */
export const errorTexts: Record<AppErrorCode, { message: string; action: string }> = {
  BAD_REQUEST: { message: 'Nieprawidłowe dane.', action: 'Sprawdź wprowadzone wartości.' },
  FORBIDDEN: { message: 'Operacja niedozwolona.', action: 'Uruchom aplikację ponownie.' },
  INTERNAL: { message: 'Wystąpił nieoczekiwany błąd.', action: 'Spróbuj ponownie. Szczegóły są w logach.' },
  NOT_FOUND: { message: 'Nie znaleziono.', action: 'Odśwież widok.' },
  TMDB_NO_KEY: {
    message: 'Brak klucza TMDB.',
    action: 'Dodaj klucz w Ustawieniach → Konta i klucze.',
  },
  TMDB_UNAUTHORIZED: {
    message: 'Klucz TMDB jest nieprawidłowy.',
    action: 'Sprawdź klucz w Ustawieniach → Konta i klucze.',
  },
  TMDB_UNAVAILABLE: {
    message: 'Katalog filmów jest chwilowo niedostępny. Pobieranie trwa dalej.',
    action: 'Spróbuj ponownie za chwilę.',
  },
  TMDB_BAD_RESPONSE: {
    message: 'Katalog filmów zwrócił nieoczekiwaną odpowiedź.',
    action: 'Spróbuj ponownie później.',
  },
  TMDB_RATE_LIMITED: {
    message: 'Zbyt wiele zapytań do katalogu filmów.',
    action: 'Odczekaj chwilę i spróbuj ponownie.',
  },
  SOURCE_TIMEOUT: { message: 'Źródło nie odpowiedziało na czas.', action: 'Spróbuj ponownie lub wyłącz to źródło.' },
  SOURCE_BAD_RESPONSE: {
    message: 'Źródło zwróciło nieprawidłową odpowiedź.',
    action: 'Sprawdź źródło w Ustawieniach → Źródła.',
  },
  SOURCE_AUTH: { message: 'Źródło odrzuciło klucz API.', action: 'Sprawdź klucz źródła w Ustawieniach → Źródła.' },
  SOURCE_UNAVAILABLE: { message: 'Źródło jest niedostępne.', action: 'Spróbuj ponownie później.' },
  ALL_SOURCES_FAILED: {
    message: 'Nie udało się przeszukać źródeł.',
    action: 'Sprawdź połączenie z internetem i stan źródeł w Ustawieniach.',
  },
  JACKETT_UNAVAILABLE: {
    message: 'Wbudowana usługa źródeł nie działa.',
    action: 'Uruchom ją ponownie w Ustawieniach → Źródła.',
  },
  ENGINE_UNAVAILABLE: {
    message: 'Silnik pobierania jest niedostępny.',
    action: 'Zainstaluj aplikację ponownie, jeśli problem się powtarza.',
  },
  ENGINE_CRASHED: {
    message: 'Silnik pobierania przestał działać.',
    action: 'Uruchom go ponownie. Pobrane dane są zachowane.',
  },
  ENGINE_PROTOCOL_MISMATCH: {
    message: 'Wersja silnika pobierania nie pasuje do aplikacji.',
    action: 'Zainstaluj aplikację ponownie.',
  },
  ENGINE_TIMEOUT: { message: 'Silnik pobierania nie odpowiada.', action: 'Spróbuj ponownie za chwilę.' },
  ENGINE_ERROR: { message: 'Silnik pobierania zgłosił błąd.', action: 'Spróbuj ponownie. Szczegóły są w logach.' },
  DISK_FULL: {
    message: 'Brak miejsca na dysku.',
    action: 'Zwolnij miejsce albo wybierz inny folder, a potem kliknij „Ponów”.',
  },
  DISK_MISSING: {
    message: 'Dysk lub folder pobierania jest niedostępny.',
    action: 'Podłącz dysk ponownie i kliknij „Ponów”.',
  },
  PATH_NOT_WRITABLE: {
    message: 'Nie można zapisywać w tym folderze.',
    action: 'Wybierz inny folder albo sprawdź uprawnienia.',
  },
  PATH_CONFLICT: {
    message: 'W tym miejscu istnieje już plik lub folder o tej nazwie.',
    action: 'Użyj innej nazwy albo wybierz inny folder.',
  },
  PATH_TOO_LONG: {
    message: 'Ścieżka jest bardzo długa i może nie działać w systemie Windows.',
    action: 'Wybierz krótszy folder pobierania.',
  },
  UNSAFE_TORRENT_PATH: {
    message: 'Wydanie zawiera niebezpieczne ścieżki plików i zostało zatrzymane.',
    action: 'Usuń zadanie i wybierz inne wydanie.',
  },
  INVALID_MAGNET: { message: 'Link magnet jest nieprawidłowy.', action: 'Wybierz inne wydanie.' },
  INVALID_TORRENT: { message: 'Plik torrent jest uszkodzony.', action: 'Wybierz inne wydanie.' },
  TORRENT_TOO_LARGE: { message: 'Plik torrent jest zbyt duży.', action: 'Wybierz inne wydanie.' },
  METADATA_TIMEOUT: {
    message: 'Nadal szukam peerów z listą plików.',
    action: 'Poczekaj, ponów albo anuluj pobieranie.',
  },
  NO_PEERS: { message: 'Oczekiwanie na peerów.', action: 'Pobieranie ruszy, gdy pojawią się peery.' },
  DUPLICATE_JOB: { message: 'To wydanie jest już pobierane.', action: 'Przejdź do istniejącego zadania.' },
  JOB_NOT_FOUND: { message: 'Nie znaleziono zadania.', action: 'Odśwież listę pobrań.' },
  FILE_MISSING: {
    message: 'Nie znaleziono pobranych plików.',
    action: 'Podłącz dysk albo kliknij „Sprawdź ponownie”.',
  },
  SUBS_NOT_FOUND: { message: 'Nie znaleziono napisów.', action: 'Spróbuj później lub zmień język.' },
  SUBS_QUOTA: {
    message: 'Wyczerpano dzienny limit pobrań napisów.',
    action: 'Napisy zostaną pobrane po odnowieniu limitu.',
  },
  SUBS_AUTH: {
    message: 'Logowanie do OpenSubtitles nie powiodło się.',
    action: 'Zaloguj się ponownie w Ustawieniach → Konta i klucze.',
  },
  SUBS_NO_KEY: {
    message: 'Brak klucza OpenSubtitles.',
    action: 'Dodaj klucz i konto w Ustawieniach → Konta i klucze.',
  },
  SUBS_UNAVAILABLE: { message: 'Serwis napisów jest chwilowo niedostępny.', action: 'Spróbuj ponownie później.' },
  SUBS_BAD_FILE: { message: 'Pobrany plik napisów jest nieprawidłowy.', action: 'Wybierz innych kandydatów.' },
  SECRETS_UNAVAILABLE: {
    message: 'System nie pozwala bezpiecznie zapisać kluczy.',
    action: 'Klucze będą pamiętane tylko do zamknięcia aplikacji.',
  },
  UPDATE_FAILED: { message: 'Aktualizacja nie powiodła się.', action: 'Spróbuj ponownie później.' },
};
