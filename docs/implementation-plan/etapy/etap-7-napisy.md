# Etap 7 — Napisy (OpenSubtitles)

**Cel:** po ukończeniu pliku wideo Adrenaline znajduje, dopasowuje i zapisuje napisy w wybranym języku obok wideo; brak lub błąd napisów to częściowy sukces z możliwością ponowienia samych napisów (FR14–FR17, FR22, BR03, BR04).

**Wymaga:** etap 6.

## Zadania

### 7.1 Weryfikacja API (D-61)
- Przeczytaj aktualną dokumentację OpenSubtitles REST (opensubtitles.stoplight.io) i potwierdź: base URL `https://api.opensubtitles.com/api/v1`, nagłówki `Api-Key`, `User-Agent` (format `Adrenaline v0.7.0`), `Authorization: Bearer <token>` po logowaniu, `Content-Type`/`Accept: application/json`.
- Spodziewane wywołania (potwierdź nazwy pól): `POST /login` (`username`, `password` → `token`, `base_url`, `user.allowed_downloads`, `user.remaining_downloads`), `GET /subtitles` (`tmdb_id` lub `parent_tmdb_id` dla odcinków, `season_number`, `episode_number`, `languages`, `moviehash`, `query`; wynik: `data[].attributes` z `language`, `release`, `hearing_impaired`, `foreign_parts_only`, `moviehash_match`, `files[].file_id`, `download_count`, `ratings`), `POST /download` (`file_id` → `link`, `file_name`, `remaining`, `reset_time_utc`), `DELETE /logout`.
- Jeśli `login` zwraca inny `base_url`, kolejne żądania idą na niego.
- Skryptem `scripts/live/opensubtitles.mjs` (dane z `.env`) zapisz przycięte odpowiedzi do `tests/fixtures/opensubtitles/` (bez tokenów). Każdą różnicę względem tego planu zapisz jako aktualizację D-61.
- Licz wywołania `download` oszczędnie (limit konta). Nie zużywaj limitu na każdy wynik wyszukiwania.

### 7.2 Hash pliku (`src/main/providers/opensubtitles/movie-hash.ts`)
- Algorytm OpenSubtitles: `hash = rozmiar_pliku + suma 64-bitowych słów little-endian z pierwszych 64 KiB + suma z ostatnich 64 KiB`, modulo 2^64, zapis jako 16 znaków hex. Pliki < 128 KiB → brak hasha. Implementacja na `BigInt`, czytanie tylko 2 × 64 KiB (`fs.open` + `read` z pozycją).
- Test na wygenerowanych plikach z wartościami policzonymi niezależną implementacją w teście (oraz, jeśli dokumentacja podaje, na oficjalnym przykładzie).

### 7.3 Klient (`opensubtitles-client.ts`)
- Logowanie z hasłem z sekretów, token w sekrecie `opensubtitles.token` z czasem wygaśnięcia; 401 → jedno ponowne logowanie; dalsze 401 → `SUBS_AUTH` (FR22: komunikat „Zaloguj się ponownie” w Ustawieniach, kolejka nienaruszona).
- 429 / `remaining = 0` → `SUBS_QUOTA` z `reset_time_utc` (BR03). 5xx/sieć → `SUBS_UNAVAILABLE`, ponowienie z backoffem (maks. 3), ale **nigdy** automatyczne ponowienie `POST /download`, jeśli odpowiedź mogła zostać przetworzona (timeout po wysłaniu) — wtedy stan `error` z akcją „Ponów” dla użytkownika.
- Link z `/download` pobierany natychmiast, nie zapisywany w DB.

### 7.4 Pipeline (`subtitle-service.ts`)
1. Przy tworzeniu zadania: `subtitle_tasks` dla języka podstawowego (i fallbacku tylko jako preferencja; fallback używany **tylko** gdy podstawowy nie istnieje i użytkownik go ustawił — FR14) w stanie `pending` lub `disabled`.
2. Wstępne wyszukiwanie (opcjonalne, po utworzeniu zadania): `GET /subtitles` po `tmdb_id`/odcinku i języku → informacja „Napisy prawdopodobnie dostępne (wstępnie)” w UI. Bez pobierania.
3. Po `fileCompleted` dla pliku wideo: `searching` → liczenie hasha → `GET /subtitles` z `moviehash` + `tmdb_id` (+ sezon/odcinek) + język.
4. Ranking (`src/shared/domain/subtitle-rank.ts`): `moviehash_match` → najwyżej; potem zgodność `release` z nazwą wydania (grupa, źródło, rozdzielczość, edycja), potem liczba pobrań/oceny. Pomijaj `foreign_parts_only` (chyba że użytkownik wybierze ręcznie); preferuj nie-SDH, jeśli nie ustawiono inaczej. Pewność: `high` (hash) / `medium` (silna zgodność nazwy) / `low`.
5. `high` lub `medium` → `downloading` → `POST /download` → pobranie pliku. `low` lub brak jednoznacznego kandydata → `needs_selection` z listą kandydatów (FR17; UI nie nazywa ich „dopasowanymi”).
6. Walidacja: rozmiar ≤ 5 MB, rozszerzenie `srt|ass|ssa|vtt|sub`, dekodowanie (UTF-8, a w razie błędu Windows-1250/ISO-8859-2 dla PL przez `TextDecoder`; zapis zawsze jako UTF-8 bez BOM), sprawdzenie, że to tekst napisów (np. ≥ 1 znacznik czasu). Archiwum (`.zip`/`.gz`) rozpakowywane do katalogu tymczasowego z limitem rozmiaru i ochroną przed traversal.
7. Zapis obok wideo: `<baza_wideo>.<lang>.<ext>` (FR15, D-62) przez `atomic-write`; jeśli plik istnieje i nie został utworzony przez Adrenaline → `<baza>.<lang>.2.<ext>` (BR07). Nie zmieniaj nazwy ani zawartości wideo.
8. Stan `ready`, `target_path` w DB; `deriveJobStatus` zmienia się na „Gotowe”.
9. `not_found` / `quota_exceeded` / `error` → film pozostaje dostępny, status „Film gotowy — napisy wymagają uwagi” (BR03, FR16).

### 7.5 Ponowienie i ręczny wybór
- `downloads:retrySubtitles(jobId)` → ponowny pipeline od kroku 3 bez dotykania torrenta (FR16).
- `downloads:chooseSubtitleCandidate` → pobranie wskazanego kandydata (krok 5–8).
- Zmiana języka w szczegółach zadania (zapisana w zadaniu).

### 7.6 UI
- Konfiguracja pobrania: wybór języka (lista ISO 639-1 z polskimi nazwami, domyślnie z ustawień) i fallbacku, „Bez napisów”.
- Pobrane: osobna kolumna/odznaka statusu napisów z tekstem (Oczekuje na film / Szukanie / Wymaga wyboru / Gotowe / Nie znaleziono / Limit do <godzina> / Błąd).
- Szczegóły zadania: lista kandydatów z nazwą wydania, językiem, oznaczeniem SDH/forced, zgodnością hash, przycisk „Użyj tych napisów”; „Szukaj ponownie”.
- Ustawienia → Konta: klucz API, login, hasło, „Sprawdź połączenie” (pokazuje pozostałe pobrania), „Wyloguj”.

## Kryteria odbioru
- [ ] Testy: hash, ranking, wybór fallbacku (FR14), nazwy plików i konflikty (FR15, BR07), walidacja/dekodowanie, klient na fixtures (sukces, brak wyników, 401 → relogin, 429/limit, HTML), pipeline na fake kliencie: ready / needs_selection / not_found / quota.
- [ ] Ponowienie napisów nie wywołuje żadnej komendy silnika (test).
- [ ] Ręczny test live z legalnym materiałem (np. film z domeny publicznej z dostępnymi napisami) — napis zapisany obok wideo z kodem języka (FR15).
- [ ] Wydanie `v0.7.0`.

## Poza zakresem
Drugi dostawca, ręczny import pliku napisów (po MVP), synchronizacja/generowanie napisów, muxowanie.
