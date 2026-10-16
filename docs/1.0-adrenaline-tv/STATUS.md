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
- ~~**D-83** Odtwarzanie 1.0: direct play (HTTP Range) + napisy SRT→WebVTT. Bez FFmpeg/transkodowania w 1.0.~~ **Zastąpione przez D-85** (polecenie Jakuba 16.10.2026, „BARDZO WAŻNE”).
- **D-85** Negocjacja odtwarzania w stylu Jellyfin: FFmpeg w instalatorze, ffprobe + cache, profil urządzenia, PlaybackPlanner (direct → remux HLS fMP4 → audio → wideo sprzętowo z tone mappingiem), AVPlay na Tizen, Media3 na Androidzie. Szczegóły: [06-playback-negotiation.md](06-playback-negotiation.md).
- **D-84** Deploy: ADB i Tizen CLI wykrywane z oficjalnych instalacji (Android platform-tools, Tizen Studio), nie dołączane do instalatora. APK i zasoby Tizen dołączane.

## Zadania

### A. Desktop: procesy, seedowanie, biblioteka
- [x] A1 Audyt procesów po Quit: silnik, Jackett, osierocone procesy po awarii main (pid file + sprzątanie przy starcie).
- [x] A2 Auto-stop seedowania: po `downloaded` → `remove` w silniku (bez kasowania plików) → stan `completed`. Brak ponownego dodawania do silnika po restarcie. Migracja istniejących `downloaded/seeding/stopped`.
- [x] A3 Usunięcie ustawień seedowania z UI (Settings, Download setup, JobDetails) + D-80.
- [x] A4 `LibraryService` (projekcja ukończonych plików wideo, wykrywanie brakujących) + IPC `library:*`.
- [x] A5 Zakładka **Library** w desktopie (plakaty, odtwórz w domyślnym odtwarzaczu, pokaż w folderze, usuń).

### B. Serwer TV (main)
- [x] B1 Ustawienia serwera (enabled, port, interfejs) + migracja `002` (tv_devices, tv_pairings w pamięci).
- [x] B2 `src/main/tv/server.ts` na `node:http`: Host allowlist, CORS bez credentials, limity body, rate limit, redakcja.
- [x] B3 Parowanie: kod 6 cyfr, okno 120 s, zatwierdzenie na PC, token 256 bit (hash w DB), revoke.
- [x] B4 API: info, catalog (search, trending, details, season), release-searches, downloads (create/list/actions), library, playback tickets.
- [x] B5 Media: Range/HEAD/416 z biletem, napisy SRT→VTT, bez dowolnych ścieżek.
- [x] B6 Release search: właściciel sesji (desktop vs urządzenie), TV nie wypiera sesji desktopu.
- [x] B7 Testy integracyjne API na loopback (pairing → catalog → release → download → library → media, revoke).

### C. Klient TV (web, `src/tv`)
- [x] C1 Osobny entrypoint Vite (`vite.tv.config.ts`), target starszego Chromium (Tizen 6 ≈ M76), bez Node/Electron.
- [x] C2 Nawigacja D-pad (spatial focus), pamięć fokusu, Back.
- [x] C3 Ekrany: Connect/Pair, Home (Browse: trending + wyszukiwarka), Details/Seasons/Episodes, Releases, Downloads (stan), Library, Player.
- [x] C4 Adaptery platformy: Tizen (klawisze pilota, `tizen.application.exit`), Android (most `AdrenalineNative`), przeglądarka (dev).
- [x] C5 Testy jednostkowe logiki fokusu i klienta API.

### D. Pakiety TV
- [x] D1 Tizen: `tv/tizen/config.xml`, ikona, skrypt składający katalog `resources/tv/tizen/web`.
- [x] D2 Android: projekt Gradle `tv/android` (Kotlin, WebView + Media3, Leanback launcher, banner), build w Dockerze/CI.
- [x] D3 `resources/tv/manifest.json` (wersje, SHA-256), `electron-builder.yml`, workflow release (build APK + Tizen web).

### E. Deploy to TV (desktop)
- [x] E1 `src/main/tv/deploy/process-runner.ts` (spawn bez shell, timeout, limit wyjścia, cancel).
- [x] E2 Android: wykrycie adb, pair (kod przez stdin), connect, install -r, launch z adresem serwera.
- [x] E3 Tizen: wykrycie Tizen Studio, sdb connect, package z profilem certyfikatu, install, run; adres serwera wpisany do pakietu.
- [x] E4 Zakładka **TV** w desktopie: serwer (włącz, adres, port), oczekujące parowania, urządzenia (revoke), kreator Deploy (platforma, IP TV, etapy, błędy).
- [x] E5 Testy adapterów na stubach procesów.

### G. Negocjacja odtwarzania (D-85, BARDZO WAŻNE — warunek wydania 1.0) — [06-playback-negotiation.md](06-playback-negotiation.md)
- [x] G1 FFmpeg/ffprobe: `scripts/fetch-ffmpeg.mjs`, wersja + SHA-256 w repo, krok w `release.yml`, `resources/ffmpeg`, notices/licencja GPL w instalatorze, lokalizacja binariów w main.
- [x] G2 `probe.ts` + migracja `003` (`media_probe`): kontener, kodek/profil, bit depth, HDR10/HDR10+/HLG/DV (profil 5/7/8), audio (TrueHD/Atmos, E-AC3 JOC, DTS-HD), napisy (SRT/ASS/PGS).
- [x] G3 `DeviceProfile` (kontrakt) + `planPlayback()` w `src/shared/domain/playback.ts` + fixtures ffprobe i testy wszystkich gałęzi.
- [x] G4 Wykrycie enkoderów (NVENC/QSV/AMF/CPU) i budowa argumentów FFmpeg (remux HLS fMP4, audio E-AC3/AAC, wideo HW + tone mapping, burn-in PGS/ASS).
- [x] G5 Transcoder: sesje HLS, 1 transkod naraz, seek = restart, kill drzewa procesów po stop/seek/quit/revoke, cache z limitem miejsca.
- [x] G6 API: `POST /playback/:itemId` z profilem urządzenia → plan; `/media/:ticket/hls/*` za biletem; wybór ścieżek audio/napisów.
- [ ] G7 Klient Tizen: odtwarzacz AVPlay (ścieżki, napisy, HLS, passthrough) + profil z `webapis.avinfo`/`productinfo` i tabeli modeli.
- [ ] G8 Klient Android: Media3 z passthrough (`AudioCapabilities`), wybór ścieżek, profil z `MediaCodecList`/`Display.HdrCapabilities`.
- [x] G9 Ustawienia PC (hwaccel, max rozdzielczość/bitrate, limit cache) + diagnostyka sesji odtwarzania w zakładce TV.
- [ ] G10 `docs/manual-tests.md`: odbiór 4K DV P5/P8, HDR10, Atmos, DTS-HD, PGS na sprzęcie.

### F. Dokumentacja i odbiór
- [ ] F1 `docs/user-guide.md` (TV, Library), README, decyzje D-80..D-84, `docs/implementation-plan/STATUS.md`.
- [ ] F2 Lista odbiorów ręcznych na sprzęcie (`docs/manual-tests.md`).

## Ostatnia sesja

- 16.10.2026, Claude (Opus): start. Baseline `npm run check` zielony (348 zaliczonych, 3 pominięte). Katalog dokumentacji przemianowany z `1.0-andrenalive-tv`.
- A zamknięte: `src/main/util/pid-file.ts` (sprzątanie osieroconych silnika/Jackett), stan `completed` + `DownloadService.release()` (D-80), `LibraryService` + IPC `library:*`, ekran `src/renderer/screens/library/`. Commity `e17e893`, `569af0a`, `2081a34`.

- B zamknięte (`c921810`): `src/main/tv/{server,api,pairing,devices,media,network,tv-service}.ts`, migracja `002_tv.sql`, ustawienia `tvServer*`, IPC `tv:*`, właściciel sesji wyszukiwania. Test integracyjny `src/main/tv/tv-api.test.ts` (loopback, FakeEngine).
- C zamknięte (`6cbfd0f`): `src/tv` (React, build `npm run build:tv` → `out/tv`, IIFE + CSP, target chrome69, reguły ESLint na nowe API). Ekrany: Connect/pairing, Discover (hero + rzędy + wyszukiwarka), Details (sezony/odcinki), Releases (+ potwierdzenie), Library (kontynuuj, pobierane, filmy, seriale), Show, Player (AVPlay na Tizen / `<video>` / natywny na Androidzie, własny renderer VTT), Settings. Przegląd wizualny: demo `npx vitest run -c scripts/dev/vitest.tv-demo.config.ts` + `npm run dev:tv` + `node scripts/dev/tv-screens.mjs <out> [obrazy]` (pilotem: strzałki/Enter/Escape).

- G (`ae2fb3b`, `de84f3f`): FFmpeg 9.0.2 Gyan `full_build-shared` (SHA-256 w `scripts/ffmpeg-sha256.txt`, `scripts/fetch-ffmpeg.mjs`, w instalatorze `resources/ffmpeg` + LICENSE/SOURCE.txt), `src/main/media/{probe,probe-cache,hwaccel,ffmpeg-args,transcoder,media-service}.ts`, migracja `003_media_probe.sql`, planner `src/shared/domain/playback.ts` (fixtures `tests/fixtures/ffprobe`), trasy `/media/:ticket/hls/...`, napisy osadzone `e<index>.vtt`, ustawienia `transcode*`. Test z prawdziwym FFmpeg `src/main/media/ffmpeg-real.test.ts` (lokalnie NVENC + libplacebo; w CI ścieżka CPU/zscale). AVPlay (G7) i Media3 (G8) zaimplementowane bez testu na sprzęcie.
- D (`de84f3f`): `tv/tizen/config.xml` + `scripts/tv/prepare-tizen.mjs` (webapis.js, CSP w config.xml), `tv/android` (Kotlin: MainActivity/WebView, AdrenalineBridge, DeviceCapabilities, PlayerActivity/Media3; Gradle 8.11.1 wrapper zweryfikowany SHA-256; build w Dockerze `ghcr.io/cirruslabs/android-sdk:35`), `scripts/tv/write-manifest.mjs`, workflow `.github/workflows/tv-android.yml` (CI + Release), `electron-builder.yml` (ffmpeg, tv).
- E (`02439d6`): `src/main/tv/deploy/{process-runner,toolchain,deploy-service}.ts`, IPC `tv:toolchain|chooseTool|deploy|deployCancel|deployState`, zakładka `src/renderer/screens/tv/TvScreen.tsx` (serwer, parowanie, urządzenia, kreator, diagnostyka i ustawienia konwersji). Zrzuty desktopu: `scripts/dev/desktop-tv-screens.mjs` (WSL/xvfb). Smoke Electron w WSL: 1/1.

## Następne kroki

Kolejność: A → B → C → G → D → E → F. G jest warunkiem wydania 1.0 (polecenie właściciela).

Do zrobienia: F1/F2 (dokumentacja, odbiory ręczne), G7/G8/G10 — odbiór na sprzęcie. **Sekrety CI dla podpisu APK** (Jakub, w GitHub → Settings → Secrets): `ADRENALINE_ANDROID_KEYSTORE_BASE64`, `ADRENALINE_ANDROID_KEYSTORE_PASSWORD`, `ADRENALINE_ANDROID_KEY_ALIAS`, `ADRENALINE_ANDROID_KEY_PASSWORD`; bez nich APK jest podpisany kluczem debug (manifest `signing: debug`) i późniejsza zmiana klucza wymaga odinstalowania aplikacji na TV. Commit po każdym zadaniu (`npm run check` zielony).

## Notatki środowiskowe

- Windows właściciela: Node 24, `npm run check` ok. Docker Desktop zainstalowany, domyślnie wyłączony (uruchomić do budowy APK). Java 26 lokalnie (Gradle/AGP wymaga JDK 17/21 — używać obrazu Docker).
- Brak adb/sdb/Tizen Studio lokalnie.
