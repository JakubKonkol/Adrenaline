# Development setup

## App (Windows or Linux)

- Node 24 (`.nvmrc`), npm 11.
- `npm ci` — install (also downloads the Electron binary).
- `npm run dev` — the app with hot reload. Without a built engine: `ADRENALINE_FAKE_ENGINE=1`; without Jackett: `ADRENALINE_NO_JACKETT=1`.
- `npm run check` — lint + typecheck + unit tests. Must pass before every commit.
- `npm run build && npm run test:smoke` — Playwright smoke test of the built app. On Linux without a display: `xvfb-run -a npm run test:smoke` (`apt-get install -y xvfb`).
- `ADRENALINE_USER_DATA=<dir>` — a separate data profile (unpackaged app only).
- `xvfb-run -a node scripts/dev/readme-screenshots.mjs` — regenerates the README screenshots in `docs/screenshots/` from synthetic data (public-domain titles, generated posters, fake engine).
- On Windows with a blocked `npm.ps1`, run `npm.cmd run check` / `npm.cmd run build`; there is no need to change the PowerShell policy.

## TMDB catalog

- In the app, save your own API Read Access Token or v3 key in Settings → Accounts and keys. “Test the saved TMDB key” calls `configuration`. The renderer never reads the secret.
- For a live test, copy `.env.example` to `.env`, set `TMDB_TOKEN` and run `node scripts/live/tmdb.mjs`. `.env` is used only by the live scripts; it does not configure accounts in the app.
- The script saves trimmed responses to the git-ignored `tests/fixtures/tmdb/live/`. `TMDB_TEST_TV_QUERY` picks another TV title if needed. Without a key the script exits with code 1 before any network request.
- Unit and smoke tests use the synthetic data described in `tests/fixtures/tmdb/README.md` and never contact TMDB. The smoke test goes through the real IPC and SQLite and only replaces `fetch` in the running test process.

## OpenSubtitles

- `node scripts/live/opensubtitles.mjs` reads `OPENSUBTITLES_API_KEY`, `OPENSUBTITLES_USERNAME` and `OPENSUBTITLES_PASSWORD` from `.env`. By default it does not spend download quota.

## C++ engine (`native/engine`)

The Windows binary is built in GitHub Actions (`engine-ci.yml`, preset `windows-release`, vcpkg). Locally it is easiest to build the Linux version in WSL (Ubuntu) or a container:

```bash
apt-get install -y build-essential cmake ninja-build libtorrent-rasterbar-dev nlohmann-json3-dev pkg-config
cd native/engine
cmake --preset linux-system && cmake --build --preset linux-system
```

The swarm test (`npm run test:engine`) runs the binary set in `ADRENALINE_ENGINE_PATH`; in WSL you need Node 24 inside the distribution. It uses a file with a Polish name, so run it with a UTF-8 locale (`LANG=C.UTF-8`); `ADRENALINE_SKIP_BIG=1` skips the sparse file over 4 GiB.
