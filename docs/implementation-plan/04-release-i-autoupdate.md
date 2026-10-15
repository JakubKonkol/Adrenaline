# Release i autoupdate

Prosty model (D-04, D-05, D-07): wersja w `package.json` → tag `vX.Y.Z` na `main` → workflow `release.yml` uruchamia testy → jeśli przejdą, buduje silnik, pobiera Jackett, pakuje instalator NSIS i publikuje GitHub Release z plikami dla `electron-updater`. Zainstalowane aplikacje same znajdują nową wersję.

## Jak wydać nową wersję (procedura dla agenta i właściciela)

```bash
git checkout main && git pull
npm run check                       # musi przejść lokalnie
npm version patch -m "Release v%s"  # albo minor / major / prerelease --preid beta
git push origin main --follow-tags
```

`npm version` zmienia `package.json` i `package-lock.json`, robi commit i tag `vX.Y.Z`. Push taga uruchamia workflow. Nie tworzyć ręcznie Release w UI GitHub: robi to electron-builder.

## Jednorazowa konfiguracja (właściciel)

1. Zmienić widoczność repo `JakubKonkol/Adrenaline` na publiczną (D-07) przed pierwszym wydaniem. Bez tego aplikacja nie pobierze aktualizacji.
2. Nic więcej: workflow publikuje wbudowanym `GITHUB_TOKEN`, nie trzeba tworzyć tokenów ani sekretów.

Jeśli repo jest jeszcze prywatne, workflow i tak opublikuje Release (w prywatnym repo), ale autoupdate u użytkowników nie zadziała; agent zapisuje to w `STATUS.md` jako blokadę dla właściciela.

## `electron-builder.yml`

```yaml
appId: com.jakubkonkol.adrenaline
productName: Adrenaline
copyright: Copyright © 2026 Jakub Konkol
directories:
  output: dist
  buildResources: build
files:
  - out/**
  - package.json
asar: true
extraResources:
  - from: resources/engine/adrenaline-engine.exe
    to: engine/adrenaline-engine.exe
  - from: vendor/jackett
    to: jackett
    filter: ['**/*']
  - from: resources/licenses
    to: licenses
win:
  target:
    - target: nsis
      arch: [x64]
  icon: build/icon.ico
nsis:
  oneClick: false
  perMachine: false                 # instalacja w %LOCALAPPDATA%\Programs, aktualizacje bez UAC
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  deleteAppDataOnUninstall: false   # D-74: nie usuwamy danych ani filmów
  artifactName: Adrenaline-Setup-${version}.exe
publish:
  provider: github
  owner: JakubKonkol
  repo: Adrenaline
  releaseType: release
```

Uwagi:
- `resources/engine/` i `vendor/jackett/` są w `.gitignore`; wypełnia je workflow (silnik z artefaktu, Jackett ze skryptu `scripts/fetch-jackett.mjs`).
- `resources/licenses/` (w repo): `THIRD_PARTY_NOTICES.md` z licencjami Electron, libtorrent (BSD-3), Boost (BSL-1.0), OpenSSL (Apache-2.0), nlohmann-json (MIT), Jackett (GPL-2.0, z linkiem do źródeł konkretnej wersji) i zależności npm (generowane `npx license-checker-rseidelsohn --production --markdown` w etapie 8).
- Proces Jackett i silnik nie zapisują nic do katalogu instalacji (aktualizacja podmienia ten katalog).

## `scripts/fetch-jackett.mjs`

1. Czyta wersję z `scripts/jackett-version.txt` (np. `v0.24.2798`) i oczekiwany SHA-256 z `scripts/jackett-sha256.txt`.
2. Pobiera `https://github.com/Jackett/Jackett/releases/download/<wersja>/Jackett.Binaries.Windows.zip` do katalogu tymczasowego.
3. Weryfikuje SHA-256 (przy pierwszym pobraniu nowej wersji agent wpisuje hash do pliku i commituje).
4. Rozpakowuje do `vendor/jackett/` (archiwum zawiera katalog `Jackett/`, spłaszczyć go), usuwa `JackettUpdater.exe` i pliki serwisu Windows, jeśli są.
5. Działa również na Linuksie (do pakowania testowego), używając `extract-zip` (devDependency).

## Workflow `.github/workflows/ci.yml`

Na każdy push do `main` (bez tagów): lint, typecheck, testy, smoke.

```yaml
name: CI
on:
  push:
    branches: [main]
    paths-ignore: ['docs/**', '**/*.md']
  workflow_dispatch:
permissions:
  contents: read
jobs:
  test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run check
      - run: npm run build
      - run: npm run test:smoke
```

## Workflow `.github/workflows/engine-ci.yml`

Buduje i testuje silnik tylko, gdy zmienia się `native/**`.

```yaml
name: Engine
on:
  push:
    branches: [main]
    paths: ['native/**', '.github/workflows/engine-ci.yml']
  workflow_dispatch:
permissions:
  contents: read
jobs:
  engine:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ilammy/msvc-dev-cmd@v1
      - uses: lukka/get-cmake@latest
      - uses: lukka/run-vcpkg@v11
        with:
          vcpkgGitCommitId: <ten sam commit co builtin-baseline w native/engine/vcpkg.json>
          vcpkgJsonGlob: native/engine/vcpkg.json
      - run: cmake --preset windows-release
        working-directory: native/engine
      - run: cmake --build --preset windows-release
        working-directory: native/engine
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run test:engine
        env:
          ADRENALINE_ENGINE_PATH: native/engine/build/windows-release/adrenaline-engine.exe
      - uses: actions/upload-artifact@v4
        with:
          name: adrenaline-engine
          path: native/engine/build/windows-release/adrenaline-engine.exe
```

`lukka/run-vcpkg` sam cache'uje skompilowane paczki (pierwsza budowa Boost + OpenSSL + libtorrent trwa długo, kolejne kilka minut). Jeśli to się okaże zawodne, zapas: `actions/cache` na `VCPKG_DEFAULT_BINARY_CACHE` z kluczem `hashFiles('native/engine/vcpkg.json')`.

## Workflow `.github/workflows/release.yml`

```yaml
name: Release
on:
  push:
    tags: ['v*.*.*']
permissions:
  contents: write   # electron-builder tworzy Release w tym repo
concurrency:
  group: release
  cancel-in-progress: false
jobs:
  test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: node scripts/check-version-tag.mjs "${{ github.ref_name }}"
      - run: npm run check
      - run: npm run build
      - run: npm run test:smoke

  engine:
    runs-on: windows-latest
    steps:
      # te same kroki co w engine-ci.yml (checkout, msvc, cmake, vcpkg, build, test:engine, upload-artifact)

  package:
    needs: [test, engine]
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - uses: actions/download-artifact@v4
        with:
          name: adrenaline-engine
          path: resources/engine
      - run: node scripts/fetch-jackett.mjs
      - run: npm run build
      - name: Package and publish
        shell: bash
        run: |
          if [[ "${GITHUB_REF_NAME}" == *-* ]]; then TYPE=prerelease; else TYPE=release; fi
          npx electron-builder --win --x64 --publish always -c.publish.releaseType=$TYPE
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Wynik: Release `vX.Y.Z` w `JakubKonkol/Adrenaline` z plikami `Adrenaline-Setup-X.Y.Z.exe`, `Adrenaline-Setup-X.Y.Z.exe.blockmap`, `latest.yml`. Wersje z myślnikiem (`1.0.0-beta.1`) idą jako prerelease.

Do etapu 2 (zanim powstanie silnik) workflow release nie ma joba `engine`, a `extraResources` silnika i Jackett są dodawane w etapach 2 i 5. Etap 1 dostarcza wersję workflow bez nich.

## Autoupdate w aplikacji (`src/main/updater.ts`)

```ts
import { autoUpdater } from 'electron-updater'

export function initUpdater(deps: { send: (s: UpdaterStatus) => void; settings: SettingsService; log: Logger }) {
  if (!app.isPackaged) return            // w dev wyłączone; do testów: dev-app-update.yml + forceDevUpdateConfig
  autoUpdater.logger = deps.log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = deps.settings.get().betaUpdates
  autoUpdater.on('checking-for-update', () => deps.send({ state: 'checking' }))
  autoUpdater.on('update-available', (i) => deps.send({ state: 'downloading', version: i.version }))
  autoUpdater.on('update-not-available', () => deps.send({ state: 'idle' }))
  autoUpdater.on('download-progress', (p) => deps.send({ state: 'downloading', percent: p.percent }))
  autoUpdater.on('update-downloaded', (i) => deps.send({ state: 'ready', version: i.version }))
  autoUpdater.on('error', (e) => deps.send({ state: 'error', message: redact(e.message) }))
  setTimeout(() => autoUpdater.checkForUpdates(), 10_000)
  setInterval(() => autoUpdater.checkForUpdates(), 6 * 60 * 60 * 1000)
}

export async function installUpdateNow(shutdown: () => Promise<void>) {
  await shutdown()                        // pauza kolejki, engine.shutdown (zapis resume), stop Jackett, zamknięcie DB
  autoUpdater.quitAndInstall(false, true) // instalator z UI postępu, potem uruchom aplikację
}
```

- UI: baner na górze okna „Dostępna wersja X. Uruchom ponownie, aby zaktualizować” + przycisk; w „O aplikacji” ręczne „Sprawdź aktualizacje” i stan.
- `before-quit` (także przy `autoInstallOnAppQuit`) zawsze przechodzi przez ten sam `shutdown()`; `event.preventDefault()` do czasu jego zakończenia (maks. 15 s).
- Aktualizacja nie kasuje `userData`, więc kolejka i resume przetrwają (NFR10).
- Single-instance lock (`app.requestSingleInstanceLock()`): drugie uruchomienie pokazuje istniejące okno.

## `scripts/check-version-tag.mjs`

Porównuje `process.argv[2]` (np. `v0.3.1`) z `"v" + package.json.version`; przy niezgodności kończy się kodem 1 z komunikatem. Chroni przed wydaniem z błędną wersją w `latest.yml`.
