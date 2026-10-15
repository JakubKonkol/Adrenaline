# CLAUDE.md — Adrenaline

Adrenaline to aplikacja desktopowa na Windows (Electron + React + TypeScript): wyszukanie filmu/odcinka (TMDB) → wyszukanie wydań w wielu źródłach (Torznab przez dołączony Jackett) → pobranie wbudowanym silnikiem (helper C++ na libtorrent) → napisy (OpenSubtitles) zapisane obok wideo. Właściciel: Jakub Konkol. Komunikacja z właścicielem po polsku.

## Plan

- **Plan implementacji:** [`docs/implementation-plan/README.md`](docs/implementation-plan/README.md). Zacznij tam; realizuj etapy po kolei (`docs/implementation-plan/etapy/`).
- **Postęp:** [`docs/implementation-plan/STATUS.md`](docs/implementation-plan/STATUS.md). Aktualizuj po każdym zamkniętym zadaniu.
- **Decyzje:** [`docs/implementation-plan/00-decyzje.md`](docs/implementation-plan/00-decyzje.md). Nie zmieniaj decyzji po cichu: dopisz nowy wpis z datą i powodem.
- **Wymagania źródłowe:** `docs/requirements/` (biznesowe i research techniczny). Przy rozbieżności wygrywa plan.

## Zasady pracy

1. **Gałąź:** pracuj bezpośrednio na `main`. Nie twórz innych gałęzi ani PR-ów, chyba że Jakub o to poprosi.
2. **Autor commitów:** Jakub Konkol. Przed pierwszym commitem w sesji:
   ```bash
   git config user.name "Jakub Konkol"
   git config user.email "91895624+JakubKonkol@users.noreply.github.com"
   ```
   Commituj małymi, logicznymi krokami z opisowym komunikatem (np. `engine: add pause with confirmation`). Push na `origin main`.
3. **Przed każdym commitem** `npm run check` (lint + typecheck + testy) musi przejść. Nie commituj czerwonego `main`.
4. **Tylko Windows x64.** Nie dodawaj targetów, workflowów ani kodu pakowania dla macOS/Linux. Kod jest przenośny tylko po to, żeby dało się go rozwijać i testować w kontenerze Linux.
5. **Testy proste:** Vitest (jednostkowe i kontraktowe na fixtures), jeden test integracyjny silnika na lokalnym swarmie, jeden smoke test Playwright Electron. Bez testów live w CI, bez rozbudowanej infrastruktury E2E. Testy nie łączą się z internetem.
6. **Release:** tylko przez GitHub Actions. `npm version <patch|minor|major> -m "Release v%s"` → `git push origin main --follow-tags`. Workflow `release.yml` uruchamia testy, a gdy przejdą, buduje silnik, pobiera Jackett, pakuje instalator NSIS i publikuje GitHub Release. Nie publikuj ręcznie. Szczegóły: `docs/implementation-plan/04-release-i-autoupdate.md`.
7. **Autoupdate:** `electron-updater` z providerem GitHub. Aplikacja nie może zawierać żadnego tokena GitHub.
8. **Sekrety:** nigdy w repo ani w logach. Klucze do testów live w `.env` (w `.gitignore`); w aplikacji przez `safeStorage`.
9. **Treści:** testy i fixtures tylko z własnych danych lub materiałów dopuszczonych do dystrybucji.

## Komendy

```bash
npm ci                 # instalacja
npm run dev            # aplikacja w trybie dev (ADRENALINE_FAKE_ENGINE=1 bez zbudowanego silnika)
npm run check          # lint + typecheck + testy
npm run build          # build electron-vite do out/
npm run test:smoke     # Playwright Electron (na Linuksie: xvfb-run -a npm run test:smoke)
npm run test:engine    # test swarm silnika (wymaga ADRENALINE_ENGINE_PATH)
npm run pack:win       # lokalny instalator bez publikacji
```

Silnik C++ (`native/engine`): `cmake --preset linux-system && cmake --build --preset linux-system` w kontenerze, `windows-release` w CI.

## Architektura w skrócie

- `src/shared` — domena i kontrakty (Zod), bez importów Electron/Node.
- `src/main` — lifecycle, IPC z walidacją, serwisy, providery HTTP, `node:sqlite`, klient silnika, menedżer Jackett, updater.
- `src/preload` — wąskie API `window.adrenaline` przez `contextBridge`.
- `src/renderer` — React, bez dostępu do Node, sekretów i systemu plików. Teksty UI przez `t()` — po angielsku (D-77); wszystko, co widzi użytkownik lub osoba klonująca repo, po angielsku.
- `native/engine` — `adrenaline-engine` (libtorrent), protokół JSON Lines po stdin/stdout (`docs/implementation-plan/02-protokol-silnika.md`).

Bezpieczeństwo renderera (`contextIsolation`, `sandbox`, brak `nodeIntegration`, CSP) i walidacja ścieżek (`src/main/fs/safe-path.ts`) są obowiązkowe; nie osłabiaj ich, żeby coś „zadziałało”.
