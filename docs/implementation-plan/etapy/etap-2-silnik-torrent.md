# Etap 2 — Silnik torrent (`adrenaline-engine`) i klient w Electron

**Cel:** potwierdzić najtrudniejszą część projektu. Natywny helper na libtorrent pobiera kontrolowany torrent, pauzuje go naprawdę, wznawia po zabiciu procesu i jest dołączony do instalatora.

**Wymaga:** etap 0 (etap 1 dla wydania, ale nie blokuje pracy).

Kontrakt: [`../02-protokol-silnika.md`](../02-protokol-silnika.md). Decyzje: D-40…D-43.

## Zadania

### 2.1 Budowanie C++
- `native/engine/vcpkg.json`:
  ```json
  {
    "name": "adrenaline-engine",
    "version-string": "0.0.0",
    "builtin-baseline": "<aktualny commit microsoft/vcpkg>",
    "dependencies": [
      { "name": "libtorrent", "default-features": false },
      "nlohmann-json"
    ]
  }
  ```
  Commit baseline: najnowszy z `master` vcpkg w dniu implementacji, zapisany też w workflow (`vcpkgGitCommitId`).
- `CMakeLists.txt`: C++17, `find_package(LibtorrentRasterbar CONFIG REQUIRED)`, `find_package(nlohmann_json CONFIG REQUIRED)`, cel `adrenaline-engine`, na MSVC statyczny CRT (`MSVC_RUNTIME_LIBRARY MultiThreaded`), `/W4`. Wersja silnika wstrzykiwana `-DADRENALINE_VERSION=` (z `package.json`, przekazywana przez workflow).
- `CMakePresets.json`: `windows-release` (generator Ninja, triplet `x64-windows-static`, toolchain `$env{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake`), `linux-dev` (vcpkg triplet `x64-linux`) i `linux-system` (bez vcpkg, systemowy `libtorrent-rasterbar-dev` + `nlohmann-json3-dev` z apt).
- W kontenerze Linux zacznij od `linux-system` (`apt-get install -y build-essential cmake ninja-build libtorrent-rasterbar-dev nlohmann-json3-dev`), bo budowa Boost przez vcpkg trwa długo. Kod musi kompilować się z libtorrent 2.0.10 i 2.1.x (D-41).

### 2.2 Implementacja silnika (`native/engine/src`)
- `main.cpp`: parsowanie argumentów (`--data-dir`, `--listen-port`, `--no-dht`, `--no-upnp`, `--test-mode`, `--make-torrent`), wątek czytający stdin (linia → kolejka), główna pętla: obsługa komend, `pop_alerts` (wait_for_alert 100 ms), timer 500 ms dla `progress`, timer 60 s dla resume.
- `protocol.{hpp,cpp}`: parsowanie/serializacja koperty, walidacja pól, cache 256 ostatnich odpowiedzi po `id` (idempotencja).
- `session.{hpp,cpp}`: konfiguracja `lt::session` (ustawienia z protokołu), wczytanie/zapis `session.state`.
- `jobs.{hpp,cpp}`: mapa `jobId → torrent_handle`, dodawanie (magnet/torrent bytes, `read_resume_data`, flagi bez `auto_managed`, `paused` wg argumentu), `selectFiles` (`prioritize_files`), pauza z oczekiwaniem na `torrent_paused_alert`, `remove`, `recheck`, polityka seedowania (sprawdzana w timerze), wyliczanie `JobStatus` z `status()` i `file_progress()`.
- `resume.{hpp,cpp}`: atomowy zapis (`.tmp` + flush + rename; na Windows `MoveFileExW` z `MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH`), zapis `.torrent` po metadanych (`write_torrent_file`).
- Mapowanie błędów (`file_error_alert`, `torrent_error_alert`) na kody z protokołu; przy `ENOSPC`/braku ścieżki: pauza + zdarzenie `state` z `reason`.
- `--make-torrent <src> --out <file> [--hybrid]`: tryb narzędziowy do testów.
- Ścieżki: UTF-8 w JSON; libtorrent na Windows przyjmuje UTF-8. Test z nazwą `Zażółć gęślą jaźń` i ścieżką z polskimi znakami (NFR12).

### 2.3 Klient w Electron (`src/main/engine/`)
- `src/shared/contracts/engine.ts`: schematy Zod wszystkich komunikatów i `JobStatus`.
- `engine-process.ts`, `engine-client.ts`, `fake-engine.ts`, `error-map.ts` zgodnie z `02-protokol-silnika.md`.
- Rozwiązywanie ścieżki binarki: `ADRENALINE_ENGINE_PATH` (dev/test) → `process.resourcesPath/engine/adrenaline-engine.exe` (spakowana) → `native/engine/build/<preset>/adrenaline-engine[.exe]` (dev).
- Testy jednostkowe klienta na `FakeEngine` i na „echo” strumieniach: timeout i ponowienie z tym samym `id`, luka w `seq` → `snapshot`, nieprawidłowa linia JSON → log i ignorowanie, niezgodny `protocol` → `ENGINE_PROTOCOL_MISMATCH`, restart z backoffem i limitem 3 awarii.

### 2.4 Test integracyjny (lokalny swarm)
- `native/engine/tests/swarm.test.ts` + `vitest.config.ts` wg [`../03-testy.md`](../03-testy.md). Uruchamiany przez `npm run test:engine` z `ADRENALINE_ENGINE_PATH`.

### 2.5 Pakowanie i CI
- `.github/workflows/engine-ci.yml` (z `04-release-i-autoupdate.md`).
- Do `release.yml` dołóż job `engine` i pobranie artefaktu w `package`; do `electron-builder.yml` dołóż `extraResources` silnika.
- Do `THIRD_PARTY_NOTICES.md` dopisz libtorrent (BSD-3-Clause), Boost (BSL-1.0), OpenSSL (Apache-2.0), nlohmann-json (MIT).
- Spike na Windows: po zbudowaniu w CI pobierz artefakt i sprawdź `dumpbin /dependents adrenaline-engine.exe` w kroku workflow (tylko DLL systemowe: `KERNEL32`, `WS2_32`, `ADVAPI32`, `CRYPT32`, `IPHLPAPI`, `BCRYPT`, `USER32` itp.). Wypisz wynik w logu joba.

### 2.6 Diagnostyka w UI (tymczasowo)
- W „O aplikacji”: wersja silnika i libtorrent z `hello`, stan procesu (działa / restartuje / awaria). Uruchamianie silnika przy starcie aplikacji i `shutdown` w `before-quit` (podpięte do wspólnej funkcji `shutdown()` z etapu 1).

## Kryteria odbioru
- [ ] `npm run test:engine` przechodzi w kontenerze Linux (preset `linux-system` lub `linux-dev`) i w `engine-ci.yml` na Windows.
- [ ] Test swarm potwierdza: wybór jednego pliku z paczki, postęp tylko wybranych plików, pauza bez przyrostu bajtów, wznowienie po `kill` bez pobierania od zera (pobrane bajty po restarcie ≥ 90% stanu sprzed zabicia, potem recheck), SHA-256 zgodny, magnet bez metadanych, recheck wykrywa uszkodzony fragment.
- [ ] Binarka Windows zależy tylko od systemowych DLL.
- [ ] Wydanie `v0.2.0` zawiera silnik w `resources/engine`, a „O aplikacji” pokazuje jego wersję po instalacji (test ręczny właściciela).
- [ ] Jeśli którykolwiek z powyższych punktów jest nieosiągalny w rozsądnym czasie: zapisz problem, rozważ plan zapasowy D-42 i dopisz decyzję w `00-decyzje.md` przed przejściem dalej.

## Poza zakresem
UI pobierania (etap 6), kolejka w main (etap 6), limity transferu w UI.
