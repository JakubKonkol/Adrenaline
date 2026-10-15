# Etap 0 — Szkielet repozytorium, narzędzia i CI

**Cel:** pusta, bezpiecznie skonfigurowana aplikacja Electron + React + TS, która startuje, ma lint, typecheck, testy i smoke test, a CI na `windows-latest` jest zielone.

**Wymaga:** nic (repo zawiera tylko `docs/` i `CLAUDE.md`).

## Zadania

### 0.1 Inicjalizacja projektu
- `package.json`: `"name": "adrenaline"`, `"productName": "Adrenaline"`, `"version": "0.0.1"`, `"private": true`, `"main": "out/main/index.js"`, `"author": "Jakub Konkol"`, `"engines": { "node": ">=24" }`.
- Zainstaluj zależności z dokładnymi wersjami (D-10…D-20). Sprawdź `npm view <pkg> version` i peer-dependencies; jeśli coś jest niekompatybilne, wybierz najnowszą zgodną wersję i zapisz w `STATUS.md`.
  - runtime: `react`, `react-dom`, `react-router`, `@tanstack/react-query`, `zod`, `electron-updater`, `fast-xml-parser`
  - dev: `electron`, `electron-vite`, `vite`, `@vitejs/plugin-react`, `typescript@6.0.x`, `@types/node`, `@types/react`, `@types/react-dom`, `vitest`, `happy-dom`, `@testing-library/react`, `@playwright/test`, `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `prettier`, `electron-builder`, `extract-zip`
- `.gitignore`: `node_modules/`, `out/`, `dist/`, `resources/engine/`, `vendor/`, `native/engine/build/`, `.env`, `*.log`, `test-results/`, `playwright-report/`.
- `.env.example` z pustymi `TMDB_TOKEN=`, `OPENSUBTITLES_API_KEY=`, `OPENSUBTITLES_USERNAME=`, `OPENSUBTITLES_PASSWORD=`.
- `.nvmrc` z `24`.
- `.gitattributes`: `* text=auto eol=lf`, `*.ico binary`, `*.exe binary`.

### 0.2 Konfiguracja electron-vite i TypeScript
- `electron.vite.config.ts`: trzy wejścia (`src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`), alias `@shared` → `src/shared`. Preload budowany jako CommonJS (wymóg sandboxa).
- `tsconfig.json` (references), `tsconfig.node.json` (main, preload, shared, scripts, testy), `tsconfig.web.json` (renderer, shared, DOM). `strict: true`, `noUncheckedIndexedAccess: true`.
- `src/shared/` nie może importować `electron` ani modułów Node (reguła ESLint `no-restricted-imports` dla tego katalogu).

### 0.3 Minimalna aplikacja
- `src/main/index.ts`: single-instance lock, `BrowserWindow` 1200×800 (min 960×640), `webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }`, blokada nawigacji poza własny renderer (`will-navigate`, `setWindowOpenHandler` → `deny`, linki zewnętrzne `https:` przez `shell.openExternal` po walidacji), CSP przez `session.defaultSession.webRequest.onHeadersReceived` oraz `<meta>` w `index.html`.
- Zmienna `ADRENALINE_USER_DATA` (tylko gdy `!app.isPackaged` albo w testach) nadpisuje `app.setPath('userData', …)`.
- `src/preload/index.ts`: `contextBridge.exposeInMainWorld('adrenaline', { app: { version: () => ipcRenderer.invoke('app:version') } })` + typ `AdrenalineApi` w `src/shared/contracts/api.ts` i deklaracja `window.adrenaline` dla renderera.
- `src/renderer`: `App.tsx` z nagłówkiem „Adrenaline” i wersją aplikacji z `window.adrenaline.app.version()`. Słownik `i18n/pl.ts` + `t()` od początku (D-22).
- Ikona `build/icon.ico` (prosty placeholder 256×256 wygenerowany skryptem lub ręcznie; do podmiany przez właściciela).

### 0.4 Skrypty npm
```json
{
  "dev": "electron-vite dev",
  "build": "electron-vite build",
  "start": "electron-vite preview",
  "lint": "eslint .",
  "format": "prettier --write .",
  "typecheck": "tsc -b --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:smoke": "playwright test -c playwright.config.ts",
  "test:engine": "vitest run -c native/engine/tests/vitest.config.ts",
  "check": "npm run lint && npm run typecheck && npm run test",
  "pack:win": "npm run build && electron-builder --win --x64 --publish never"
}
```

### 0.5 Testy
- `vitest.config.ts`: środowisko `node` domyślnie, `happy-dom` dla `src/renderer/**`.
- Przykładowy test jednostkowy (`src/shared/version.test.ts` lub podobny), żeby `npm test` coś uruchamiał.
- `playwright.config.ts` + `tests/smoke/app.spec.ts`: uruchamia `out/main/index.js`, sprawdza tytuł okna i brak `window.process`/`window.require` w rendererze.

### 0.6 CI
- `.github/workflows/ci.yml` zgodnie z `04-release-i-autoupdate.md`.

### 0.7 Pętla dev w kontenerze Linux
- Sprawdź, że `npm run check`, `npm run build` i `xvfb-run -a npm run test:smoke` działają w kontenerze (zainstaluj `xvfb`, jeśli brak: `apt-get install -y xvfb`). Zapisz potrzebne kroki środowiska w `docs/dev-setup.md` (krótko: Node 24, npm ci, xvfb, opcjonalnie narzędzia C++ z etapu 2).

## Kryteria odbioru
- [ ] `npm ci && npm run check` przechodzi lokalnie (Linux) i w CI (Windows).
- [ ] `npm run build && npm run test:smoke` przechodzi w CI.
- [ ] Renderer nie ma dostępu do Node (test smoke).
- [ ] `src/shared` nie importuje Electron/Node (lint).
- [ ] Wersje zależności przypięte, `package-lock.json` w repo, tabela wersji w `STATUS.md` uzupełniona.

## Poza zakresem
Instalator, autoupdate, jakiekolwiek funkcje produktu.
