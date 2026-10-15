# Etap 3 — Rdzeń aplikacji: dane, ustawienia, sekrety, IPC, nawigacja, zasobnik

**Cel:** solidny szkielet, na którym opierają się funkcje: trwała baza, ustawienia z UI, bezpieczne przechowywanie kluczy, typowane IPC, nawigacja między ekranami, zachowanie okna i zasobnika.

**Wymaga:** etapy 0–1 (etap 2 może trwać równolegle, ale `shutdown()` integruje oba).

## Zadania

### 3.1 Baza (`src/main/persistence`)
- `db.ts`: `new DatabaseSync(path.join(userData, 'adrenaline.db'))`, `PRAGMA journal_mode=WAL; foreign_keys=ON; busy_timeout=5000`, runner migracji po `user_version` (każda migracja w transakcji).
- `migrations/001_init.sql`: wszystkie tabele z `01-architektura.md`.
- Repozytoria: `settings-repo.ts`, `secrets-repo.ts`, `sources-repo.ts`, `media-repo.ts`, `jobs-repo.ts`, `subtitles-repo.ts`, `cache-repo.ts`. Proste funkcje z przygotowanymi zapytaniami, mapowanie wierszy na typy domeny, walidacja Zod JSON-owych kolumn przy odczycie.
- Testy na bazie `:memory:` (Vitest w Node 24 ma `node:sqlite`).
- Backup: przy każdej migracji kopia pliku `adrenaline.db.bak-<wersja>` (maks. 3).

### 3.2 Ustawienia (`settings-service.ts`)
Schemat Zod `AppSettings` z domyślnymi wartościami:
- `downloadDir` (D-75), `subtitleLang` (`pl`), `subtitleFallbackLang` (`null`), `subtitlesEnabled` (`true`)
- `maxActiveDownloads` (3), `downloadLimitKBps` (0), `uploadLimitKBps` (0), `listenPort` (losowy 49152–65535 przy pierwszym starcie)
- `seedRatioLimit` (1.0), `seedTimeLimitMin` (60) (D-70)
- `closeToTray` (`true`) (D-71), `trayNoticeShown` (`false`)
- `betaUpdates` (`false`), `onboardingDone` (`false`)
Zmiany ustawień transferu przekazywane od razu do silnika (`setLimits`).

### 3.3 Sekrety (`secrets.ts`)
- `safeStorage.encryptString` / `decryptString`, przechowywanie w tabeli `secrets`. Nazwy: `tmdb.token`, `opensubtitles.apiKey`, `opensubtitles.password`, `opensubtitles.token`, `source.<id>.apiKey`.
- Gdy `safeStorage.isEncryptionAvailable()` = false: nie zapisuj trwale, trzymaj w pamięci na czas sesji i pokaż ostrzeżenie w Ustawieniach.
- Renderer może tylko ustawić sekret i zapytać, czy istnieje. Logger redaguje wartości wszystkich sekretów (rejestr znanych wartości w pamięci).

### 3.4 IPC
- `src/shared/contracts/ipc.ts`: definicja kanałów `{ name, input: ZodSchema, output: ZodSchema }`.
- `src/main/ipc/register.ts`: generyczna funkcja `handle(channel, impl)` z walidacją nadawcy (`event.senderFrame?.url` zaczyna się od adresu własnego renderera) i schematu; błędy mapowane na `{ ok: false, error: { code, message } }`.
- Preload generowany z tej samej listy kanałów (bez ręcznego powielania nazw).
- Test jednostkowy: niepoprawne wejście → `BAD_REQUEST`, nieznany nadawca → odrzucenie.

### 3.5 Pliki i dysk (`src/main/fs`)
- `safe-path.ts` (opis w `01-architektura.md`) + rozbudowane testy (traversal, nazwy zastrzeżone, Unicode, długie ścieżki).
- `disk-space.ts`: `fs.statfs` (Node 24) → wolne bajty; `checkWritable(dir)` przez zapis i usunięcie pliku próbnego.
- `atomic-write.ts`: zapis do `*.tmp`, `fsync`, `rename`; nigdy nie nadpisuje istniejącego pliku bez flagi.
- IPC `settings:chooseFolder`: `dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })`, walidacja zapisu (FR07).

### 3.6 UI: nawigacja i ekrany bazowe
- `createHashRouter` z trasami: `/` (Wyszukiwanie), `/title/:type/:id`, `/title/:type/:id/season/:season`, `/releases`, `/download-setup`, `/downloads`, `/downloads/:jobId`, `/settings`, `/about`, `/onboarding`.
- Układ: lewy pasek nawigacji (Szukaj, Pobrane z licznikiem aktywnych, Ustawienia, O aplikacji), obszar treści, baner aktualizacji, globalny pasek błędów usług.
- Ekran Ustawień (sekcje: Pobieranie, Napisy, Transfer i seedowanie, Konta i klucze, Źródła (placeholder do etapu 5), Aplikacja). Formularze z walidacją Zod, przycisk „Zapisz”.
- Kreator pierwszego uruchomienia (`/onboarding`): folder, język napisów, klucz TMDB (z linkiem do instrukcji uzyskania klucza), opcjonalnie OpenSubtitles, źródła (etap 5 uzupełni). Można pominąć kroki opcjonalne.
- Dostępność od początku: wszystkie kontrolki z etykietami, widoczny focus, nawigacja klawiaturą, statusy z tekstem/ikoną, nie tylko kolorem (NFR08).

### 3.7 Okno i zasobnik
- `Tray` z menu: Pokaż Adrenaline, Wstrzymaj wszystko / Wznów wszystko (podpięte w etapie 6), Zakończ.
- Zamknięcie okna przy `closeToTray` → `hide()` + jednorazowe powiadomienie. „Zakończ” → `app.quit()` → `shutdown()` (FR20).
- `shutdown()` w `src/main/lifecycle.ts`: kolejno zatrzymanie kolejki, `engine.shutdown`, stop Jackett (etap 5), zamknięcie DB; każdy krok z timeoutem; łączny limit 15 s.

### 3.8 Logger
- `logger.ts` (D-23) z redakcją; IPC `app:openLogsFolder`.

## Kryteria odbioru
- [ ] Ustawienia i sekrety przetrwają restart aplikacji; sekret nigdy nie trafia do renderera ani logu (test jednostkowy loggera i IPC).
- [ ] Wybór folderu tylko do odczytu daje czytelny błąd `PATH_NOT_WRITABLE` (FR07).
- [ ] Zamknięcie okna chowa do zasobnika; „Zakończ” zamyka procesy (silnik nie zostaje w tle; sprawdź w smoke teście, że proces Electron kończy się w < 15 s).
- [ ] Testy `safe-path` obejmują traversal, nazwy zastrzeżone i Unicode (NFR06, NFR12).
- [ ] Smoke test: onboarding → zapis ustawień → restart → ustawienia zachowane.
- [ ] Wydanie `v0.3.0`.

## Poza zakresem
Funkcje wyszukiwania i pobierania.
