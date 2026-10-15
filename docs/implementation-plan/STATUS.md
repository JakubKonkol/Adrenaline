# Status implementacji

Agent aktualizuje ten plik po każdym zamkniętym zadaniu (checkbox + krótka notatka, jeśli coś odbiega od planu). Zadania odpowiadają numeracji w `etapy/`.

**Bieżący etap:** 4 — katalog TMDB (kontynuacja Codex, 15.10.2026; etap 1: czeka v0.1.1 i test ręczny; etap 2: build Windows w toku)
**Ostatnie wydanie:** v0.1.0 (15.10.2026; electron-builder utworzył 2 Release dla jednego taga — scalone ręcznie, workflow poprawiony: najpierw draft)

## Blokady wymagające właściciela

- [x] Wybór źródła aktualizacji (D-07): upublicznienie `Adrenaline`, Releases w tym samym repo (decyzja 15.10.2026).
- [ ] Test ręczny etapu 1 (do potwierdzenia przez Jakuba): instalacja 0.1.0 → baner aktualizacji do 0.1.1 → restart w 0.1.1.
- [ ] Zmiana widoczności repo `JakubKonkol/Adrenaline` na publiczną. Potrzebne przed etapem 1.4.
- [ ] Klucz TMDB i konto/klucz OpenSubtitles w `.env` do testów live (etapy 4 i 7).

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
- [ ] 2.5 Pakowanie i CI
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
- [ ] 4.1 Weryfikacja API, fixtures — dokumentacja sprawdzona, syntetyczne fixtures i `scripts/live/tmdb.mjs` gotowe; zapis odpowiedzi live czeka na `TMDB_TOKEN` w `.env`.
- [x] 4.2 Klient — Bearer/klucz v3, timeout 10 s, walidacja Zod, limit odpowiedzi 5 MiB, stabilne błędy, jedno ponowienie 429, fallback opisu en-US; testy kontraktowe offline.
- [x] 4.3 Serwis i IPC — `catalog:search/details/season/select`, `settings:testTmdb`, cache SQLite 15 min/24 h, scalenie wg popularności. Media/odcinek zapisują się dopiero przy wyborze, na podstawie danych main.
- [x] 4.4 UI — wyszukiwanie z debounce 350 ms i filtrami, karty, szczegóły, sezony/odcinki, stany błędów i brak klucza, test klucza w Ustawieniach, oficjalne logo i atrybucja TMDB. Testy komponentowe obejmują nawigację i awarię katalogu.
- [x] 4.5 SearchTarget — walidowany film/odcinek trafia przez stan routera do `/releases`; ekran docelowy oczekuje implementacji wyszukiwania z etapu 5.

### Etap 5 — Źródła
- [ ] 5.1 Spike Jackett (decyzje D-56, D-57)
- [ ] 5.2 JackettManager
- [ ] 5.3 Adapter Torznab
- [ ] 5.4 Domena wydań
- [ ] 5.5 Serwis wyszukiwania
- [ ] 5.6 UI

### Etap 6 — Pobieranie
- [ ] 6.1 Domena zadań
- [ ] 6.2 Konfiguracja pobrania
- [ ] 6.3 Serwis pobrań
- [ ] 6.4 Restart i awaria (crash-loop 20 cykli)
- [ ] 6.5 UI
- [ ] 6.6 Smoke z restartem

### Etap 7 — Napisy
- [ ] 7.1 Weryfikacja API, fixtures
- [ ] 7.2 Hash
- [ ] 7.3 Klient
- [ ] 7.4 Pipeline
- [ ] 7.5 Ponowienie i ręczny wybór
- [ ] 7.6 UI

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
| Jackett | |

## Odstępstwa od planu

- **Kontynuacja od etapu 4 (15.10.2026):** etap 3 jest zakończony. Otwarte odbiory 1.4/2.5 nie blokują niezależnej implementacji katalogu. Przy przejęciu CI aplikacji było zielone, build Engine [38765947897](https://github.com/JakubKonkol/Adrenaline/actions/runs/38765947897) nadal trwał; repo jest prywatne, jedyne wydanie to v0.1.0. Nie uznajemy aktualizacji ani silnika Windows za odebrane.
- **TMDB 4.1:** brak `.env` podczas przejęcia. Dokumentacja API sprawdzona w oficjalnym serwisie; fixtures offline są danymi syntetycznymi zgodnymi z kontraktem, wyraźnie opisanymi jako takie. Skrypt live pozwoli później zapisać rzeczywiste odpowiedzi. Test live i wydanie v0.4.0 pozostają oddzielnymi kryteriami odbioru.
- **TMDB — granice żądań:** limit odpowiedzi 5 MiB obejmuje także strumień bez `Content-Length`. Przy `Retry-After` do 10 s klient ponawia raz; przy dłuższym czasie od razu zwraca `TMDB_RATE_LIMITED`, bez przedwczesnego ponowienia. Brak dostępności opcjonalnego angielskiego opisu nie ukrywa pobranych polskich szczegółów. Skrypt live nie wywołuje celowo lawiny żądań dla 429 — ten przypadek testujemy syntetycznie.
- **Przekazanie do etapu 5:** dodano `catalog:select` (wejście zawiera wyłącznie identyfikatory, main pobiera i zapisuje zaufane metadane), a `/releases` pokazuje wybrany tytuł/odcinek oraz komunikat o funkcji dostępnej w kolejnej wersji. To punkt podłączenia etapu 5, nie gotowe wyszukiwanie wydań.

- **Środowisko dev (etap 0.7):** pętla dev działa na Windows właściciela (Node 24.11), a silnik C++ budowany jest w WSL Ubuntu 26.04 (libtorrent 2.0.12 z apt, preset `linux-system`). Lokalnie brak MSVC/vcpkg; binarka Windows powstaje tylko w CI.
- **Wygląd (prośba właściciela 15.10.2026):** Adrenaline wizualnie należy do rodziny Oxytocin: te same neutralne kolory, typografia (Inter + JetBrains Mono, dołączone przez `@fontsource-variable/*`, bo CSP blokuje zewnętrzne fonty), etykiety mono uppercase, własny pasek tytułu 36 px (`titleBarStyle: hidden` + overlay). Akcent pomarańczowy z logo zamiast niebieskiego. Nadal CSS Modules + zmienne CSS bez Tailwinda (D-21).
- **Preload:** sandboxowany preload nie może ładować modułów npm, więc nazwy kanałów są w osobnym pliku bez Zod (`src/shared/contracts/channels.ts`), a schematy w `ipc.ts`.
- **Ikony:** `lucide-react` (ta sama biblioteka ikon co w Oxytocin). To biblioteka ikon, nie komponentów, więc D-21 pozostaje spełnione.
- **Pakowanie lokalne:** `npm run pack:win` działa na Windows właściciela (instalator NSIS + `latest.yml` + blockmap); spakowana aplikacja startuje i pokazuje stan aktualizacji.
- **Silnik — ponowne łączenie z peerami:** domyślne `min_reconnect_time` libtorrent (60 s) powodowało minutę przestoju po pauzie oraz po metadanych magnetu (przed `selectFiles` wszystkie priorytety = 0, torrent jest „finished” i rozłącza seedów). Ustawione na 5 s. Zdarzenie `ready` i wynik `hello` zawierają też `listenPort` (potrzebne testom).
- **Silnik — tryb testowy:** `--test-mode` dodatkowo obejmuje peery lokalne limitami prędkości (domyślnie libtorrent ich nie dławi), a `--resume-interval <s>` skraca okres zapisu resume (domyślnie 60 s) — test „kill w połowie” zabija proces tuż po zapisie.
- **Silnik — stan przed wyborem plików:** dopóki main nie wyśle `selectFiles`, silnik nie raportuje `downloaded/seeding` (torrent z zerowymi priorytetami jest dla libtorrent „finished”). Po restarcie main zawsze ponawia `selectFiles` z bazy.
- **Audyt npm:** `npm audit --omit=dev` = 0 podatności; ostrzeżenia dotyczą tylko narzędzi deweloperskich (electron-builder → app-builder-lib). Do przeglądu w etapie 8.6.

## Notatka dla kolejnego agenta — Codex, 15.10.2026

- Zaimplementowane zadania **4.2–4.5**. Kod: `src/main/providers/tmdb/`, `src/main/services/catalog-service.ts`, `src/main/persistence/repositories/{cache,media}.ts`, `src/main/ipc/catalog-handlers.ts`; kontrakty w `src/shared/contracts/catalog.ts`, model w `src/shared/domain/search-target.ts`; UI w `src/renderer/screens/catalog/`, `Home.tsx` i hooki `api/catalog.ts`.
- **4.1 częściowo:** dokumentacja i schematy zweryfikowane, fixtures syntetyczne (opis pochodzenia w `tests/fixtures/tmdb/README.md`), skrypt live gotowy. Do zakończenia: dodać klucz lokalnie, uruchomić `node scripts/live/tmdb.mjs`, zweryfikować i ewentualnie przenieść przycięte odpowiedzi z ignorowanego `tests/fixtures/tmdb/live/`. `.env` nie jest automatycznie używany przez aplikację — klucz zapisuje się przez Ustawienia.
- Testy: **152 zaliczone, 1 pominięty** (istniejący test uprawnień folderu pomijany na Windows). `npm.cmd run check`, build i rozszerzony smoke Playwright przechodzą. Smoke obejmuje katalog przez prawdziwe IPC/SQLite, wybór drugiego odcinka, restart i trwałość cache bez sieci; testy komponentowe obejmują awarię TMDB i dostępność innych ekranów.
- Engine Windows [38765947897](https://github.com/JakubKonkol/Adrenaline/actions/runs/38765947897) przy ostatnim sprawdzeniu nadal budował zależności vcpkg. Sprawdzić wynik przed zamknięciem **2.5** i wydaniem. Nie zmieniano widoczności repo, nie wydano v0.1.1/v0.4.0 ani nie potwierdzono ręcznej aktualizacji.
- Następne prace: zakończyć odbiory powyżej, potem **5.1 — spike Jackett** według `etapy/etap-5-zrodla-jackett.md`. Przejście do etapu 5 bez testu live wymaga jawnego uzasadnienia w Odstępstwach zgodnie z README planu.

## Pomiary

Brak.
