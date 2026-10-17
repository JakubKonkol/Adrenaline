# 1.0.0 — postęp implementacji

**NAJNOWSZY STAN — 17.10.2026, Codex:** lokalny odbiór 1.0.0 zakończony. Check: **456 zaliczonych / 4 pominięte**, lint i typecheck czyste. Build desktop/TV/APK, smoke Windows 1/1, prawdziwy silnik 4/4 i NSIS zaliczone. Samsung QE65Q77BATXXH: automatyczna aktualizacja i parowanie, przycisk Next episode oraz koniec S01E01 → odliczanie → S01E02 z AVPlay PLAYING. Historia: [REVIEW-HANDOVER.md](REVIEW-HANDOVER.md).

Ten plik jest źródłem bieżącego postępu. Plan: [04-implementation-plan.md](04-implementation-plan.md), decyzje D-80…D-87: [00-decyzje.md](../implementation-plan/00-decyzje.md).

## Zakres i decyzje

- D-80: po pobraniu torrent usuwany z silnika bez kasowania plików; stan `completed`, brak seedowania w tle. Desktop Windows x64 pozostaje serwerem; Samsung Tizen i Android TV przeglądają katalog, pobierają na PC i odtwarzają bibliotekę.
- D-81: wspólny React w `src/tv`, IIFE dla `file://`; Android ma powłokę Kotlin i Media3, Samsung AVPlay.
- D-82: HTTP w prywatnym LAN, serwer domyślnie wyłączony, parowanie zatwierdzane na PC, token urządzenia i bilety mediów.
- D-85/D-87: FFmpeg w instalatorze, negocjacja direct → remux HLS VOD MPEG-TS → audio → wideo z tone mappingiem. Segmenty na klatkach kluczowych, natywny seek, pauza bez utraty sesji, bufor do przodu do 5 min.
- D-86/D-87: instalacja po IP bez SDK, przypięte ADB/SDB pobierane automatycznie; Tizen podpis lokalny i trwały autor. Fallback legacy tylko po odrzuceniu nowego łańcucha. Start i parowanie automatyczne, połączenie zapisane trwale na TV.

## Zadania

- [x] A1–A5 Desktop: sprzątanie osieroconych silnika/Jackett, auto-stop seedowania, migracja stanów, usunięcie ustawień seedowania, LibraryService i zakładka Library.
- [x] B1–B7 Serwer TV: migracja 002, Host allowlista, CORS, limity/redakcja, parowanie i revoke, API katalogu/wydań/pobrań/biblioteki, Range/HEAD/416, napisy i bilety, oddzielne sesje wyszukiwania, testy integracyjne.
- [x] C1–C5 Klient: osobny build TV, D-pad i pamięć fokusu, ekrany, adaptery platform i testy.
- [x] D1–D3 Pakiety: Tizen, Android Kotlin/Media3, manifest SHA-256, bundle w instalatorze i workflow.
- [x] E1–E5 Deploy: runner z timeout/cancel i zabijaniem drzewa, automatyczne adb/SDB, podpisy Tizen/fallback/Advanced, zakładka TV i testy.
- [x] G1–G4 FFmpeg/ffprobe z przypiętym SHA-256, licencja i źródło w `resources/ffmpeg` instalatora; probe/cache, planner, fixtures, wykrycie enkoderów, tone mapping i burn-in.
- [x] G5 HLS VOD MPEG-TS, indeks klatek kluczowych, limit cache/bufora; po 60 s pauzy zatrzymany proces, sesja dostępna 6 h. Pauza 95 s na Samsungu działa.
- [x] G6 API planu/mediów, wybór ścieżek.
- [x] G7 Samsung AVPlay: 12 formatów, HLS/direct, seek, napisy, pauza i następny odcinek sprawdzone na QE65Q77BATXXH (Tizen 6.5). Ocena obrazu/dźwięku przez widza i passthrough do AVR pozostają ręczne.
- [ ] G8 Fizyczny Android TV: passthrough/DV do odbioru. Emulator Android TV 14: instalacja, parowanie, Media3 direct/HLS, seek, zgodność napisów i trwałe połączenie potwierdzone w poprzedniej sesji.
- [x] G9–G10 Ustawienia konwersji i diagnostyka, lista odbiorów sprzętowych.
- [x] F1–F2 Instrukcja użytkownika (Windows Firewall, Android bez SDK, OSD, Up next), D-87, opis odtwarzania, aktualne testy ręczne.
- [x] Odbiór lokalny 1.0.0: check, build, TV/APK, smoke, silnik i NSIS.

## Ostatnia sesja

17.10.2026, Codex: dodano trzy testy `nextEpisode`/etykiet (kolejność i sezon, niedostępne pliki, inny serial, film i koniec biblioteki). Samsung przyjął aktualizację z tym samym autorem, uruchomił aplikację i sparował się automatycznie. Pilotem przez CDP: przycisk Next episode uruchamia S01E02; rzeczywisty koniec S01E01 otwiera Up next i po 10 s S01E02 osiąga PLAYING. Bez podmiany zdarzenia końca odtwarzania.

Smoke używa wolnego portu, aby działać obok serwera demo, i zamyka Electron również po błędzie. Sprawdzono wersję ASAR, manifest, hashe APK i wszystkich plików Tizen oraz obecność FFmpeg/Jackett/silnika i notices. Instalator: `dist/Adrenaline-Setup-1.0.0.exe`, 233 295 521 B, SHA-256 `592c70ec47841778021f57196fc2a96df20455b6fa0437a6fdf16f03c8571779`. `extract-zip` pozostaje w devDependencies, bo używają go skrypty pobierania FFmpeg i Jackett.

## Następne kroki i ograniczenia

1. Commit na main i push z tagiem v1.0.0 zgodnie z poleceniem właściciela; Release workflow buduje i publikuje instalator z artefaktami CI.
2. Odbiory ręczne: fizyczny Android TV (passthrough/DV), AVR i ocena obrazu/dźwięku oraz wyglądu OSD na ekranie TV. Przeglądarka i stan PLAYING nie zastępują oceny widza.
3. Android bez sekretów release używa stałego klucza deweloperskiego. Zmiana klucza wymaga reinstalacji. Odnowienie łańcucha autora Tizen przed 2027-01-01 musi zachować klucz; nie usuwać `author.json`.
4. `npm audit --omit=dev`: 1 high, node-forge GHSA-86w9-cpqp-85rv, brak poprawki. Dotyczy weryfikacji RSA PKCS#1, której kod aplikacji nie używa: forge generuje/parsuje przypięte certyfikaty, a podpisy WGT weryfikuje Node crypto w testach. Ocena zakresu: brak wywołania podatnej operacji w obecnej ścieżce. Audyt pozostaje nieczysty; aktualizacja zależności po wydaniu poprawki.

## Ważne dla kolejnych sesji

- Nie zmieniać TV na moduły ES: pakiety korzystają z `file://` i IIFE z targetem chrome69; Zod nie może trafić do paczki TV.
- Prawdziwy FFmpeg w testach wymaga `vendor/ffmpeg`; `npm run test:engine` wymaga `ADRENALINE_ENGINE_PATH`.
- Narzędzia sprzętowe: `scripts/dev/tv-demo.test.ts`, `tizen-deploy.test.ts`, `tv-deploy.test.ts`. Autor w `%APPDATA%/adrenaline/tv-deploy/author.json` — nie kasować ani publikować.
- PowerShell: używać `npm.cmd`/`npx.cmd`. Android budowany Dockerem, wolumen `adrenaline-gradle`.
