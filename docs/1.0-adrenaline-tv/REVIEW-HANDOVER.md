# Review i prosty deploy Samsung — przekazanie 16/17.10.2026

## NAJNOWSZY STAN — odbiór 1.0.0, Codex 17.10.2026

Właściciel zlecił dokończenie, commit na main oraz push z tagiem v1.0.0. Wersja package/lockfile i zbudowanych klientów: **1.0.0**. Aktualny postęp i ograniczenia: [STATUS.md](STATUS.md).

**Zakończone:** commit `061051e` i anotowany tag `v1.0.0` wysłane na origin. [Release workflow](https://github.com/JakubKonkol/Adrenaline/actions/runs/39018081348) w całości zielony. [Wydanie v1.0.0](https://github.com/JakubKonkol/Adrenaline/releases/tag/v1.0.0) publiczne od 17.10.2026 08:44:32 UTC; instalator CI 232 241 553 B, SHA-256 `216aaa1ef27fd269592364200b1d66fbfb337909fbfd76fb9bdc4a9a29cccee4`, blockmap i latest.yml. To instalator z CI jest artefaktem wydania; lokalny próbny NSIS opisano niżej. Serwer demo i aplikacja TV zamknięte po odbiorze, autor/certyfikaty pozostawione.

- Samsung QE65Q77BATXXH, Tizen 6.5, 192.168.1.212: realny automatyczny DeployService, fallback legacy po odrzuceniu nowego łańcucha, aktualizacja z zachowanym autorem, start i auto-parowanie — `handshake done`.
- Ostatnia funkcja sprawdzona na tym TV przez CDP i stan AVPlay: pilotem wybrano **Next episode** w S01E01 → S01E02 PLAYING, bez przycisku następnego odcinka (ostatni dostępny). Ponownie S01E01, seek do ostatnich 4 s → prawdziwe zdarzenie końca → **Up next / S01E02 · Drift / Starts in 10 s** → automatycznie S01E02 PLAYING. Nie podmieniano listenera ani stanu React.
- Trzy nowe testy nextEpisode/episodeLabel: nieposortowana biblioteka, kolejny sezon, brak pliku, inny serial, film, nieznany element i koniec biblioteki.
- Dokumentacja: D-87, HLS VOD MPEG-TS i indeksy klatek, auto-adb, trwałe połączenie i znacznik instalacji, instrukcja OSD/Up next, pierwsze pytanie Windows Firewall, aktualne wyniki i ograniczenia odbiorów.
- Końcowe `npm.cmd run check`: **456 passed / 4 skipped**, lint/typecheck czyste. Build desktop, build TV, przygotowanie Tizen/Android, APK w Dockerze, manifest, smoke Windows **1/1**, realny silnik **4/4**, `pack:win` — zaliczone.
- Smoke wcześniej kolidował z serwerem demo na 18790; teraz wybiera wolny port systemowy, a cleanup zamyka Electron również po błędzie (wcześniej błąd EPERM sprzątania zasłaniał pierwotny konflikt).
- NSIS `dist/Adrenaline-Setup-1.0.0.exe`: **233 295 521 B**, SHA-256 `592c70ec47841778021f57196fc2a96df20455b6fa0437a6fdf16f03c8571779`. ASAR i manifest mają 1.0.0, APK i wszystkie pliki Tizen zgodne z hashami; FFmpeg LICENSE/SOURCE są w `resources/ffmpeg`. Publiczny instalator z CI będzie przebudowany z silnikiem i licencjami z joba Engine.
- `extract-zip` potrzebne w devDependencies dla fetch-ffmpeg/fetch-jackett. `npm audit --omit=dev`: **1 high node-forge**, GHSA-86w9-cpqp-85rv, bez poprawki. Ocena zakresu: aplikacja nie używa podatnej weryfikacji RSA PKCS#1; forge służy do generowania i odczytu przypiętych certyfikatów, podpisy WGT w testach sprawdza Node crypto. Audyt nie jest czysty; monitorować poprawkę zależności.
- Ograniczenia pozostają jawne: fizyczny Android TV/passthrough/DV nieodebrane, obraz i dźwięk nowego playera nieocenione przez widza, Tizen CA wymaga odnowienia przed 2027-01-01. Nie usuwać ani nie publikować `author.json`.

## Poprzedni stan — sesja Claude 17.10.2026 (historia)

**Ta sekcja ma pierwszeństwo przed wszystkim niżej. Nic nie commitowano ani nie pushowano (zmiany z tej i poprzedniej sesji są w working tree), brak tagu, wersja 0.9.0.** Ostatni `npm.cmd run check`: **453 passed / 4 skipped**, lint i typecheck czyste.

### Co zrobiono (wzorowane na Jellyfinie — klony w `../jellyfin` i `../jellyfin-web`, GPL: przeniesiono rozwiązania, nie kod)

1. **HLS przepisany w stylu Jellyfin** (`src/main/media/{transcoder,ffmpeg-args,keyframes}.ts`):
   - Playlista **VOD całego filmu** generowana przez serwer (`#EXT-X-ENDLIST`), przewijanie natywne w AVPlay i Media3; `offsetMs` usunięty z kontraktu i klientów.
   - **Zawsze MPEG-TS** (AVPlay odrzucał fMP4 z HEVC HDR; Media3 gra TS). Planner: kopiowane do HLS tylko h264/hevc oraz aac/ac3/eac3/mp3/mp2; DV profil 5 w HLS → tone mapping; DV 7/8 → warstwa bazowa. `hlsSegments`/fMP4 usunięte.
   - Granice segmentów = **klatki kluczowe z indeksu pliku** (MKV Cues, MP4 stss+ctts+elst, inne: skan ffprobe ≤30 s, cache `userData/keyframes`), zachłannie ≥6 s; kodowanie = równe 6 s z wymuszonymi IDR (`-forced-idr 1`).
   - FFmpeg: muxer `segment` z `-segment_times` (względne do startu przebiegu), `-copyts -start_at_zero`, `-ss` = start segmentu +0,5 s przy kopii (ffmpeg cofa się ~0,13 s przy B-klatkach — jak Jellyfin), lista gotowych segmentów `ffmpeg.csv` (nigdy nie serwujemy segmentu w trakcie zapisu).
   - Transcoder: restart FFmpeg przy żądaniu segmentu daleko od bieżącego (luka >24 s lub wstecz), **limit bufora do przodu 5 min** (FFmpeg zatrzymywany, wznawiany 2 min przed końcem), **pauza bezpieczna** (idle 60 s zatrzymuje tylko FFmpeg, sesja żyje 6 h), 2 nieudane przebiegi → TV_UNSUPPORTED_MEDIA. Testy: `transcoder.test.ts`, `keyframes.test.ts`, `ffmpeg-real.test.ts` (realny FFmpeg: cięcie na klatkach 0/7/14/21/28 s, seek do 21 s trafia dokładnie, kodowanie od segmentu 2 ma IDR w 12 i 18 s), `tv-hls.test.ts`.
   - To zamyka 3 problemy review: pauza 60 s, brak limitu bufora, przesunięte napisy na Androidzie po przewinięciu.
2. **Nowy odtwarzacz Tizen (OSD jak Jellyfin)** — `src/tv/screens/Player.tsx`, `src/tv/player/{osd.tsx,prefs.ts,next.ts}`, style w `src/tv/styles.css`: tytuł+tryb+zegar, czas/pozostało/„Ends at”, scrubber z podglądem (seek po puszczeniu), przyciski −10/▶❚❚/+30/następny odcinek/napisy/audio/ustawienia, arkusz napisów (Off, ścieżki, „Downloaded by Adrenaline”, obrazkowe = wypalane), ustawienia napisów (rozmiar, tło, wysokość, synchronizacja ±0,25 s) zapamiętywane, wybór ostatniego języka napisów, dopasowanie obrazu (fit/fill), panel „Playback info” (plik, co dostaje TV, dlaczego — pola `source`/`output` w `TvPlayback`). **„Up next”**: po odcinku odliczanie 10 s i następny odcinek z biblioteki (też na Androidzie po zakończeniu Media3). Zrzuty z Chrome: `test-results/osd-shots.mjs`.
3. **Android**: `PlayerActivity` — natywny seek (bez restartów), menu MENU/klawisz audio „Audio & subtitles” dla HLS (inna ścieżka audio / napisy wypalane → nowy strumień z bieżącej pozycji), napisy VTT zgodne z czasem filmu.
4. **Instalator „podaj IP i tyle”**:
   - Android: **automatyczne pobranie oficjalnego adb** (`src/main/tv/deploy/android-tools.ts`, platform-tools r37.0.1, SHA-1 zgodny z katalogiem Google, przypięty SHA-256), UI bez wymogu SDK (Advanced: własne adb).
   - Po instalacji aplikacja na TV **sama rozpoczyna parowanie** (adres z `server.json` / extra), a nowy znacznik `install` (Tizen `server.json`, Android `--es install`) wymusza parowanie także przy nieważnym tokenie i przejmuje aktualny adres PC.
   - **Trwały zapis połączenia**: WebView gubił `localStorage`, gdy TV ubijał aplikację tuż po parowaniu (potwierdzone na Samsungu i Androidzie). Teraz Android `SharedPreferences` (bridge `getValue/setValue/removeValue`), Tizen plik `wgt-private/…json` (nowe przywileje `filesystem.read/write` w `tv/tizen/config.xml`; `tizen.preference` nie istnieje na Tizen 6.5).
   - Token unieważniony w trakcie działania (401) → od razu ekran parowania (wcześniej nieskończone 401).
   - Tizen: profil wg Jellyfina (FLAC poza direct play, MPEG-2/VC-1/PCM/Vorbis/MP2 natywnie); schemat kodeka dopuszcza `_`.

### Zweryfikowano na sprzęcie

- **Samsung QE65Q77BATXXH (Tizen 6.5), IP 192.168.1.212**: pełny automatyczny DeployService wielokrotnie `done` (nowy łańcuch odrzucany → jednorazowy fallback legacy → instalacja → start → auto-parowanie). Macierz 12 formatów (serwer demo, klipy z wypalonym czasem): direct H.264/AAC MP4, VP9/Opus WebM, AV1/Opus MKV, MPEG-2/MP2 TS, H.264/E-AC3 MP4, HEVC HDR10/E-AC3 MP4; HLS-kopia: **Saltwind 4K HEVC HDR10 + TrueHD→E-AC3 (wcześniejszy błąd — gra)**, H.264+DTS, HEVC+FLAC, MOV+PCM; kodowanie: XviD/MP3 AVI, H.264 10-bit. Wszystkie `PLAYING`, przewijanie +30 s, napisy zgodne z pozycją. Pauza 95 s na HLS → płynne wznowienie. Ubicie aplikacji 1,5 s po parowaniu → połączenie zachowane. Zrzuty CDP na Tizenie nie działają (TV zrywa WS) — weryfikacja przez stan AVPlay; **użytkownik nie oglądał jeszcze obrazu/dźwięku tej wersji**.
- **Android TV 14 (emulator, scratchpad SDK)**: DeployService `done`, auto-parowanie, Media3 gra Saltwind (HLS TS), seek +30 s: czas w obrazie 00:00:50.28 = napis „cue at 00:50”. Ubicie po parowaniu → połączenie zachowane. Brak fizycznego Android TV (passthrough/DV nadal do odbioru).

### Do zrobienia (niewiele)

1. **Ostatnia zmiana niesprawdzona na sprzęcie: „Up next”/przycisk „Next episode” i przeniesienie etykiety trybu pod tytuł** (typecheck/lint/check zielone). Przebudować i obejrzeć: `npm.cmd run build:tv && node scripts/tv/prepare-tizen.mjs && node scripts/tv/prepare-android.mjs`, APK w Dockerze (polecenie niżej), `node scripts/tv/write-manifest.mjs`, deploy (`scripts/dev/tizen-deploy.test.ts`, zmienne jak niżej). Odtworzyć odcinek Orbit Station S01E01 do końca → ekran „Up next” → S01E02.
2. Dopisać test jednostkowy `nextEpisode` (`src/tv/player/next.ts`) w `src/tv/tv-logic.test.ts`.
3. Dokumentacja: decyzja **D-87** w `docs/implementation-plan/00-decyzje.md` (HLS VOD MPEG-TS w stylu Jellyfin, klatki z indeksu, auto-adb, znacznik instalacji, trwały zapis), `docs/1.0-adrenaline-tv/06-playback-negotiation.md` (fMP4 → TS VOD, segment muxer), `docs/user-guide.md` (Android bez SDK, OSD, Up next), `docs/manual-tests.md`, `STATUS.md` (G5 zamknięte, G7 zweryfikowane na Samsungu). Usunąć zbędne `extract-zip` z dependencies, jeśli nadal nieużywane; `npm audit` node-forge nadal do decyzji (patrz niżej).
4. Pełny odbiór końcowy: `npm.cmd run check`, `npm.cmd run build`, smoke (`npm.cmd run test:smoke`), `npm.cmd run pack:win` i dopiero potem commit(y) na `main` (autor Jakub Konkol, bez trailerów AI) i — **po potwierdzeniu przez Jakuba** — `npm version 1.0.0` + push tagu.
5. Drobne UX: na Androidzie napis VTT nachodzi na pasek czasu Media3 przy widocznych kontrolkach; w przeglądarce (dev) Chrome nie odtwarza HLS (tylko platforma deweloperska). Zapora Windows: spakowany Electron przy pierwszym nasłuchu w LAN pokaże pytanie systemu — opisać w user-guide.

### Środowisko do wznowienia

- Serwer demo: `TV_DEMO_LAN=1 npx.cmd vitest run -c scripts/dev/vitest.tv-demo.config.ts scripts/dev/tv-demo.test.ts --disableConsoleIntercept` (bez `TV_TIZEN_ADDRESS` zatwierdza każde parowanie; z nim wdraża na Samsunga przy starcie). Macierz klipów w cache `%TEMP%/adr-tv-demo-clips-v2` (generowana raz, ffmpeg z PATH). Każdy start = nowa baza; TV sparuje się sam po ponownym deployu (znacznik instalacji).
- Deploy na Samsunga do działającego demo: `TV_TIZEN_ADDRESS=192.168.1.212 TV_DEMO_DB=<katalog demo>\demo.db TV_SERVER=http://192.168.1.174:18790 npx.cmd vitest run -c scripts/dev/vitest.tv-demo.config.ts scripts/dev/tizen-deploy.test.ts`. Narzędzia/autor w `%APPDATA%/adrenaline/tv-deploy` — **nie kasować `author.json`**. Reguła zapory `Adrenaline-TV-review-18790` (node.exe, Private) nadal istnieje.
- APK: Docker Desktop (`MSYS_NO_PATHCONV=1 docker run --rm -v "<repo>:/work" -v adrenaline-gradle:/root/.gradle -w /work/tv/android ghcr.io/cirruslabs/android-sdk:35 ./gradlew --no-daemon -q assembleRelease`).
- Narzędzia sesji w scratchpadzie agenta (mogą zniknąć): CDP do TV (`sdb shell 0 debug AdrnlnTV01.Adrenaline` → port → `sdb forward`), skrypty `relaunch.sh`, `tv.sh`, `play.sh`, `killtest.sh`; emulator Android TV 14 (`emulator -avd atv14`, dane 2 GB). Dysk C: ok. 148 GB wolne.

---

## Poprzedni stan — koniec sesji Codex 17.10.2026 (historia)

**Ta sekcja zastępuje historyczne „następne kroki” niżej. Zatrzymano pracę, bez commita, pushu, tagu i wydania. Wersja nadal 0.9.0.**

### Weryfikacja i poprawki tej sesji

- Naprawiono dwa błędy TypeScript w `torznab-client.test.ts`: Buffer kopiowany do Uint8Array, argument fetch normalizowany również dla Request; bez rzutowań wyciszających błąd.
- Ostatni pełny `npm.cmd run check`: **438 passed / 4 skipped**, 55 plików OK / 2 skipped. Dodatkowy skip to opt-in test pobierania Tizen. Lint i typecheck OK. Realne FFmpeg wchodzą w ten check.
- `TIZEN_LIVE_CHECK=1` + `tizen-signing.test.ts`: **6/6 OK** przed dodaniem fallbacku; realne pobranie oficjalnych ZIP, SHA, SDB version, cache offline, podpisanie aktualnego buildu TV i ponowne podpisanie z tym samym autorem. Późniejszy pełny check weryfikuje także podpis legacy z prawdziwych certyfikatów.
- `npm.cmd run build:tv`, prepare-tizen, build desktopu: OK. APK z aktualnym web buildem zbudowany Dockerem (`ghcr.io/cirruslabs/android-sdk:35`, wolumen `adrenaline-gradle`), podpis debug.
- `ADRENALINE_ENGINE_PATH=resources/engine/adrenaline-engine.exe` + `test:engine`: **4/4 OK**. Bez tej zmiennej testy są skip.
- Smoke Electron **1/1 OK**, wykonany ponownie po pierwszych poprawkach deploy. NSIS powstał lokalnie w `dist/Adrenaline-Setup-0.9.0.exe`; hashy TV/APK, FFmpeg, engine, notices i ASAR w `dist/win-unpacked/resources` sprawdzono. **Ten instalator jest wcześniejszy niż finalna poprawka fallbacku certyfikatu — nie dystrybuować go jako aktualny build ani 1.0.**
- `runProcess`: anulowanie przed spawn i zabijanie drzewa procesów Windows przez taskkill /T /F; testy rzeczywistych procesów (timeout, inherited pipes, cancel). Deploy odrzuca timeout/anulowanie po każdym procesie, zanim przejdzie dalej.
- Zapisany wygasły/uszkodzony autor powoduje DEPLOY_CERTIFICATE bez nadpisywania `author.json`. Odnowienie nadal niezaimplementowane.
- `extract-zip` wrócił do devDependencies, notices wygenerowane ponownie (fflate/node-forge). `npm audit --omit=dev`: **1 high node-forge**, GHSA-86w9-cpqp-85rv, brak poprawionej wersji wg audytu. Dotyczy weryfikacji podpisów RSA PKCS#1; aplikacja używa forge do generowania/odczytu przypiętych certyfikatów, podpisy WGT i testowa weryfikacja RSA używają Node crypto. Nie oznaczać audytu jako czysty; ocena zakresu/wyeliminowanie zależności pozostaje do decyzji.

### Fizyczny Samsung — przełom i aktualny błąd

- Użytkownik podał IP **192.168.1.212** i pozwolił kontynuować instalację. SDB odczytał model **QE65Q77BATXXH**. User agent na TV: **Tizen 6.5, Chromium 85** (wcześniejsze „około 2021 / Tizen 6” było przybliżeniem).
- IP PC **192.168.1.174**, serwer demo **18790**. Narzędzia i trwały autor są w `%APPDATA%/adrenaline/tv-deploy/`, **nie kasować `author.json`**. Klucz nie trafił do repo ani logów.
- Nowy dystrybutor SDK (`*-new.p12`, ważny do 2032) jest odrzucany przez ten TV: `install failed[118, -12] ... Invalid certificate chain ... <-3>`.
- Diagnostycznie podpisano ten sam widget i tego samego autora starszym oficjalnym SDK distributor (`tizen-distributor-signer.p12`). **Instalacja i kolejna aktualizacja przeszły**, `execute` uruchomił aplikację. Starszy dystrybutor formalnie wygasł w 2022, lecz ten firmware go akceptuje — nie obiecywać uniwersalnej zgodności.
- Dodano produkcyjny fallback: tylko po `Invalid certificate chain` ponowne podpisanie legacy, push i instalacja **jeden raz**, bez uninstall i bez zmiany autora. Ma test regresyjny i przeszedł pełny check. **Cała finalna ścieżka DeployService z fallbackiem jeszcze nie została ponownie wykonana na fizycznym TV** (ręczne próby obu certyfikatów już tak).
- `scripts/dev/tizen-deploy.test.ts` przygotowany do tego odbioru: wymaga TV_TIZEN_ADDRESS, TV_SERVER, TV_DEMO_DB; używa realnego deploy i sprawdza uwierzytelniony last_seen_at właściwego TV w bazie demo, nie sam lokalny GET /info. Nie uruchomiono go przed poleceniem zakończenia sesji.
- TV początkowo nie widział serwera: reguły Node.js obejmowały wyłącznie profil Public, LAN jest Private. Użytkownik jako administrator dodał regułę `Adrenaline-TV-review-18790`: TCP 18790, local 192.168.1.174, remote 192.168.1.212, program `C:\Program Files\nodejs\node.exe`, Private. **Reguła nadal istnieje**, tylko dla testu; nie otwiera portu dla całej sieci i nie jest regułą docelowego Electrona.
- Po regule: HTTP 200 z TV, parowanie, uwierzytelniona sesja, katalog, Library i pilot działają. Użytkownik potwierdził zwykłe MP4 (`Northern Lights`, `Last Train South`; logi pokazują także The Long Signal) z obrazem/dźwiękiem.
- **BŁĄD BLOKUJĄCY: Saltwind, 4K HEVC Main10 HDR10 + TrueHD 5.1 → kopia wideo + E-AC3 → HLS fMP4**: AVPlay `prepareAsync` zwraca `InvalidAccessError: PLAYER_ERROR_CONNECTION_FAILED`, potem `PLAYER_ERROR_NOT_SUPPORTED_FILE`. Serwer rzeczywiście dostarcza playlistę/init/segmenty (200/206). Samo `ADAPTIVE_INFO: FIXED_MAX_RESOLUTION=3840x2160` nie pomogło.
- **Eksperyment diagnostyczny dał PLAYING:** zastąpiono pliki jednej sesji demo strumieniem HLS **MPEG-TS**, zachowując kopię HEVC HDR i konwersję audio E-AC3. Ten sam AVPlay przygotował strumień i wszedł w PLAYING. To mocna wskazówka do poprawki Tizen HLS, ale **nie wdrożono zmiany formatu do kodu**, nie sprawdzono normalnego UI/seek/napisów po takiej zmianie i użytkownik nie potwierdził jeszcze wzrokowo wyniku tej konkretnej próby. Nie raportować Saltwind jako naprawionego.
- Eksperyment pisał MPEG-TS pod nazwami `.m4s` wyłącznie w katalogu tymczasowym sesji, aby użyć istniejącej trasy API. Produkcyjna poprawka powinna używać `.ts`, poprawnego MIME, allowlisty tras i obsługi cache/waitForFile, nie utrwalać tego obejścia.

### Kolejność kontynuacji jutro

1. Poprawić format HLS dla Tizena na podstawie próby MPEG-TS; uwzględnić kodeki dozwolone w TS (np. nie kopiować FLAC/Opus/AV1 automatycznie). Android pozostawić z fMP4, dodać regresje planera/FFmpeg/API i sprawdzić realny Saltwind, seek i napisy.
2. Wykonać finalny automatyczny DeployService z fallbackiem oraz aktualizację na Samsungu; zachować autora. Sprawdzić CA wygasające 2027-01-01 i strategię odnowienia.
3. Naprawić potwierdzone problemy review: idle cleanup po 60 s pauzy, brak twardego limitu cache bufora do przodu; Android z niezerowym offsetMs dostaje pełne VTT bez przesunięcia (PlayerActivity), co grozi rozsynchronizowaniem. Te trzy problemy **nie zostały poprawione w tej sesji**.
4. Zaktualizować manual-tests/STATUS z końcowym odbiorem, ponowić check/build TV/APK/manifest/desktop/smoke/pakowanie dla finalnego kodu. Dopiero potem decyzja o 1.0; nie publikować lokalnego 0.9.0 z dzisiejszej próby.

### Środowisko do wznowienia

- Demo z tej sesji: `%TEMP%/adr-tv-demo-umn4xR`, `demo.db`, `Videos/`, logi `logs/adrenaline.log`; używa syntetycznych klipów, nie biblioteki użytkownika. Serwer testowy zatrzymany na zakończenie; TV pozostaje zainstalowany i sparowany z tym **tymczasowym** serwerem. Po uruchomieniu innego profilu może być potrzebne ponowne parowanie.
- Debug TV: `sdb shell 0 debug AdrnlnTV01.Adrenaline` podaje nowy port; następnie `sdb -s 192.168.1.212:26101 forward tcp:PORT tcp:PORT`. Działa surowy CDP przez Node WebSocket (`/json`, potem Runtime.evaluate); `playwright.connectOverCDP` nie zadziałał. Poprzedni port 46703 nie jest stały. Pomocnicze pliki są w ignorowanym `test-results/tv-inspect.mjs` i `tv-expression.js`. Nie wypisywać localStorage/tokenów/ticketów.
- Wstrzyknięte zmiany AVPlay i keepalive były tylko diagnostyką w pamięci strony; odtwarzanie i keepalive zatrzymano. Ponowne uruchomienie aplikacji usuwa te zmiany.
- Docker Desktop uruchomiony na potrzeby buildu APK; nie wyłączano całego Dockera użytkownika.
- Dokumentacja user-guide, decyzja D-86, deploy-and-packaging i STATUS częściowo zaktualizowane; starsze fragmenty poniżej i w „Następnych krokach” STATUS są historią, **ta sekcja ma pierwszeństwo**.

---

## Zlecenie i stan

Użytkownik chce review zmian od v0.9.0, poprawki, weryfikację instalacji i dopiero jeśli wszystko OK: commit + push tagu **v1.0.0** (workflow reaguje na `v*.*.*`, nie `1.0`). Ma Samsung QLED z 2021 r. (Tizen 6), Developer Mode i wcześniej instalował Jellyfina skryptem po IP. Dodatkowo wyraźnie zlecił uproszczenie naszej instalacji do IP + Developer Mode, bez ręcznej konfiguracji SDK/certyfikatów. Nie znamy IP TV ani dokładnego modelu, nie testowano fizycznego TV.

HEAD nadal `556c3a2`. **Wszystkie moje zmiany są niecommitowane. Nie zmieniono wersji 0.9.0, nie utworzono tagu, niczego nie pushowano.** Użytkownik poprosił o zakończenie sesji i przekazanie pracy.

## Zrobione

- Review wykrył blokadę AVPlay przez CSP `object-src 'none'`: poprawiony generator WGT, Android zachowuje restrykcyjne CSP. Usunięto nieużywany od 2015 r. privilege `avplay` (dokumentacja Samsung). Przezroczyste html/body podczas AVPlay zamiast zasłaniania płaszczyzny wideo.
- Planner: HDR konwertowany do 8-bit SDR przy skalowaniu/wypalaniu PGS teraz dostaje tone mapping także na TV HDR; skalowanie uwzględnia szerokość/dekoder i parzyste wymiary. Dodano regresje.
- Niestabilny test timeoutu źródeł (80 ms realnego czasu) używa fake timers.
- Nowy **automatyczny Tizen deploy**, wciąż wymaga końcowej weryfikacji:
  - `src/main/tv/deploy/tizen-tools.ts`: pobranie ok. 6 MB oficjalnych archiwów SDB i certificate-generator, przypięte SHA-256, cache pod userData/tv-deploy/tools, bez wykonywania skryptów instalacyjnych SDK.
  - `tizen-signing.ts`: generowanie trwałego autora per-PC w `tv-deploy/author.json`, podpisy widgetu SHA256/RSA, dystrybutor SDK public **-new** (stary cert wygasł), ZIP przez fflate. Podpisywany jest także server.json, więc TV od razu zna IP PC.
  - `deploy-service.ts`: pusty profile = automatic; przygotowanie narzędzi, podpisanie, SDB push, `shell 0 vd_appinstall`, launch i dotychczasowy handshake. Nazwany profil zachowuje ścieżkę Tizen Studio.
  - UI/kontrakt/i18n: Automatic domyślnie, brak wymogu Studio, opcje certyfikatów w Advanced.
  - Testy podpisów niezależnym canonicalizerem xml-crypto + Node crypto; test autor pozostaje ten sam po aktualizacji; checksum mismatch; dodano testy automatycznego deploy na stubach.
- Zależności: production `node-forge@1.4.0`, `fflate@0.8.3`, przeniesione `extract-zip@2.0.1` z dev (ostatecznie nowy kod używa fflate, więc przeniesienie extract-zip można cofnąć). Dev `@types/node-forge@1.3.14`, `xml-crypto@6.4.0`, `@xmldom/xmldom@0.8.15`.

## Wyniki i NATYCHMIASTOWY następny krok

1. **Ostatni `npm.cmd run check`: lint OK, typecheck FAILED** w istniejącym `src/main/providers/torznab/torznab-client.test.ts` linie 25 i 36: `Buffer<ArrayBufferLike>` vs BodyInit oraz `string | URL | Request` vs URL constructor. Pojawiło się po dodaniu zależności/typów. Sprawdzić diff lockfile i typy, naprawić normalizację mock fetch zamiast wyciszać TS. Testy pełne w tym przebiegu nie uruchomiły się.
2. Przed nowym deploy, po poprawkach review: pełny check **425 passed / 3 skipped**, desktop build, TV build i przygotowanie Tizen OK.
3. Nowe `tizen-signing.test.ts`: **3/3 OK**, w tym realne oficjalne certyfikaty z pobranego SDK i niezależna weryfikacja każdego digestu oraz RSA. Realny test jest skip, gdy brak vendor/tizen-certificates.zip.
4. Osobno realny FFmpeg: **3/3 OK** (remux HLS, HDR→SDR + TrueHD→EAC3 + ASS, stop/delete). FFmpeg jest już w vendor/ffmpeg.
5. Po dokończeniu: pełny check, build:tv, prepare-tizen, build, smoke Electron, weryfikacja paczki i release workflow. Nowe testy DeployService jeszcze nie były wykonane po ich dopisaniu. Nie budowano APK w tej sesji.

## Do dokończenia / ryzyka review

- Zweryfikować nowy installer end-to-end w zakresie lokalnym: pobieranie/cache/SDB executable, signed WGT z faktycznym buildem, obsługa cancel i timeoutów, powtórna instalacja. Testy podpisów są zielone, ale NIE dowodzą akceptacji podpisu przez konkretny Samsung.
- CA autora w oficjalnym pakiecie wygasa **2027-01-01**; public distributor-new w 2032. Obecna implementacja odmawia tworzenia autora po wygaśnięciu CA. Trzeba opisać/rozwiązać odnowienie z zachowaniem klucza. Nie obiecywać podpisu uniwersalnego na każdy firmware. Przy odrzuceniu pozostaje nazwany profil Samsung + DUID.
- Uzupełnić user-guide, manual-tests, STATUS, decyzję zastępującą D-84 i informacje o pobieraniu narzędzi, kopii author.json, pierwszym dostępie do Internetu oraz dozwolonym IP PC w Developer Mode. Nie kopiowano kodu Jellyfina; implementacja oparta na protokole/signature format z oficjalnych narzędzi. Uzupełnić notices nowych npm dependencies.
- Review nie jest zamknięty. Obszary zauważone wymagające sprawdzenia: Transcoder usuwa sesje po 60 s bez segmentów (pauza), cache sweep usuwa tylko stare segmenty i nie zatrzymuje szybkiego FFmpeg gdy przekracza limit samym buforem do przodu; Android HLS z offsetMs i pełnymi VTT może mieć przesunięte napisy. Android HLS wybór audio/napisów obrazkowych pozostaje ograniczony. Nie przedstawiać tego jako przetestowane/naprawione.
- `runProcess` przy timeout zabija tylko proces bez drzewa (tizen.bat → Java w ścieżce advanced). Rozważyć poprawkę.
- Decyzja release dopiero po weryfikacji; user upoważnił push/tag warunkowo, jeśli wszystko OK. Nie publikować na podstawie samej dawnej listy checkboxów. Raportować brak testu fizycznego TV uczciwie.

## Research i środowisko

- Klony tylko do TEMP: `adrenaline-review-jellyfin-installer` (Georift), `adrenaline-review-apps2samsung`, `adrenaline-review-samsung-tools` (Samsung/webIDE-common-tizentv). Nie ma ich w repo.
- Georift `entrypoint.sh` pobiera już podpisany WGT jeppevinkel i instaluje; własne certyfikaty opcjonalne. jeppevinkel workflow używa Tizen developer author + SDK distributor, nie obowiązkowego DUID.
- Oficjalne Samsung źródła `lib/tizenCertificateManager.js`, `packageSigner.js`, `appLauncher.js` pokazują generowanie autora, widget XML signatures oraz `sdb push` + `vd_appinstall`.
- Źródła: https://github.com/Georift/install-jellyfin-tizen ; https://github.com/jeppevinkel/jellyfin-tizen-builds/blob/master/.github/workflows/build-new-release.yml ; https://github.com/Samsung/webIDE-common-tizentv ; https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-avplay.html
- Pobrano do ignorowanego vendor/: `tizen-sdb.zip`, `tizen-certificates.zip`, `tizen-pkg-list.txt`. SHA-256 obu ZIP zgodne z oficjalnym katalogiem i tizen-tools.ts.
- Windows PowerShell blokuje npm.ps1: używać **npm.cmd / npx.cmd**. Sieć sandboxa blokuje GitHub/npm/download.tizen.org — wymagane eskalacje, część poleceń npm install i konkretne klony zatwierdzone w tej sesji. `gh`, adb, sdb nie znalezione w PATH; dotnet i Docker są.
- Git status na starcie był czysty. Nie kasować obecnych zmian. Nie otwierano fizycznego TV ani nie instalowano na nim czegokolwiek.
