# TMDB fixtures

Stan początkowy 15.10.2026: **syntetyczne dane kontraktowe**, nie zarejestrowane odpowiedzi live. Brak `.env`/klucza podczas implementacji. Nazwy i identyfikatory dwóch filmów służą rozróżnieniu roku; opisy oraz ścieżki plakatów są testowe. Serial i odcinki są własnymi fikcyjnymi danymi. Testy nie pobierają obrazów ani filmów.

Kontrakt sprawdzony z dokumentacją TMDB (15.10.2026):
- [Autoryzacja](https://developer.themoviedb.org/docs/authentication-application): Bearer lub parametr `api_key`.
- [Movie search](https://developer.themoviedb.org/reference/search-movie), [TV search](https://developer.themoviedb.org/reference/search-tv): `results`, `title`/`name`, `original_title`/`original_name`, `release_date`/`first_air_date`, `poster_path`, `popularity`.
- [Movie details](https://developer.themoviedb.org/reference/movie-details), [TV details](https://developer.themoviedb.org/reference/tv-series-details): gatunki, runtime / episode_run_time, seasons; `append_to_response=external_ids`.
- [Sezony](https://developer.themoviedb.org/reference/tv-season-details): `episodes`, `season_number`, `episode_number`, `air_date`.
- [Limity](https://developer.themoviedb.org/docs/rate-limiting): obsługa HTTP 429. Testy dostarczają syntetyczny `Retry-After`; nie zakładamy, że TMDB zawsze go wysyła.

`node scripts/live/tmdb.mjs` czyta `TMDB_TOKEN` z `.env` i zapisuje przycięte odpowiedzi do `live/` (ignorowane przez git). Nie nadpisuje deterministycznych danych kontraktowych. Zweryfikowane odpowiedzi można później przenieść do fixtures wraz z informacją o pochodzeniu. Skrypt nie wywołuje celowo 429 przez przeciążanie API; ten przypadek jest symulowany offline.

Oficjalne logo w `src/renderer/assets/brand/tmdb.svg` pobrano bez modyfikacji z [zasobów TMDB](https://www.themoviedb.org/about/logos-attribution), plik `blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg`.
