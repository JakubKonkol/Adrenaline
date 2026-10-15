# Środowisko deweloperskie

## Aplikacja (Windows lub Linux)

- Node 24 (`.nvmrc`), npm 11.
- `npm ci` — instalacja (pobiera też binarkę Electron).
- `npm run dev` — aplikacja z HMR. Bez zbudowanego silnika: `ADRENALINE_FAKE_ENGINE=1`, bez Jackett: `ADRENALINE_NO_JACKETT=1`.
- `npm run check` — lint + typecheck + testy jednostkowe. Musi przejść przed każdym commitem.
- `npm run build && npm run test:smoke` — smoke test Playwright na zbudowanej aplikacji. Na Linuksie bez ekranu: `xvfb-run -a npm run test:smoke` (`apt-get install -y xvfb`).
- `ADRENALINE_USER_DATA=<katalog>` — osobny profil danych (tylko niespakowana aplikacja).

## Katalog TMDB (etap 4)

- W aplikacji zapisz własny token „API Read Access Token” lub klucz v3 w Ustawieniach → Konta i klucze. Przycisk „Sprawdź zapisany klucz TMDB” wykonuje zapytanie `configuration`. Renderer nie odczytuje sekretu.
- Do testu live skopiuj `.env.example` do `.env`, ustaw `TMDB_TOKEN` i uruchom `node scripts/live/tmdb.mjs`. Plik `.env` służy tylko skryptom live, nie ustawia automatycznie kont w aplikacji.
- Skrypt zapisuje przycięte odpowiedzi w ignorowanym `tests/fixtures/tmdb/live/`. W razie potrzeby `TMDB_TEST_TV_QUERY` wskazuje inny tytuł serialu. Brak klucza kończy skrypt kodem 1 bez zapytania do sieci.
- Testy jednostkowe i smoke używają danych syntetycznych opisanych w `tests/fixtures/tmdb/README.md`; nie łączą się z TMDB. Smoke przechodzi przez prawdziwe IPC i SQLite, podmieniając tylko `fetch` w uruchomionym procesie testowym.
- Na Windows z zablokowanym `npm.ps1` uruchamiaj `npm.cmd run check` / `npm.cmd run build`; nie trzeba zmieniać polityki PowerShell.

## Silnik C++ (`native/engine`)

Na Windows binarka powstaje w GitHub Actions (`engine-ci.yml`, preset `windows-release`, vcpkg). Lokalnie najprościej budować wersję linuksową w WSL (Ubuntu) albo kontenerze:

```bash
apt-get install -y build-essential cmake ninja-build libtorrent-rasterbar-dev nlohmann-json3-dev pkg-config
cd native/engine
cmake --preset linux-system && cmake --build --preset linux-system
```

Test swarm (`npm run test:engine`) uruchamia binarkę wskazaną w `ADRENALINE_ENGINE_PATH`; w WSL potrzebny jest Node 24 w dystrybucji.
