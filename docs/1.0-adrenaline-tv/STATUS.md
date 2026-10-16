# 1.0.0 — postęp implementacji (plik przekazania między agentami)

Ten plik jest **jedynym źródłem bieżącego postępu prac nad 1.0.0**. Każdy agent (Claude, Codex, inni) po zamknięciu zadania aktualizuje checkboxy, sekcję „Ostatnia sesja” i „Następne kroki”. Plan bazowy: [README.md](README.md) i [04-implementation-plan.md](04-implementation-plan.md). Decyzje: `docs/implementation-plan/00-decyzje.md` (D-80+).

## Zlecenie właściciela (16.10.2026)

1. Zaimplementować 1.0: klienci **Samsung Tizen** i **Android TV** w tym repo + zakładka TV w desktopie: podanie IP telewizora i instalacja aplikacji.
2. UI na TV nowoczesne i proste, w stylu Apple TV / serwisów streamingowych: **Search/Browse** (przeglądanie i wyszukiwanie filmów/seriali) oraz **Library** (nasza biblioteka).
3. Desktop: sprawdzić, czy po zamknięciu aplikacji/pobierania nie wiszą procesy i czy nie seedujemy w tle.
4. Po zakończeniu pobierania **automatycznie przestajemy seedować** (torrent usuwany z silnika, pliki zostają). Film pojawia się w **bibliotece** — także nowa zakładka Library w desktopie.
5. Praca autonomiczna, postęp notowany tutaj.

## Zakres tej realizacji vs plan 04

Brak fizycznych TV w środowisku agenta → bramki sprzętowe P0 (instalacja, upgrade, odtwarzanie na prawdziwym Android TV/Samsungu) **pozostają otwarte** i są opisane jako odbiór ręczny. Implementujemy wszystko, co da się zbudować i przetestować offline. Odstępstwa od planu (każde jako wpis D-xx):

- **D-80** Po pobraniu bez seedowania: torrent usuwany z silnika, nowy stan `completed`. Zastępuje D-70.
- **D-81** Wspólny webowy klient TV (`src/tv`, React) dla Tizen i Android TV. Android = natywna powłoka Kotlin (WebView z dołączonymi zasobami + odtwarzacz Media3). Zamiast osobnego UI w Compose.
- **D-82** Transport 1.0: HTTP w prywatnym LAN + parowanie zatwierdzane na PC + token urządzenia; serwer domyślnie wyłączony. TLS odłożony (wymaga testu Tizen).
- **D-83** Odtwarzanie 1.0: direct play (HTTP Range) + napisy SRT→WebVTT. Bez FFmpeg/transkodowania w 1.0.
- **D-84** Deploy: ADB i Tizen CLI wykrywane z oficjalnych instalacji (Android platform-tools, Tizen Studio), nie dołączane do instalatora. APK i zasoby Tizen dołączane.

## Zadania

### A. Desktop: procesy, seedowanie, biblioteka
- [x] A1 Audyt procesów po Quit: silnik, Jackett, osierocone procesy po awarii main (pid file + sprzątanie przy starcie).
- [x] A2 Auto-stop seedowania: po `downloaded` → `remove` w silniku (bez kasowania plików) → stan `completed`. Brak ponownego dodawania do silnika po restarcie. Migracja istniejących `downloaded/seeding/stopped`.
- [x] A3 Usunięcie ustawień seedowania z UI (Settings, Download setup, JobDetails) + D-80.
- [x] A4 `LibraryService` (projekcja ukończonych plików wideo, wykrywanie brakujących) + IPC `library:*`.
- [x] A5 Zakładka **Library** w desktopie (plakaty, odtwórz w domyślnym odtwarzaczu, pokaż w folderze, usuń).

### B. Serwer TV (main)
- [ ] B1 Ustawienia serwera (enabled, port, interfejs) + migracja `002` (tv_devices, tv_pairings w pamięci).
- [ ] B2 `src/main/tv/server.ts` na `node:http`: Host allowlist, CORS bez credentials, limity body, rate limit, redakcja.
- [ ] B3 Parowanie: kod 6 cyfr, okno 120 s, zatwierdzenie na PC, token 256 bit (hash w DB), revoke.
- [ ] B4 API: info, catalog (search, trending, details, season), release-searches, downloads (create/list/actions), library, playback tickets.
- [ ] B5 Media: Range/HEAD/416 z biletem, napisy SRT→VTT, bez dowolnych ścieżek.
- [ ] B6 Release search: właściciel sesji (desktop vs urządzenie), TV nie wypiera sesji desktopu.
- [ ] B7 Testy integracyjne API na loopback (pairing → catalog → release → download → library → media, revoke).

### C. Klient TV (web, `src/tv`)
- [ ] C1 Osobny entrypoint Vite (`vite.tv.config.ts`), target starszego Chromium (Tizen 6 ≈ M76), bez Node/Electron.
- [ ] C2 Nawigacja D-pad (spatial focus), pamięć fokusu, Back.
- [ ] C3 Ekrany: Connect/Pair, Home (Browse: trending + wyszukiwarka), Details/Seasons/Episodes, Releases, Downloads (stan), Library, Player.
- [ ] C4 Adaptery platformy: Tizen (klawisze pilota, `tizen.application.exit`), Android (most `AdrenalineNative`), przeglądarka (dev).
- [ ] C5 Testy jednostkowe logiki fokusu i klienta API.

### D. Pakiety TV
- [ ] D1 Tizen: `tv/tizen/config.xml`, ikona, skrypt składający katalog `resources/tv/tizen/web`.
- [ ] D2 Android: projekt Gradle `tv/android` (Kotlin, WebView + Media3, Leanback launcher, banner), build w Dockerze/CI.
- [ ] D3 `resources/tv/manifest.json` (wersje, SHA-256), `electron-builder.yml`, workflow release (build APK + Tizen web).

### E. Deploy to TV (desktop)
- [ ] E1 `src/main/tv/deploy/process-runner.ts` (spawn bez shell, timeout, limit wyjścia, cancel).
- [ ] E2 Android: wykrycie adb, pair (kod przez stdin), connect, install -r, launch z adresem serwera.
- [ ] E3 Tizen: wykrycie Tizen Studio, sdb connect, package z profilem certyfikatu, install, run; adres serwera wpisany do pakietu.
- [ ] E4 Zakładka **TV** w desktopie: serwer (włącz, adres, port), oczekujące parowania, urządzenia (revoke), kreator Deploy (platforma, IP TV, etapy, błędy).
- [ ] E5 Testy adapterów na stubach procesów.

### F. Dokumentacja i odbiór
- [ ] F1 `docs/user-guide.md` (TV, Library), README, decyzje D-80..D-84, `docs/implementation-plan/STATUS.md`.
- [ ] F2 Lista odbiorów ręcznych na sprzęcie (`docs/manual-tests.md`).

## Ostatnia sesja

- 16.10.2026, Claude (Opus): start. Baseline `npm run check` zielony (348 zaliczonych, 3 pominięte). Katalog dokumentacji przemianowany z `1.0-andrenalive-tv`.
- A zamknięte: `src/main/util/pid-file.ts` (sprzątanie osieroconych silnika/Jackett), stan `completed` + `DownloadService.release()` (D-80), `LibraryService` + IPC `library:*`, ekran `src/renderer/screens/library/`. Commity `e17e893`, `569af0a`, `2081a34`.

## Następne kroki

Kolejność: A → B → C → D → E → F. Commit po każdym zadaniu (`npm run check` zielony).

## Notatki środowiskowe

- Windows właściciela: Node 24, `npm run check` ok. Docker Desktop zainstalowany, domyślnie wyłączony (uruchomić do budowy APK). Java 26 lokalnie (Gradle/AGP wymaga JDK 17/21 — używać obrazu Docker).
- Brak adb/sdb/Tizen Studio lokalnie.
