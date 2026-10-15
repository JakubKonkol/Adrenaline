# Status implementacji

Agent aktualizuje ten plik po każdym zamkniętym zadaniu (checkbox + krótka notatka, jeśli coś odbiega od planu). Zadania odpowiadają numeracji w `etapy/`.

**Bieżący etap:** 7.2–7.6 zakończone w kodzie; test OpenSubtitles live pozostaje otwarty (brak konta). Następny: 8 — dopracowanie bety. Etap 1: czeka test aktualizacji.
**Ostatnie wydanie:** [v0.6.0](https://github.com/JakubKonkol/Adrenaline/releases/tag/v0.6.0) — [Release 38786238007](https://github.com/JakubKonkol/Adrenaline/actions/runs/38786238007) zakończony sukcesem: test aplikacji, silnik i swarm Windows, pakowanie, publikacja instalatora + blockmap + latest.yml. Starsze błędy swarmu poprawiono przed tym wydaniem (m.in. `6e3f2b0`: pomiar wznowienia po zapisie resume).
  v0.1.0 (15.10.2026): electron-builder utworzył 2 Release dla jednego taga — scalone ręcznie, workflow poprawiony: najpierw draft)

## Blokady wymagające właściciela

- [x] Wybór źródła aktualizacji (D-07): upublicznienie `Adrenaline`, Releases w tym samym repo (decyzja 15.10.2026).
- [ ] Test ręczny etapu 1 (do potwierdzenia przez Jakuba): instalacja 0.1.0 → baner aktualizacji do 0.1.1 → restart w 0.1.1.
- [ ] Zmiana widoczności repo `JakubKonkol/Adrenaline` na publiczną. Potrzebne przed etapem 1.4.
- [x] Klucz TMDB w `.env` (15.10.2026).
- [ ] Test Jackett w Windows Sandbox (`docs/manual-tests.md`) — potwierdzenie D-56 na czystym systemie.
- [ ] Konto/klucz OpenSubtitles w `.env` do testów live (etap 7).

## Etapy

### Etap 0 — Szkielet
- [x] 0.1 Inicjalizacja projektu
- [x] 0.2 electron-vite + TypeScript
- [x] 0.3 Minimalna aplikacja
- [x] 0.4 Skrypty npm
- [x] 0.5 Testy (Vitest, smoke)
- [x] 0.6 CI
- [x] 0.7 Pętla dev w kontenerze, `docs/dev-setup.md`

### Etap 1 — Release i autoupdate
- [x] 1.1 electron-builder
- [x] 1.2 Updater
- [x] 1.3 Skrypty i workflow
- [ ] 1.4 Wydania v0.1.0 i v0.1.1

### Etap 2 — Silnik
- [x] 2.1 Budowanie C++
- [x] 2.2 Implementacja silnika (dodatkowo `--resume-interval` dla testu i `min_reconnect_time = 5 s`, patrz Odstępstwa)
- [x] 2.3 Klient w Electron
- [x] 2.4 Test swarm (Linux/WSL: 4/4; Windows: w `engine-ci.yml`)
- [x] 2.5 Pakowanie i CI — `engine-ci.yml` zielony na Windows (libtorrent 2.1.2, swarm 4/4, `dumpbin`: tylko KERNEL32, WS2_32, MSWSOCK, CRYPT32, ADVAPI32, USER32, SHELL32); `release.yml` pakuje silnik.
- [x] 2.6 Diagnostyka w UI

### Etap 3 — Rdzeń aplikacji
- [x] 3.1 Baza (schemat kompletny; repozytoria media/jobs/subtitles/sources dojdą w etapach 4–7)
- [x] 3.2 Ustawienia
- [x] 3.3 Sekrety
- [x] 3.4 IPC
- [x] 3.5 Pliki i dysk
- [x] 3.6 Nawigacja, Ustawienia, kreator
- [x] 3.7 Okno i zasobnik
- [x] 3.8 Logger (zrobiony w etapie 1, bo potrzebuje go updater; IPC `app:openLogsFolder` też)

### Etap 4 — Katalog TMDB
- [x] 4.1 Weryfikacja API, fixtures — test live 15.10.2026 z kluczem v3 właściciela: wyszukiwanie (1968 i 1990 rozróżnione), szczegóły z IMDb ID, serial/sezon/odcinki, 401. Klient aplikacji parsuje zapisane odpowiedzi (`tmdb-live-fixtures.test.ts`, uruchamiany tylko lokalnie). Pełna ścieżka w aplikacji sprawdzona: wyniki, plakaty z `image.tmdb.org`, szczegóły po polsku. Odpowiedzi live nie są commitowane (dane TMDB), w repo zostają syntetyczne fixtures.
- [x] 4.2 Klient — Bearer/klucz v3, timeout 10 s, walidacja Zod, limit odpowiedzi 5 MiB, stabilne błędy, jedno ponowienie 429, fallback opisu en-US; testy kontraktowe offline.
- [x] 4.3 Serwis i IPC — `catalog:search/details/season/select`, `settings:testTmdb`, cache SQLite 15 min/24 h, scalenie wg popularności. Media/odcinek zapisują się dopiero przy wyborze, na podstawie danych main.
- [x] 4.4 UI — wyszukiwanie z debounce 350 ms i filtrami, karty, szczegóły, sezony/odcinki, stany błędów i brak klucza, test klucza w Ustawieniach, oficjalne logo i atrybucja TMDB. Testy komponentowe obejmują nawigację i awarię katalogu.
- [x] 4.5 SearchTarget — walidowany film/odcinek trafia przez stan routera do `/releases`; ekran docelowy oczekuje implementacji wyszukiwania z etapu 5.

### Etap 5 — Źródła
- [x] 5.1 Spike Jackett (decyzje D-56, D-57, D-58) — `scripts/jackett-spike.mjs` 13/13 na Windows 11 bez admina; workflow `jackett-spike.yml` (ręczny); Windows Sandbox do potwierdzenia przez Jakuba (`docs/manual-tests.md`).
- [x] 5.2 JackettManager — test live z prawdziwym Jackett: start bez admina, YTS przez API, wyszukiwanie Torznab.
- [x] 5.3 Adapter Torznab
- [x] 5.4 Domena wydań — parser 48 nazw, magnet, deduplikacja, dopasowanie i ranking.
- [x] 5.5 Serwis wyszukiwania — test live 15.10.2026: YTS, The Pirate Bay i LimeTorrents odpowiedziały (3/5), Torrent Downloads i zepsute źródło własne zwróciły błąd, 81 wydań, całość 3,5 s.
- [x] 5.6 UI — ekran wydań, Ustawienia → Źródła, krok źródeł w kreatorze. Wybór wydania prowadzi na `/download-setup` (placeholder do etapu 6).

### Etap 6 — Pobieranie
- [x] 6.1 Domena zadań — przejścia stanów, status zbiorczy (BR02/BR03), domyślny wybór plików (FR09), foldery D-75.
- [x] 6.2 Konfiguracja pobrania — folder, miejsce, konflikt (inna nazwa / inny folder), duplikat, napisy, seedowanie.
- [x] 6.3 Serwis pobrań — kolejka, magnet lub .torrent tylko z hosta źródła, walidacja ścieżek, pauza po potwierdzeniu, dysk, usuwanie, otwieranie folderu.
- [x] 6.4 Restart i awaria — `npm run crash-loop`: 20/20 cykli bez utraty zadań na prawdziwym silniku Windows i na FakeEngine (15.10.2026); wykrył i poprawiono 2 błędy (stan `error` przy awarii silnika w trakcie odtwarzania, zamiana błędu na „pauzę użytkownika”).
- [x] 6.5 UI — Pobrane (aktywne/zakończone, postęp co 500 ms bez przerysowania listy), szczegóły, wybór plików, usuwanie z listą plików, zasobnik.
- [x] 6.6 Smoke z restartem — zadanie przez ukryte API (tylko FakeEngine), postęp, pauza, restart, wznowienie.

### Etap 7 — Napisy
- [ ] 7.1 Weryfikacja API, fixtures — oficjalny OpenAPI odczytany 15.10.2026, fixtures syntetyczne, skrypt `scripts/live/opensubtitles.mjs` gotowy; rzeczywisty test wymaga konta. Dane live ignorowane przez git.
- [x] 7.2 Hash — BigInt, 2 × 64 KiB, pliki <128 KiB bez hasha; 5 testów.
- [x] 7.3 Klient — szyfrowana sesja, host API/VIP z allowlisty, bezpieczne przekierowania GET, relogin raz, limity/reset, brak powtórzenia POST po timeout; testy kontraktowe.
- [x] 7.4 Pipeline — zadania SQLite na wybrane wideo, hash i ranking, fallback tylko po pustym wyniku, walidacja/dekodowanie/ZIP/gzip, zapis bez nadpisywania, częściowy sukces. Po awarii podczas pobierania napisów wymagane ręczne ponowienie (ochrona limitu).
- [x] 7.5 Ponowienie i ręczny wybór — walidowane IPC `subtitles:retry/choose/language`, kandydat tylko z zapisanej listy zadania; serwis nie zależy od silnika.
- [x] 7.6 UI — status napisów na liście, panel szczegółów z kandydatami/SDH/forced/pewnością, język i fallback, test konta/limity/wylogowanie w Ustawieniach.

### Etap 8 — Beta
- [ ] 8.1 Sytuacje wyjątkowe
- [ ] 8.2 Dostępność i UX
- [ ] 8.3 O aplikacji i diagnostyka
- [ ] 8.4 Dokumentacja użytkownika
- [ ] 8.5 Instalator i aktualizacja (checklista ręczna)
- [ ] 8.6 Przegląd bezpieczeństwa
- [ ] 8.7 Wydanie beta v0.9.0

## Przypięte wersje

Uzupełnić w etapie 0 (i przy każdej zmianie).

| Składnik | Wersja |
|---|---|
| Electron | 44.7.2 |
| Node (w Electronie) | 24.21 (lokalnie Node 24.11) |
| React | 19.3.1 (react-router 8.4.0, TanStack Query 5.104.3) |
| TypeScript | 6.0.3 |
| electron-vite / Vite | 6.0.0 / 8.3.4 (`@vitejs/plugin-react` 6.1.2) |
| electron-builder / electron-updater | 26.15.3 / 6.8.9 |
| Zod / fast-xml-parser | 4.6.7 / 5.11.2 |
| Vitest / Playwright | 5.0.5 / 1.64.1 |
| ESLint / typescript-eslint / Prettier | 10.12.0 / 8.71.2 / 3.9.10 |
| vcpkg baseline | `20ceb8adbf0504d4b0d5e4058a32f9d4fc896391` (15.10.2026) |
| libtorrent | 2.1.2 (vcpkg, Windows) / 2.0.12 (Ubuntu 26.04, dev) |
| Jackett | v0.24.2856 (.NET 9.0.21 w paczce, self-contained) |

## Odstępstwa od planu

- **Etap 7 → 8 (Codex, 15.10.2026):** kontynuacja dopracowania jest niezależna od niedostępnego testu konta OpenSubtitles. Nie oznaczamy 7.1 ani ręcznego odbioru jako zaliczone. Oficjalny OpenAPI: `https://opensubtitles.stoplight.io/api/v1/projects/opensubtitles/opensubtitles-api/nodes/open_api.json`. `remaining=0` w udanej odpowiedzi `/download` oznacza ostatnie dozwolone pobranie; jego link jest używany. Dopiero błąd limitu daje `SUBS_QUOTA`.
- **Archiwa i zapis napisów (15.10.2026):** ZIP/gzip rozpakowywane w pamięci z limitem 5 MiB, bez tworzenia ścieżek z archiwum. ZIP musi zawierać dokładnie jeden plik napisów; odrzucamy symlinki, traversal, szyfrowanie, ZIP64, pliki wykonywalne i niezgodne CRC/rozmiary. Zapis UTF-8: plik tymczasowy + fsync + hardlink z wyłącznością (atomowy na NTFS). FAT/exFAT: kopiowanie z COPYFILE_EXCL, bez gwarancji atomowej widoczności, ale bez nadpisania istniejących danych. Każde ponowienie zachowuje poprzedni sidecar.
- **Zamykanie (15.10.2026):** usunięto błąd kolejności lifecycle: baza i logger zamykają się po serwisach i silniku, a nie przed zapisem postępu pobrań. Napisy są zatrzymywane przed końcem procesu; anulowane zadanie nie rozpoczyna zapisu po usunięciu.

- **Kontynuacja od etapu 4 (15.10.2026):** etap 3 jest zakończony. Otwarte odbiory 1.4/2.5 nie blokują niezależnej implementacji katalogu. Przy przejęciu CI aplikacji było zielone, build Engine [38765947897](https://github.com/JakubKonkol/Adrenaline/actions/runs/38765947897) nadal trwał; repo jest prywatne, jedyne wydanie to v0.1.0. Nie uznajemy aktualizacji ani silnika Windows za odebrane.
- **TMDB 4.1:** brak `.env` podczas przejęcia. Dokumentacja API sprawdzona w oficjalnym serwisie; fixtures offline są danymi syntetycznymi zgodnymi z kontraktem, wyraźnie opisanymi jako takie. Skrypt live pozwoli później zapisać rzeczywiste odpowiedzi. Test live i wydanie v0.4.0 pozostają oddzielnymi kryteriami odbioru.
- **TMDB — granice żądań:** limit odpowiedzi 5 MiB obejmuje także strumień bez `Content-Length`. Przy `Retry-After` do 10 s klient ponawia raz; przy dłuższym czasie od razu zwraca `TMDB_RATE_LIMITED`, bez przedwczesnego ponowienia. Brak dostępności opcjonalnego angielskiego opisu nie ukrywa pobranych polskich szczegółów. Skrypt live nie wywołuje celowo lawiny żądań dla 429 — ten przypadek testujemy syntetycznie.
- **Przekazanie do etapu 5:** dodano `catalog:select` (wejście zawiera wyłącznie identyfikatory, main pobiera i zapisuje zaufane metadane), a `/releases` pokazuje wybrany tytuł/odcinek oraz komunikat o funkcji dostępnej w kolejnej wersji. To punkt podłączenia etapu 5, nie gotowe wyszukiwanie wydań.
- **Silnik — zgodność z libtorrent 2.1 (15.10.2026):** wcześniejszy build Windows zbudował zależności i zapisał cache, ale poległ na API C++ (`list_files(src, {})`, usunięte `from_span` oraz wariant `make_magnet_uri(torrent_info)`). Poprawiono argument flag i użyto `load_torrent_buffer` / `add_torrent_params`, wspólnych dla 2.0.12 i 2.1.2. Wznowienie zachowuje również drzewa Merkle. Dodatkowa kontrola kompilacji z nagłówkami 2.1 wykryła usunięte `torrent_info::files()` — używamy `layout()` dla 2.1, pozostawiając `files()` dla 2.0. Źródła API: [load_torrent](https://github.com/arvidn/libtorrent/blob/v2.1.2/include/libtorrent/load_torrent.hpp), [torrent_info](https://github.com/arvidn/libtorrent/blob/v2.1.2/include/libtorrent/torrent_info.hpp).

- **Środowisko dev (etap 0.7):** pętla dev działa na Windows właściciela (Node 24.11), a silnik C++ budowany jest w WSL Ubuntu 26.04 (libtorrent 2.0.12 z apt, preset `linux-system`). Lokalnie brak MSVC/vcpkg; binarka Windows powstaje tylko w CI.
- **Wygląd (prośba właściciela 15.10.2026):** Adrenaline wizualnie należy do rodziny Oxytocin: te same neutralne kolory, typografia (Inter + JetBrains Mono, dołączone przez `@fontsource-variable/*`, bo CSP blokuje zewnętrzne fonty), etykiety mono uppercase, własny pasek tytułu 36 px (`titleBarStyle: hidden` + overlay). Akcent pomarańczowy z logo zamiast niebieskiego. Nadal CSS Modules + zmienne CSS bez Tailwinda (D-21).
- **Preload:** sandboxowany preload nie może ładować modułów npm, więc nazwy kanałów są w osobnym pliku bez Zod (`src/shared/contracts/channels.ts`), a schematy w `ipc.ts`.
- **Ikony:** `lucide-react` (ta sama biblioteka ikon co w Oxytocin). To biblioteka ikon, nie komponentów, więc D-21 pozostaje spełnione.
- **Pakowanie lokalne:** `npm run pack:win` działa na Windows właściciela (instalator NSIS + `latest.yml` + blockmap); spakowana aplikacja startuje i pokazuje stan aktualizacji.
- **Silnik — ponowne łączenie z peerami:** domyślne `min_reconnect_time` libtorrent (60 s) powodowało minutę przestoju po pauzie oraz po metadanych magnetu (przed `selectFiles` wszystkie priorytety = 0, torrent jest „finished” i rozłącza seedów). Ustawione na 5 s. Zdarzenie `ready` i wynik `hello` zawierają też `listenPort` (potrzebne testom).
- **Silnik — tryb testowy:** `--test-mode` dodatkowo obejmuje peery lokalne limitami prędkości (domyślnie libtorrent ich nie dławi), a `--resume-interval <s>` skraca okres zapisu resume (domyślnie 60 s) — test „kill w połowie” zabija proces tuż po zapisie.
- **Silnik — stan przed wyborem plików:** dopóki main nie wyśle `selectFiles`, silnik nie raportuje `downloaded/seeding` (torrent z zerowymi priorytetami jest dla libtorrent „finished”). Po restarcie main zawsze ponawia `selectFiles` z bazy.
- **Silnik — backend dysku (15.10.2026):** libtorrent 2.1 na Windows domyślnie używa eksperymentalnego `pread_disk_io`, którego bufor zapisu nie jest opróżniany przez `save_resume_data(flush_disk_cache)`. Skutek: plik zgłoszony jako gotowy miał chwilowo zera, a po zabiciu procesu resume wyprzedzało dysk (wykryte przez swarm na Windows). Silnik wymusza `mmap_disk_io` (domyślny w 2.0). Dodatkowo „gotowe” liczy się z postępu wybranych plików, a `fileCompleted`/`downloaded` wychodzą dopiero po zrzucie na dysk.
- **Silnik — test-mode tylko na 127.0.0.1:** przy porcie 0 gniazda IPv4/IPv6 dostawały na Windows różne porty.
- **Testy bez okien (prośba właściciela 15.10.2026):** testy z interfejsem Electrona (smoke, zrzuty) uruchamiam w WSL pod `xvfb`, nie na pulpicie. Silnik i Jackett to ukryte procesy konsolowe na loopback. Na Linuksie bez magazynu kluczy smoke sprawdza fallback sekretów z 3.3 (klucz tylko na sesję), na Windows ich trwałość.
- **Wyszukiwanie wydań:** linki do pobrania (z kluczem API Jackett) zostają w main; renderer dostaje wydania bez linków i wskazuje wybór przez `sessionId` + `releaseId`. Dokumenty Torznab z DTD są odrzucane, a dekodowane są tylko standardowe encje XML.
- **Audyt npm:** `npm audit --omit=dev` = 0 podatności; ostrzeżenia dotyczą tylko narzędzi deweloperskich (electron-builder → app-builder-lib). Do przeglądu w etapie 8.6.

## Historyczna notatka po etapie 4 — zastąpiona przez bieżący status powyżej

- Zaimplementowane zadania **4.2–4.5**. Kod: `src/main/providers/tmdb/`, `src/main/services/catalog-service.ts`, `src/main/persistence/repositories/{cache,media}.ts`, `src/main/ipc/catalog-handlers.ts`; kontrakty w `src/shared/contracts/catalog.ts`, model w `src/shared/domain/search-target.ts`; UI w `src/renderer/screens/catalog/`, `Home.tsx` i hooki `api/catalog.ts`.
- **4.1 częściowo:** dokumentacja i schematy zweryfikowane, fixtures syntetyczne (opis pochodzenia w `tests/fixtures/tmdb/README.md`), skrypt live gotowy. Do zakończenia: dodać klucz lokalnie, uruchomić `node scripts/live/tmdb.mjs`, zweryfikować i ewentualnie przenieść przycięte odpowiedzi z ignorowanego `tests/fixtures/tmdb/live/`. `.env` nie jest automatycznie używany przez aplikację — klucz zapisuje się przez Ustawienia.
- Testy: **152 zaliczone, 1 pominięty** (istniejący test uprawnień folderu pomijany na Windows). `npm.cmd run check`, build i rozszerzony smoke Playwright przechodzą. Smoke obejmuje katalog przez prawdziwe IPC/SQLite, wybór drugiego odcinka, restart i trwałość cache bez sieci; testy komponentowe obejmują awarię TMDB i dostępność innych ekranów.
- Katalog jest wypchnięty w **`3038c44`**, jego [CI 38770665332](https://github.com/JakubKonkol/Adrenaline/actions/runs/38770665332) jest zielone.
- Walidacja poprawki silnika: **WSL/libtorrent 2.0.12 — build + swarm 4/4** (`ADRENALINE_SKIP_BIG=1`, bez opcjonalnego pliku >4 GiB); wszystkie pliki C++ przeszły też `-fsyntax-only` z oficjalnymi nagłówkami **2.1.2 / ABI 100**. To nie zastępuje linkowania i uruchomienia na Windows. Artefakty lokalnej weryfikacji są w WSL `/root/adrenaline-codex-validation/` (poza repo).
- Engine Windows [38765947897](https://github.com/JakubKonkol/Adrenaline/actions/runs/38765947897) **zakończył się błędem kompilacji**, po udanej budowie zależności. Poprawka w `native/engine/src/{main,jobs}.cpp` opisana wyżej. **Nie zamykać 2.5 przed zielonym nowym Engine CI i swarmem Windows.** Nie zmieniano widoczności repo, nie wydano v0.1.1/v0.4.0 ani nie potwierdzono ręcznej aktualizacji.
- Następne prace: zakończyć odbiory powyżej, potem **5.1 — spike Jackett** według `etapy/etap-5-zrodla-jackett.md`. Przejście do etapu 5 bez testu live wymaga jawnego uzasadnienia w Odstępstwach zgodnie z README planu.

## Pomiary

- **NFR11 (15.10.2026, silnik Windows, lokalny seeder, przed limitem working setu):** 1 × 256 MiB — pamięć prywatna 6 MiB, working set 272 MiB; 3 × 256 MiB — prywatna 13 MiB, working set 787 MiB. Working set rósł liniowo przez mmap → limit 512 MiB (D-44).
- **NFR11 po limicie (silnik z CI 4d0bb86):** 1 × 256 MiB — prywatna 6 MiB, working set 273 MiB, 6 s; 3 × 256 MiB — prywatna 9 MiB, working set 512 MiB (limit), 8 s. Pamięć nie rośnie już liniowo z rozmiarem; skrypt: `scripts/dev/memory.test.ts`.
- **NFR03 (15.10.2026, live, 4 indeksatory + 1 zepsute źródło):** pierwsze wyniki w zdarzeniu `releases:update` po odpowiedzi pierwszego źródła; pełna sesja 3,5 s (limit 20 s).
