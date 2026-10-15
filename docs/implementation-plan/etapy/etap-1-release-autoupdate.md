# Etap 1 — Instalator, release workflow i autoupdate

**Cel:** od tego momentu każda wersja jest wydawana tak, jak docelowo: tag → testy → instalator → GitHub Release → aplikacja sama się aktualizuje.

**Wymaga:** etap 0. Do działania autoupdate: publiczne repo `Adrenaline` (D-07; zmienia właściciel). Publikacja używa `GITHUB_TOKEN`, bez dodatkowych sekretów.

## Zadania

### 1.1 electron-builder
- `electron-builder.yml` jak w `04-release-i-autoupdate.md`, **na razie bez** `extraResources` silnika i Jackett (dochodzą w etapach 2 i 5; `resources/licenses` już teraz z plikiem `THIRD_PARTY_NOTICES.md` w wersji wstępnej).
- `npm run pack:win` buduje instalator lokalnie. W kontenerze Linux electron-builder potrafi zbudować NSIS (pobiera własne narzędzia); jeśli wymaga `wine`, pomiń lokalne pakowanie i polegaj na CI.

### 1.2 Updater
- `src/main/updater.ts` jak w `04-release-i-autoupdate.md`. Na tym etapie `shutdown()` to pusta funkcja async; w kolejnych etapach rośnie (silnik, Jackett, DB).
- IPC: `app:checkForUpdates`, `app:installUpdate`, zdarzenie `updater:status`. Preload i typy.
- Renderer: komponent `UpdateBanner` (stan `ready` → przycisk „Uruchom ponownie i zaktualizuj”), prosty ekran „O aplikacji” z wersją, stanem aktualizacji i przyciskiem „Sprawdź aktualizacje”.
- Ustawienie `betaUpdates` na razie jako stała `false` (Ustawienia w etapie 3).

### 1.3 Skrypty i workflow
- `scripts/check-version-tag.mjs` + test jednostkowy logiki porównania.
- `.github/workflows/release.yml` w wersji bez joba `engine` i bez `fetch-jackett` (zostaw komentarz `# etap 2: engine`, `# etap 5: jackett`).

### 1.4 Pierwsze wydania
- `npm version 0.1.0` (ustaw dokładnie), push z tagiem. Sprawdź przez GitHub MCP (`list_releases` na `JakubKonkol/Adrenaline` albo `actions_list`/`get_job_logs`), że workflow przeszedł i Release ma `Adrenaline-Setup-0.1.0.exe`, `.blockmap`, `latest.yml`.
- Wprowadź widoczną drobną zmianę (np. tekst w „O aplikacji”), wydaj `0.1.1`.
- Jeśli repo jest jeszcze prywatne: wydania i tak powstaną, ale test autoupdate czeka na upublicznienie; zapisz blokadę w `STATUS.md` i przejdź dalej (etap 2 nie zależy od publikacji).

## Kryteria odbioru
- [ ] Push taga uruchamia testy, a job `package` ma `needs: [test]`, więc czerwone testy blokują publikację. Nie wydawaj celowo zepsutych wersji, żeby to sprawdzić.
- [ ] Release `v0.1.0` i `v0.1.1` istnieją z kompletem plików.
- [ ] Test ręczny właściciela (dopisany do `STATUS.md` jako „do potwierdzenia przez Jakuba”): zainstaluj `0.1.0` na Windows, uruchom, po chwili pojawia się baner aktualizacji do `0.1.1`, po kliknięciu aplikacja restartuje się w `0.1.1`.
- [ ] Niezgodny tag z `package.json` zatrzymuje workflow (test jednostkowy skryptu).

## Poza zakresem
Podpisywanie kodu (D-08), kanały poza stable/beta, delta updates poza tym, co daje blockmap.
