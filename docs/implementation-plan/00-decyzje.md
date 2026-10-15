# Decyzje projektowe

Każda decyzja ma identyfikator `D-xx`. Zmiana decyzji = nowy wpis (albo zmiana statusu) z datą i uzasadnieniem, nigdy cicha zmiana kodu. Statusy: **przyjęta** (obowiązuje), **domyślna** (wybrana przez plan, właściciel może zmienić), **do weryfikacji w etapie X** (obowiązuje, ale etap X ma ją potwierdzić; jest wskazany plan zapasowy).

## Zakres i zasady (od właściciela, 15.10.2026)

| ID | Decyzja | Status |
|---|---|---|
| D-01 | Nazwa produktu: **Adrenaline**. `appId`: `com.jakubkonkol.adrenaline`. Nazwa binarki silnika: `adrenaline-engine.exe`. | przyjęta |
| D-02 | Jedyna platforma: **Windows 10/11 x64**. Brak macOS, Linux, ARM, brak macierzy platform w CI. Kod TS/C++ pozostaje przenośny wyłącznie po to, żeby agent mógł rozwijać i testować go w kontenerze Linux. | przyjęta |
| D-03 | Testy są **proste**: testy jednostkowe (Vitest), testy kontraktowe na zapisanych odpowiedziach, jeden test integracyjny silnika na lokalnym swarmie i jeden smoke test Electron (Playwright). Bez farmy E2E, bez testów na live API w CI. | przyjęta |
| D-04 | **Autoupdate z GitHub Releases** przez `electron-updater` (provider `github`). | przyjęta |
| D-05 | **Release przez GitHub Actions**: push taga `vX.Y.Z` → testy → jeśli przejdą, budowa silnika, pakowanie instalatora NSIS i publikacja w GitHub Release. Bez dodatkowych narzędzi typu semantic-release/changesets. | przyjęta |
| D-06 | Praca bezpośrednio na `main`, commity jako Jakub Konkol. Szczegóły w `/CLAUDE.md`. | przyjęta |
| D-07 | Repo `JakubKonkol/Adrenaline` będzie **publiczne** i Releases są publikowane w tym samym repo. `electron-updater` czyta je bez tokena; workflow publikuje z wbudowanym `GITHUB_TOKEN` (`permissions: contents: write`), bez dodatkowych sekretów. Upublicznienie repo robi właściciel (Settings → General → Danger Zone → Change visibility) przed pierwszym wydaniem w etapie 1.4. | przyjęta (wybór właściciela 15.10.2026) |
| D-08 | Instalator **niepodpisany** w MVP (SmartScreen pokaże ostrzeżenie „nieznany wydawca”). Autoupdate działa bez podpisu, bo `publisherName` nie jest ustawione. Podpis kodu można dodać później bez zmiany architektury. | domyślna |
| D-09 | Projekt prywatny, bez modelu komercyjnego. Konsekwencja: użytkownik podaje **własny klucz TMDB** i **własny klucz API + konto OpenSubtitles** w Ustawieniach. Żadne klucze nie są wbudowane w aplikację. | domyślna |

## Technologie i wersje

Wersje sprawdzone w npm 15.10.2026. Etap 0 przypina je dokładnie w `package.json` (bez `^`) i commituje `package-lock.json`. Nowsze wersje można przyjąć, jeśli `npm run check` i smoke test przechodzą.

| ID | Obszar | Wybór | Wersja startowa |
|---|---|---|---|
| D-10 | Runtime | Electron | `44.7.2` (Node 24.21, Chromium 152) |
| D-11 | Build | `electron-vite` (main/preload/renderer w jednym narzędziu) + Vite + `@vitejs/plugin-react` | `6.0.0` / `8.3.x` / `6.1.x` |
| D-12 | UI | React + React Router (tryb hash, `createHashRouter`) + TanStack Query | `19.3.x` / `8.4.x` / `5.104.x` |
| D-13 | Język | TypeScript **6.0.x** (nie 7.x: `typescript-eslint 8.71` wymaga `<6.1`) | `6.0.3` |
| D-14 | Walidacja | Zod (DTO, IPC, odpowiedzi dostawców, protokół silnika) | `4.6.x` |
| D-15 | Baza | **Wbudowany `node:sqlite` (`DatabaseSync`)** + ręcznie pisane migracje SQL. Sprawdzone: działa w Electron 44.7.2 (Node 24.21). Brak natywnego modułu npm = brak przebudowy pod Electron i te same testy w Vitest. Zapasowo: `better-sqlite3` + `@electron/rebuild`. | wbudowany |
| D-16 | XML Torznab | `fast-xml-parser` (nie rozwija encji zewnętrznych; ustawić `processEntities: false`, limit rozmiaru odpowiedzi 5 MB przed parsowaniem) | `5.11.x` |
| D-17 | Testy | Vitest (unit/kontrakt), `@playwright/test` z `_electron` (1 smoke test) | `5.0.x` / `1.64.x` |
| D-18 | Lint/format | ESLint 10 + `typescript-eslint` + Prettier | `10.x` / `8.71.x` / `3.x` |
| D-19 | Pakowanie | `electron-builder`, target `nsis` x64, `oneClick: false`, wybór katalogu instalacji | `26.15.x` |
| D-20 | Aktualizacje | `electron-updater` | `6.8.x` |
| D-21 | Style | Zwykłe CSS Modules + zmienne CSS (jasny/ciemny motyw przez `prefers-color-scheme`). Bez bibliotek komponentów. | — |
| D-22 | i18n | Jeden słownik `src/renderer/i18n/pl.ts` + funkcja `t(key, params)`. Wszystkie teksty UI przez `t`. Bez biblioteki i18n. | — |
| D-23 | Logi | Własny mały logger w main: plik rotowany w `%APPDATA%/Adrenaline/logs` (5 × 5 MB), redakcja tokenów, magnetów, kluczy i pełnych ścieżek użytkownika. | — |

## Struktura repo

| ID | Decyzja | Status |
|---|---|---|
| D-30 | **Jeden pakiet npm** zamiast monorepo z `packages/*` z dokumentu technicznego. Granice modułów zachowane jako katalogi w `src/` (`shared/domain`, `shared/contracts`, `main/providers`, `main/persistence`…). Mniej konfiguracji, ten sam podział odpowiedzialności. | przyjęta |
| D-31 | Silnik C++ w `native/engine`, budowany CMake + **vcpkg w trybie manifest** (`vcpkg.json` z przypiętym `builtin-baseline`). | przyjęta |

## Silnik torrent

| ID | Decyzja | Status |
|---|---|---|
| D-40 | Silnik: **libtorrent-rasterbar 2.1.x** (port vcpkg `libtorrent`, `default-features: false`, czyli bez WebTorrent/WebRTC) w osobnym procesie `adrenaline-engine.exe`. Komunikacja: JSON Lines po stdin/stdout (patrz `02-protokol-silnika.md`). JSON w C++: `nlohmann-json` z vcpkg. | do weryfikacji w etapie 2 |
| D-41 | Triplet Windows: `x64-windows-static` (jedna samodzielna binarka, brak DLL). Kod pisany pod API wspólne dla 2.0 i 2.1, żeby w kontenerze Linux można było też użyć systemowego `libtorrent-rasterbar-dev` (Ubuntu 24.04 ma 2.0.10), gdy budowa przez vcpkg trwa za długo. | przyjęta |
| D-42 | Plan zapasowy, jeśli etap 2 nie dowiezie helpera: Node + `webtorrent` w `utilityProcess` z własną implementacją pełnej pauzy (usunięcie torrenta z klienta z zachowaniem plików i ponowne dodanie). Ten sam protokół JSON Lines, więc reszta aplikacji się nie zmienia. Zmiana wymaga wpisu w tym pliku. | zapasowa |
| D-43 | Torrenty są dodawane w trybie ręcznie zarządzanym (bez `auto_managed`), żeby pauza użytkownika nie była cofana przez kolejkowanie libtorrent. Kolejkę (maks. równoległych pobrań, domyślnie 3) prowadzi Electron main. | przyjęta |
| D-44 | **Silnik: `mmap_disk_io` + limit working setu na Windows** (15.10.2026). libtorrent 2.1 domyślnie wybiera na Windows eksperymentalny `pread_disk_io`, którego bufor zapisu nie jest opróżniany przez `save_resume_data(flush_disk_cache)`. Skutki wykryte testem swarm: plik zgłoszony jako gotowy chwilowo zawierał zera, a po `kill` dane resume wyprzedzały dysk. Silnik wymusza `mmap_disk_io` (domyślny w 2.0). Przy mmap strony pobieranych plików liczą się do working setu, który rósł liniowo z rozmiarem (pomiar: 1 × 256 MiB → 272 MiB, 3 × 256 MiB → 787 MiB; pamięć prywatna 6/13 MiB). Dlatego, jak qBittorrent, silnik ustawia twardy limit working setu (`SetProcessWorkingSetSizeEx`, `--max-memory-mib`, domyślnie 512 MiB) — Windows oddaje nadmiarowe strony, które są już w pliku. | przyjęta |

## Źródła (indeksatory)

| ID | Decyzja | Status |
|---|---|---|
| D-50 | **Jackett dołączony do instalatora** (`Jackett.Binaries.Windows.zip`, wersja przypięta w `scripts/jackett-version.txt`, startowo `v0.24.2798` z 06.10.2026 — zmieniona na v0.24.2856, patrz D-58; licencja GPL-2.0). Uruchamiany jako `JackettConsole.exe` z `--NoUpdates --NoRestart --ListenPrivate --Port <wolny port>` i własnym katalogiem danych. | do weryfikacji w etapie 5 |
| D-51 | Etap 5 musi potwierdzić na czystym Windows (Windows Sandbox): (a) czy archiwum jest samowystarczalne (bez instalacji .NET), (b) czy `--DataFolder` działa bez uprawnień administratora (README Jackett sugeruje, że na Windows wymaga admina). Zapas dla (b): ustawić katalog danych przez zmienną środowiskową/plik konfiguracyjny, a jeśli się nie da, użyć domyślnego `%ProgramData%\Jackett` z osobnym portem i kluczem. Zapas dla (a): dołączyć wymagany runtime .NET jako część instalatora albo przejść na Prowlarr (GPL-3.0). Wynik zapisać jako nową decyzję. | rozstrzygnięta 15.10.2026: D-56 |
| D-52 | Wspólny adapter **Torznab** dla wbudowanego Jackett i dla dowolnego endpointu użytkownika (Jackett/Prowlarr). Brak własnych scraperów HTML. | przyjęta |
| D-53 | Domyślny zestaw indeksatorów publicznych do włączenia przez UI: kandydaci z dokumentu technicznego (The Pirate Bay, YTS, Torrent Downloads, LimeTorrents). Wszystkie wyłączone przy pierwszym uruchomieniu; użytkownik włącza je w kreatorze lub Ustawieniach. Lista w `src/main/sources/default-indexers.ts`, łatwa do zmiany. | domyślna |
| D-54 | Konfiguracja indeksatorów w UI Adrenaline przez administracyjne API Jackett (`/api/v2.0/indexers…`). Jeśli API okaże się niewystarczające, zapas: przycisk „Otwórz panel źródeł” ładujący panel Jackett w osobnym oknie Electron (tylko `127.0.0.1`). | rozstrzygnięta 15.10.2026: API wystarcza, D-57 |
| D-55 | Parametry wyszukiwania: maks. 3 równoległe zapytania, timeout źródła 12 s, limit sesji 20 s, cache 5 min, backoff z jitterem, obsługa `Retry-After`. | domyślna |
| D-56 | **Jackett: uruchamianie bez administratora** (wynik spike 5.1, 15.10.2026, Windows 11 bez podniesienia uprawnień). `--DataFolder <userData>/jackett` działa bez admina (wbrew README Jackett). Flaga `--Port` bez admina kończy proces błędem „Unable to switch ports”, dlatego przed startem Adrenaline zapisuje w `ServerConfig.json` port, `LocalBindAddress: 127.0.0.1`, `AllowExternal: false`, `UpdateDisabled: true` i własny klucz API, a uruchamia `JackettConsole.exe --NoUpdates --NoRestart --ListenPrivate --DataFolder <dir>` (bez `--Port`). Archiwum jest samowystarczalne: Jackett ładuje .NET 9.0.21 z własnego katalogu (D-51 a). Słucha wyłącznie na `127.0.0.1` (netstat). Zatrzymanie: ukryty proces konsolowy nie reaguje na `taskkill` bez `/F`, więc `stop()` kończy proces wymuszenie; to bezpieczne, bo Jackett zapisuje konfigurację w chwili zmiany. Potwierdzenie na czystym systemie: Windows Sandbox (`docs/manual-tests.md`). | przyjęta (zastępuje plan zapasowy z D-51) |
| D-57 | **Jackett: konfiguracja indeksatorów przez API administracyjne** (wynik spike 5.1). Logowanie: `POST /UI/Dashboard` (formularz `password`) → cookie; przy pierwszym uruchomieniu z pustym hasłem, potem Adrenaline ustawia losowe hasło `POST /api/v2.0/server/adminpassword` (JSON string, Jackett trzyma hash SHA-512) i zapisuje je jako sekret `jackett.adminPassword`. Endpointy: `GET /api/v2.0/indexers?configured=false|true` (651 indeksatorów w v0.24.2856, w tym wszystkie z D-53), `GET|POST /api/v2.0/indexers/{id}/config` (POST z domyślną konfiguracją dodaje i testuje indeksator, 204), `DELETE /api/v2.0/indexers/{id}`, `GET /api/v2.0/server/config`. Torznab: `/api/v2.0/indexers/{id}/results/torznab/api?apikey=…`; zły klucz zwraca HTTP 200 z `<error code="100">`, więc adapter musi czytać błąd z XML. Wyniki zawierają `infohash`, `magneturl`, `seeders`, `peers`, `imdbid`; `enclosure` wskazuje na Jackett (`/dl/…`), co pasuje do reguły SSRF z 5.3. Zapasowy panel w oknie Electron (D-54) nie jest potrzebny. | przyjęta |
| D-58 | Jackett przypięty do **v0.24.2856** (15.10.2026, SHA-256 `a46a2f71…beed73` w `scripts/jackett-sha256.txt`) zamiast `v0.24.2798` z D-50 — najnowsze wydanie w dniu spike'u, ten sam kanał stabilny. Ze spakowanej aplikacji usuwane są `JackettUpdater*`, `JackettService*`, `JackettTray*` i skrypty `.bat` (aktualizacje Jackett przychodzą razem z Adrenaline). | przyjęta |

## Katalog i napisy

| ID | Decyzja | Status |
|---|---|---|
| D-60 | TMDB API v3, własny cienki klient `fetch`, autoryzacja tokenem „API Read Access Token” (`Authorization: Bearer`) lub kluczem v3 (`api_key`). Język `pl-PL`, fallback `en-US`. Cache: wyszukiwanie 15 min, szczegóły 24 h. | przyjęta |
| D-61 | OpenSubtitles.com REST API (`https://api.opensubtitles.com/api/v1`), nagłówki `Api-Key` i `User-Agent: Adrenaline v<wersja>`, logowanie użytkownika po token. Dokładny schemat zweryfikować z aktualną dokumentacją na początku etapu 7 i zapisać przykładowe odpowiedzi jako fixtures. | do weryfikacji w etapie 7 |
| D-62 | Napisy: jeden język podstawowy + opcjonalny fallback. Nazwa pliku `<nazwa_bazowa_wideo>.<kod ISO 639-1>.<srt|ass>`. Brak muxowania do MKV. | przyjęta |

## Zachowanie produktu (domyślne z dokumentów)

| ID | Decyzja | Status |
|---|---|---|
| D-70 | Seedowanie po pobraniu: stop przy ratio 1.0 **albo** po 60 minutach, co nastąpi wcześniej. Widoczne i edytowalne w Ustawieniach i per zadanie. | domyślna |
| D-71 | Zamknięcie okna chowa aplikację do zasobnika (z jednorazowym powiadomieniem). „Zakończ” z menu zasobnika zapisuje stan i zatrzymuje silnik oraz Jackett. Przełącznik w Ustawieniach. | domyślna |
| D-72 | MVP: film i **pojedynczy odcinek** (także wybrany z paczki sezonu). Pełne sezony po MVP. | przyjęta |
| D-73 | Interfejs po polsku. | przyjęta |
| D-74 | Brak telemetrii. Dane lokalne w `%APPDATA%/Adrenaline` (`app.getPath('userData')`). Deinstalacja nie usuwa pobranych filmów ani danych użytkownika (`deleteAppDataOnUninstall: false`). | przyjęta |
| D-75 | Domyślny katalog pobierania: `%USERPROFILE%\Videos\Adrenaline`. Struktura: `<katalog>/<Tytuł (rok)>/<nazwa wydania>/…` dla filmu, `<katalog>/<Serial>/Sezon NN/<nazwa wydania>/…` dla odcinka. | domyślna |
| D-76 | Aktualizacje: sprawdzenie przy starcie (po 10 s) i co 6 h, pobranie w tle, baner „Uruchom ponownie, aby zaktualizować”. Instalacja dopiero po kontrolowanym zamknięciu silnika (zapis resume). Kanał tylko stabilny; wersje `-beta` oznaczone jako prerelease i wysyłane tylko, gdy w Ustawieniach włączono „Wersje testowe” (`autoUpdater.allowPrerelease`). | domyślna |
