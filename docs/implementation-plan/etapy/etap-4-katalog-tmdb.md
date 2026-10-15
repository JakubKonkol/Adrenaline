# Etap 4 — Katalog TMDB: wyszukiwanie, szczegóły, sezony i odcinki

**Cel:** użytkownik wpisuje tytuł, rozróżnia podobne pozycje (rok, plakat, typ), wybiera film albo sezon i odcinek serialu (FR01, FR02).

**Wymaga:** etap 3.

## Zadania

### 4.1 Weryfikacja API
- Skryptem `scripts/live/tmdb.mjs` (klucz z `.env`) pobierz i zapisz do `tests/fixtures/tmdb/` przycięte odpowiedzi: `search/movie` („Night of the Living Dead”, film w domenie publicznej, ma remake 1990 — dobry przypadek FR01), `search/tv`, `movie/{id}?append_to_response=external_ids`, `tv/{id}?append_to_response=external_ids`, `tv/{id}/season/{n}`, odpowiedź 401 i 429. Usuń z fixtures klucze.
- Potwierdź w dokumentacji TMDB (developer.themoviedb.org) aktualne nazwy pól i nagłówek autoryzacji (D-60).

### 4.2 Klient (`src/main/providers/tmdb/`)
- `tmdb-client.ts`: `fetch` wstrzykiwany, `AbortController` z timeoutem 10 s, nagłówek `Authorization: Bearer <token>` (albo `api_key` dla klucza v3, rozpoznawane po długości/formacie), `language=pl-PL`, obsługa 401 (`TMDB_UNAUTHORIZED`), 429 z `Retry-After` (jedno ponowienie), 5xx/sieć (`TMDB_UNAVAILABLE`).
- Schematy Zod odpowiedzi (`.passthrough()` nie jest potrzebne; nieznane pola ignorowane, brak wymaganych → `TMDB_BAD_RESPONSE`).
- Mapowanie na typy domeny: `CatalogItem { type, tmdbId, title, originalTitle, year, posterPath, overview }`, `TitleDetails` (+ `imdbId`, `seasons[]` dla tv), `SeasonDetails { episodes[] }`.
- Fallback językowy: jeśli `overview` po polsku jest pusty, drugie zapytanie `en-US` tylko po szczegóły.
- Cache w tabeli `cache` (15 min wyszukiwanie, 24 h szczegóły i sezony).

### 4.3 Serwis i IPC
- `catalog-service.ts`: `search(query, type?)` (dla „wszystko” równolegle `search/movie` i `search/tv`, scalenie wg popularności), `details`, `season`. Zapis wybranego tytułu do `media_items`/`episodes` dopiero przy przejściu do wyszukiwania wydań.
- Kanały `catalog:*` z kontraktami.
- `settings:testTmdb` → wywołanie `configuration` lub prostego wyszukiwania, zwraca ok/kod błędu.

### 4.4 UI
- **Wyszukiwanie** (`/`): pole z debounce 350 ms, filtr Wszystko/Filmy/Seriale, lista kart (plakat `w185`, tytuł, oryginalny tytuł gdy inny, rok, typ jako tekst „Film”/„Serial”). Stany: pusty, ładowanie, brak wyników („Nie znaleziono tytułów dla …”), awaria TMDB (`TMDB_UNAVAILABLE` → „Katalog filmów jest chwilowo niedostępny. Pobieranie trwa dalej.”), brak klucza → link do Ustawień.
- **Szczegóły** (`/title/:type/:id`): plakat `w342`, opis, rok, gatunki, czas trwania; dla filmu przycisk „Szukaj wydań”; dla serialu lista sezonów → `/season/:n` z listą odcinków (numer, tytuł, data emisji) i przycisk „Szukaj wydań” przy odcinku.
- Atrybucja TMDB w stopce Szczegółów i w „O aplikacji”: logo TMDB (z oficjalnych zasobów) i tekst „This product uses the TMDB API but is not endorsed or certified by TMDB.”
- Klawiatura: Enter w wyszukiwarce, strzałki/Tab po wynikach, Enter otwiera szczegóły.

### 4.5 Model celu wyszukiwania
- `src/shared/domain/search-target.ts`: `SearchTarget = { kind: 'movie', tmdbId, imdbId?, title, originalTitle, year } | { kind: 'episode', tmdbId, imdbId?, title, originalTitle, year, season, episode }`. Przekazywany do etapu 5 przez stan routera.

## Kryteria odbioru
- [ ] Testy kontraktowe klienta TMDB na fixtures (sukces, pusty wynik, 401, 429, HTML zamiast JSON, brak pola).
- [ ] Dla „Night of the Living Dead” użytkownik widzi wersję 1968 i 1990 z różnymi latami i plakatami (FR01).
- [ ] Dla serialu można wybrać sezon i odcinek; `SearchTarget` zawiera poprawne numery (FR02).
- [ ] Awaria TMDB nie blokuje innych ekranów (sprawdź fake fetch rzucający błąd).
- [ ] Wydanie `v0.4.0`.

## Poza zakresem
Wyszukiwanie wydań (etap 5), specjalne odcinki/numeracja absolutna (tylko ostrzeżenie w etapie 5).
