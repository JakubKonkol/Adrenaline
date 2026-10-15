# Środowisko deweloperskie

## Aplikacja (Windows lub Linux)

- Node 24 (`.nvmrc`), npm 11.
- `npm ci` — instalacja (pobiera też binarkę Electron).
- `npm run dev` — aplikacja z HMR. Bez zbudowanego silnika: `ADRENALINE_FAKE_ENGINE=1`, bez Jackett: `ADRENALINE_NO_JACKETT=1`.
- `npm run check` — lint + typecheck + testy jednostkowe. Musi przejść przed każdym commitem.
- `npm run build && npm run test:smoke` — smoke test Playwright na zbudowanej aplikacji. Na Linuksie bez ekranu: `xvfb-run -a npm run test:smoke` (`apt-get install -y xvfb`).
- `ADRENALINE_USER_DATA=<katalog>` — osobny profil danych (tylko niespakowana aplikacja).

## Silnik C++ (`native/engine`)

Na Windows binarka powstaje w GitHub Actions (`engine-ci.yml`, preset `windows-release`, vcpkg). Lokalnie najprościej budować wersję linuksową w WSL (Ubuntu) albo kontenerze:

```bash
apt-get install -y build-essential cmake ninja-build libtorrent-rasterbar-dev nlohmann-json3-dev pkg-config
cd native/engine
cmake --preset linux-system && cmake --build --preset linux-system
```

Test swarm (`npm run test:engine`) uruchamia binarkę wskazaną w `ADRENALINE_ENGINE_PATH`; w WSL potrzebny jest Node 24 w dystrybucji.
