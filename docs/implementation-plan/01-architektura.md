# Architektura

## Procesy

```
┌──────────────────────── Adrenaline.exe (Electron) ────────────────────────┐
│  Renderer (React, sandbox, bez Node)                                        │
│      │  window.adrenaline.*  (preload, contextBridge, wąskie typowane API)  │
│      ▼                                                                      │
│  Main process                                                               │
│   ├─ ipc/            walidacja Zod każdego wywołania, sprawdzenie nadawcy   │
│   ├─ services/       katalog, wyszukiwanie wydań, kolejka pobrań, napisy    │
│   ├─ providers/      TMDB, Torznab, OpenSubtitles (czyste klienty HTTP)     │
│   ├─ persistence/    node:sqlite, migracje, repozytoria                     │
│   ├─ engine/         EngineClient: spawn + JSON Lines + heartbeat + restart │
│   ├─ jackett/        JackettManager: konfiguracja, spawn, health, shutdown  │
│   └─ updater/        electron-updater                                       │
└───────┬───────────────────────────────────────┬─────────────────────────────┘
        │ stdin/stdout JSON Lines               │ HTTP 127.0.0.1:<port>
        ▼                                       ▼
  adrenaline-engine.exe (C++/libtorrent)   JackettConsole.exe (Torznab)
```

Zasady:
- Renderer nie ma Node, systemu plików ani sekretów. `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, CSP `default-src 'self'; img-src 'self' https://image.tmdb.org data:; connect-src 'self'`. Plakaty TMDB ładowane bezpośrednio z `image.tmdb.org` (bez klucza). Wszystkie inne żądania sieciowe robi main.
- Main nie blokuje wątku: wszystkie operacje I/O asynchroniczne, hash OpenSubtitles liczony strumieniowo (czyta tylko 2 × 64 KiB).
- Silnik i Jackett uruchamiane przez `child_process.spawn` z bezwzględną ścieżką, `shell: false`, `windowsHide: true`. Ścieżki: w dev `native/engine/build/...` i `vendor/jackett/...`; po spakowaniu `process.resourcesPath/engine/adrenaline-engine.exe` i `process.resourcesPath/jackett/JackettConsole.exe` (electron-builder `extraResources`, poza ASAR).
- Dane procesów w `userData`: `engine/` (pliki resume, stan sesji DHT), `jackett/` (konfiguracja Jackett), `adrenaline.db`, `logs/`.

## Struktura repozytorium

```
/
├─ CLAUDE.md
├─ package.json, package-lock.json
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ tsconfig.json, tsconfig.node.json, tsconfig.web.json
├─ eslint.config.js, .prettierrc
├─ vitest.config.ts, playwright.config.ts
├─ .github/workflows/ci.yml, release.yml
├─ build/                      ikona (icon.ico 256×256), zasoby instalatora
├─ scripts/
│   ├─ fetch-jackett.mjs       pobiera i rozpakowuje przypięty Jackett do vendor/jackett
│   ├─ jackett-version.txt
│   └─ check-version-tag.mjs   porównuje tag z package.json (release workflow)
├─ native/engine/
│   ├─ CMakeLists.txt, CMakePresets.json, vcpkg.json
│   ├─ src/main.cpp, protocol.{hpp,cpp}, session.{hpp,cpp}, jobs.{hpp,cpp}, resume.{hpp,cpp}
│   └─ tests/                  test integracyjny (skrypt Node/Vitest steruje dwoma instancjami)
├─ src/
│   ├─ shared/                 kod bez zależności od Electrona/Node (używany przez main i renderer)
│   │   ├─ domain/             modele, stany, reguły (release-parser, dedup, ranking, przejścia stanów)
│   │   ├─ contracts/          schematy Zod: IPC, protokół silnika, DTO
│   │   └─ errors.ts           stabilne kody błędów (AppErrorCode)
│   ├─ main/
│   │   ├─ index.ts            lifecycle aplikacji, okno, zasobnik, single-instance lock
│   │   ├─ ipc/                rejestracja handlerów, walidacja
│   │   ├─ services/           catalog-service, release-search-service, download-service, subtitle-service, settings-service
│   │   ├─ providers/          tmdb/, torznab/, opensubtitles/
│   │   ├─ persistence/        db.ts, migrations/*.sql, repositories/*.ts
│   │   ├─ engine/             engine-client.ts, engine-process.ts, fake-engine.ts (do testów)
│   │   ├─ jackett/            jackett-manager.ts, jackett-admin.ts, default-indexers.ts
│   │   ├─ fs/                 safe-path.ts, disk-space.ts, atomic-write.ts
│   │   ├─ secrets.ts          safeStorage
│   │   ├─ updater.ts
│   │   └─ logger.ts
│   ├─ preload/index.ts        contextBridge → window.adrenaline
│   └─ renderer/
│       ├─ index.html, main.tsx, App.tsx, routes.tsx
│       ├─ i18n/pl.ts
│       ├─ api/                hooki TanStack Query nad window.adrenaline
│       ├─ screens/            Search, Details, Releases, DownloadSetup, Downloads, JobDetails, Settings, About, Onboarding
│       └─ components/
├─ tests/
│   ├─ fixtures/               zapisane odpowiedzi TMDB/Torznab/OpenSubtitles, nazwy wydań, małe pliki testowe
│   └─ smoke/app.spec.ts       Playwright Electron
└─ docs/
```

Testy jednostkowe leżą obok kodu jako `*.test.ts`.

## IPC (preload API)

Preload wystawia jeden obiekt `window.adrenaline` z funkcjami (nie surowe `ipcRenderer`). Każdy kanał ma schemat Zod wejścia i wyjścia w `src/shared/contracts/ipc.ts`. Handler w main: sprawdza `event.senderFrame.url` (tylko własny renderer), waliduje wejście, zwraca `{ ok: true, data } | { ok: false, error: { code, message } }`.

| Grupa | Metody | Uwagi |
|---|---|---|
| `catalog` | `search(query, type?)`, `details(type, tmdbId)`, `season(tmdbId, seasonNumber)` | |
| `releases` | `startSearch(target) → sessionId`, `cancelSearch(sessionId)`, zdarzenie `releases:update` | wyniki strumieniowane |
| `downloads` | `create(input)`, `list()`, `get(jobId)`, `selectFiles(jobId, indices)`, `pause`, `resume`, `remove(jobId, deleteFiles)`, `openFolder(jobId)`, `retrySubtitles(jobId)`, `chooseSubtitleCandidate(jobId, taskId, candidateId)`, zdarzenie `downloads:progress` (co 500 ms, paczka zmian) | |
| `settings` | `get()`, `update(patch)`, `chooseFolder()`, `testTmdb()`, `testOpenSubtitles()`, `setSecret(name, value)`, `hasSecret(name)` | sekrety tylko zapisywane, nigdy odczytywane do renderera |
| `sources` | `list()`, `setEnabled(id, enabled)`, `test(id)`, `addCustomTorznab(input)`, `remove(id)` | |
| `app` | `version()`, `checkForUpdates()`, `installUpdate()`, zdarzenie `updater:status`, `openLogsFolder()`, `diagnostics()` | |

Zdarzenia: main → `webContents.send(channel, payload)`; preload wystawia `onX(callback) → unsubscribe`.

## Model danych (SQLite)

Migracje w `src/main/persistence/migrations/NNN_nazwa.sql`, wersja w `PRAGMA user_version`. `PRAGMA journal_mode=WAL`, `foreign_keys=ON`. Jedyny zapisujący: main.

| Tabela | Kolumny (najważniejsze) |
|---|---|
| `settings` | `key TEXT PK`, `value_json TEXT` |
| `secrets` | `name TEXT PK`, `ciphertext BLOB` (safeStorage) |
| `sources` | `id TEXT PK`, `kind ('jackett_builtin'|'torznab_custom')`, `name`, `endpoint`, `indexer_id`, `enabled`, `api_key_secret`, `health ('unknown'|'ok'|'error')`, `health_message`, `checked_at` |
| `media_items` | `id INTEGER PK`, `type ('movie'|'tv')`, `tmdb_id`, `imdb_id`, `title`, `original_title`, `year`, `poster_path`, UNIQUE(`type`,`tmdb_id`) |
| `episodes` | `id`, `media_item_id FK`, `season`, `episode`, `tmdb_episode_id`, `title` |
| `download_jobs` | `id TEXT PK (UUID)`, `media_item_id`, `episode_id NULL`, `release_json` (znormalizowane wydanie i źródła), `source_kind ('magnet'|'torrent')`, `magnet`, `torrent_blob BLOB NULL`, `info_hash_v1`, `info_hash_v2`, `save_dir`, `state`, `error_code`, `error_message`, `seed_ratio_limit`, `seed_time_limit_min`, `subtitle_lang`, `subtitle_fallback_lang`, `created_at`, `updated_at`, `completed_at`. UNIQUE na (`info_hash_v1`) i (`info_hash_v2`) dla aktywnych zadań (BR07). |
| `download_files` | `job_id FK`, `file_index`, `rel_path`, `size`, `selected`, `done_bytes`, `episode_id NULL` |
| `subtitle_tasks` | `id`, `job_id FK`, `file_index`, `lang`, `state`, `candidate_json`, `candidates_json`, `match_confidence`, `target_path`, `error_code`, `quota_reset_at` |
| `cache` | `key PK`, `value_json`, `expires_at` (TMDB, Torznab caps) |

Postęp transferu (bajty, prędkość) nie jest zapisywany przy każdym odświeżeniu: `done_bytes` zapisywane co 30 s i przy zmianie stanu.

## Stany

### DownloadJob.state

```
queued → fetching_metadata → awaiting_file_selection → downloading ⇄ paused
                           ↘ (jednoznaczny wybór) ↗        ↓
                                              checking → downloaded → seeding → stopped
dowolny aktywny → error (z error_code; wznowienie wraca do poprzedniego etapu)
dowolny → removed (rekord zostaje do sprzątnięcia, pliki tylko przy jawnym deleteFiles)
```

Dozwolone przejścia są zdefiniowane jako tabela w `src/shared/domain/job-state.ts` i mają testy jednostkowe. `paused` ma podpowód: `user`, `disk_full`, `disk_missing`, `engine_restart`.

### SubtitleTask.state

`disabled`, `pending`, `searching`, `needs_selection`, `downloading`, `ready`, `not_found`, `quota_exceeded`, `error`.

### Gotowość (BR02)

`ready = wszystkie wybrane pliki zweryfikowane && wszystkie napisy w stanie ready lub disabled`. Status w UI wyliczany funkcją `deriveJobStatus(job, files, subtitleTasks)` w `shared/domain` (testowana): `Gotowe`, `Film gotowy — napisy wymagają uwagi`, `Pobieranie`, `Wstrzymane`, `Błąd`… Seedowanie jest pokazywane obok, nie zamiast.

## Kody błędów

`src/shared/errors.ts` definiuje enum `AppErrorCode` (stabilne stringi, np. `TMDB_UNAUTHORIZED`, `TMDB_UNAVAILABLE`, `SOURCE_TIMEOUT`, `SOURCE_BAD_RESPONSE`, `ALL_SOURCES_FAILED`, `ENGINE_CRASHED`, `ENGINE_PROTOCOL_MISMATCH`, `DISK_FULL`, `DISK_MISSING`, `PATH_NOT_WRITABLE`, `PATH_CONFLICT`, `METADATA_TIMEOUT`, `NO_PEERS`, `SUBS_NOT_FOUND`, `SUBS_QUOTA`, `SUBS_AUTH`, `FILE_MISSING`, `DUPLICATE_JOB`…). Każdy kod ma polski komunikat i sugerowaną akcję w `i18n/pl.ts` (`errors.<CODE>.message`, `errors.<CODE>.action`). NFR09.

## Bezpieczeństwo plików (NFR06)

`src/main/fs/safe-path.ts`:
- `resolveInside(baseDir, relPath)`: normalizuje, odrzuca ścieżki absolutne, `..`, nazwy zastrzeżone Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1–9`, `LPT1–9`), znaki `<>:"|?*` i kontrolne, końcowe kropki/spacje; wynik musi zaczynać się od `baseDir`.
- `sanitizeFileName(name)` do budowy katalogów z tytułów.
- Długość ścieżki: ostrzeżenie powyżej 240 znaków (bez wymagania LongPathsEnabled).
- Sprawdzenie, że katalog docelowy nie jest symlinkiem/junction (`fs.lstat`).
- Silnik dostaje `save_path` = katalog zadania; libtorrent sam sanityzuje ścieżki z torrenta, ale main dodatkowo weryfikuje `rel_path` każdego pliku po metadanych.
- Żaden plik z torrenta nie jest uruchamiany; `openFolder` używa `shell.showItemInFolder` / `shell.openPath` tylko na katalogu.
