# Etap 5 — Źródła: dołączony Jackett, Torznab, normalizacja, deduplikacja, lista wydań

**Cel:** po wybraniu tytułu Adrenaline równolegle przeszukuje co najmniej trzy źródła, pokazuje wyniki częściowe, stan każdego źródła i porównywalną listę wydań (FR03–FR06, FR18, BR08).

**Wymaga:** etap 4.

## Zadania

### 5.1 Spike Jackett na Windows (najpierw!)
Cel: zweryfikować D-50, D-51, D-54 zanim powstanie reszta kodu.
- `scripts/fetch-jackett.mjs` + `scripts/jackett-version.txt` + `scripts/jackett-sha256.txt` (opis w `04-release-i-autoupdate.md`).
- Workflow `jackett-spike.yml` (`workflow_dispatch`, `windows-latest`): pobiera Jackett, uruchamia `JackettConsole.exe --NoUpdates --NoRestart --ListenPrivate --Port <wolny port wybrany przez skrypt>`, z wybranym katalogiem danych (`--DataFolder <RUNNER_TEMP>\jackett-data`), bez uprawnień administratora (runner działa jako admin, więc dodatkowo sprawdź w logach, czy Jackett pisze tam, gdzie wskazano), czeka na `GET /api/v2.0/server/config`, wypisuje wersję .NET z logów, dodaje jeden publiczny indeksator przez API i wykonuje `t=caps`.
- Właściciel dodatkowo uruchamia ten sam skrypt w Windows Sandbox (czysty system bez .NET), instrukcja w `docs/manual-tests.md`. Do tego czasu przyjmij wynik z CI jako wstępny.
- Zapisz wyniki jako decyzje (np. `D-56 Jackett: katalog danych …`, `D-57 Jackett: konfiguracja indeksatorów przez API …`) w `00-decyzje.md`.
- Ustal i zapisz faktyczne endpointy administracyjne używane przez UI Jackett (spodziewane: `GET /api/v2.0/indexers?configured=false`, `GET|POST /api/v2.0/indexers/{id}/config`, `DELETE /api/v2.0/indexers/{id}`, `GET|POST /api/v2.0/server/config`, `POST /api/v2.0/server/adminpassword`; potwierdź w kodzie źródłowym Jackett dla przypiętej wersji). Uwierzytelnianie panelu: ustaw losowe hasło admina przy pierwszym uruchomieniu i loguj się cookie (`POST /UI/Dashboard`), jeśli API tego wymaga.

### 5.2 JackettManager (`src/main/jackett/`)
- `jackett-manager.ts`: przy starcie aplikacji (leniwie, przy pierwszym wyszukiwaniu albo w tle po 5 s): wybór wolnego portu na `127.0.0.1`, uruchomienie z `--NoUpdates --NoRestart --ListenPrivate`, katalog danych `userData/jackett`, oczekiwanie na health (maks. 30 s), odczyt klucza API z `ServerConfig.json` (lub API), zapis klucza jako sekret. Restart z backoffem jak silnik. `stop()`: próba łagodna (zamknięcie procesu `taskkill /PID` bez `/F`, po 5 s `/F`). Podłączone do `shutdown()`.
- `ADRENALINE_NO_JACKETT=1` wyłącza wbudowany Jackett (dev/testy); wtedy działają tylko źródła własne użytkownika.
- `jackett-admin.ts`: lista dostępnych indeksatorów, dodanie (z domyślną konfiguracją publicznego indeksatora), usunięcie, test (`t=caps` + puste wyszukiwanie).
- `default-indexers.ts` (D-53): identyfikatory Jackett kandydatów, każdy z opisem dla UI. Przy pierwszym uruchomieniu nic nie jest włączone.
- `electron-builder.yml`: `extraResources` dla `vendor/jackett`; `release.yml`: krok `node scripts/fetch-jackett.mjs`. `THIRD_PARTY_NOTICES.md`: Jackett GPL-2.0 + link do źródeł tagu.

### 5.3 Adapter Torznab (`src/main/providers/torznab/`)
- `torznab-client.ts`: `caps()` (cache 24 h w tabeli `cache`), `search(params)`; URL bazowy per źródło (wbudowany: `http://127.0.0.1:<port>/api/v2.0/indexers/<id>/results/torznab/api`; własny: podany przez użytkownika). Tylko `http(s)`, timeout 12 s, limit odpowiedzi 5 MB, `fast-xml-parser` z `processEntities: false`, `ignoreAttributes: false`.
- Wybór zapytania wg `caps`: dla filmu `t=movie` z `imdbid` jeśli wspierane, inaczej `t=search&q=<tytuł> <rok>&cat=2000`; dla odcinka `t=tvsearch&q=<tytuł>&season=N&ep=M` jeśli wspierane, inaczej `t=search&q=<tytuł> S0NE0M&cat=5000`. Dodatkowe zapytanie z tytułem oryginalnym, gdy różni się od polskiego.
- Parsowanie `item`: `title`, `guid`, `link`, `size`, `pubDate`, `enclosure@url`, atrybuty `torznab:attr` (`seeders`, `peers`, `infohash`, `magneturl`, `imdbid`, `category`, `downloadvolumefactor`). Brak pola = `null` (nie 0).
- Rozpoznanie błędów: XML `<error code=… description=…>` → `SOURCE_BAD_RESPONSE`/`SOURCE_AUTH`; HTML zamiast XML → `SOURCE_BAD_RESPONSE`; timeout → `SOURCE_TIMEOUT`.
- Ochrona SSRF (bezpieczeństwo z planu technicznego): żądania tylko do skonfigurowanego endpointu źródła; linki z wyników (`link`, `enclosure`) pobierane wyłącznie, gdy host = host źródła lub schemat `magnet:`. Przekierowania obsługiwane ręcznie (`redirect: 'manual'`); `Location: magnet:…` jest akceptowane.

### 5.4 Domena wydań (`src/shared/domain/`)
- `release-parser.ts`: z surowej nazwy wyciąga `resolution` (`480p|576p|720p|1080p|2160p|null`), `source` (`WEB-DL|WEBRip|BluRay|Remux|HDTV|DVDRip|CAM|TS|null`), `codec` (`x264|x265/HEVC|AV1|null`), `hdr` (`HDR|HDR10+|DV|null`), `audio` (np. `DDP5.1`, `Atmos`), `languages` (`PL`, `MULTi`, `Dubbing PL`, `Napisy PL` jako tagi), `edition` (`Director's Cut`, `Extended`), `group`, `season`, `episode`, `isSeasonPack`, `year`. Zestaw regexów + tokenizacja; test na `tests/fixtures/release-names.json` (min. 40 przypadków, patrz `03-testy.md`).
- `magnet.ts`: parsowanie `xt=urn:btih:` (hex 40 lub base32 32 → hex), `xt=urn:btmh:1220…` (v2), `dn`, `tr`.
- `dedupe.ts` (FR04): klucz = infohash v1 lub v2 (z atrybutu `infohash` albo z magnetu); scalanie listy źródeł; seedy **nie są sumowane**, pokazujemy maks. z datą obserwacji (BR08). Wyniki bez hasha nie są scalane.
- `match.ts` + `rank.ts`: wynik zgodności 0–100 (tytuł/rok/sezon/odcinek; kara za paczkę sezonu gdy szukamy odcinka, za CAM/TS, za niezgodny rok), sortowanie: zgodność → preferowana jakość → seedy. Ostrzeżenie „inny sezon” przy niezgodnym SxxEyy (FR02).
- Testy jednostkowe wszystkich czterech modułów.

### 5.5 Serwis wyszukiwania wydań
- `release-search-service.ts`: `startSearch(target)` tworzy sesję; kolejka zapytań z limitem 3 równoległych, timeout źródła 12 s, limit sesji 20 s (D-55); po każdej odpowiedzi źródła: parsowanie, normalizacja, scalanie, emisja `releases:update` z pełnym aktualnym stanem sesji (`sources: [{id, name, state: pending|ok|empty|error, count, errorCode}]`, `releases: Release[]`). Wynik pokazuje się w UI w < 1 s od odpowiedzi (NFR03).
- Cache wyników sesji 5 min po kluczu (target + zestaw źródeł); „Odśwież” omija cache.
- Rozróżnienie stanów (BR08): wszystkie źródła odpowiedziały pusto → „Nie znaleziono wydań”; wszystkie błędem → `ALL_SOURCES_FAILED` „Nie udało się przeszukać źródeł”.

### 5.6 UI
- **Wydania** (`/releases`): nagłówek z tytułem/odcinkiem, pasek „Odpowiedziało 3 z 4 źródeł” z rozwijaną listą stanów i przyczyn, tabela: nazwa wydania (pełna w tooltipie/szczegółach), rozdzielczość, źródło obrazu, kodek, HDR, rozmiar, seedy (z „wg <źródło>, <czas temu>”), źródła, ostrzeżenia (paczka sezonu, inny rok, CAM). Brakujące pola jako „nieznane” (FR05). Filtr rozdzielczości, sortowanie: zgodność / rozmiar / seedy (FR06). Klawiatura: strzałki + Enter.
- **Ustawienia → Źródła** (FR18): lista wbudowanych indeksatorów z przełącznikiem, „Sprawdź połączenie”, ostatni stan i przyczyna; dodanie własnego endpointu Torznab (URL + klucz API, zapisany jako sekret); stan wbudowanego Jackett (działa/błąd + „Uruchom ponownie”).
- Krok źródeł w kreatorze z etapu 3.

## Kryteria odbioru
- [ ] Spike Jackett zakończony, decyzje D-56/D-57 zapisane.
- [ ] Testy kontraktowe Torznab na fixtures: poprawny wynik, pusty kanał, `<error>`, HTML, ogromna odpowiedź (odrzucona), encje XML (nierozwinięte).
- [ ] Testy parsera (≥ 40 nazw), magnetu, deduplikacji (ten sam hash z 2 źródeł → 1 wiersz z 2 źródłami), rankingu.
- [ ] Ręczny test live (`scripts/live/search.mjs` albo w aplikacji): ≥ 3 skonfigurowane źródła odpowiadają; wyłączenie sieci dla jednego (np. błędny endpoint) nie usuwa wyników pozostałych (FR03).
- [ ] Wydanie `v0.5.0` z Jackett w instalatorze; po instalacji „Ustawienia → Źródła” pokazuje działający Jackett (test ręczny właściciela).

## Poza zakresem
Prywatne trackery z logowaniem (działają tylko przez własny endpoint użytkownika), Nyaa/anime, import magnet/.torrent (FR24, po MVP).
