# Etap 6 — Pobieranie: konfiguracja, kolejka, wybór plików, postęp, pauza, restart, dysk, seedowanie

**Cel:** pełny, odporny cykl pobrania od kliknięcia „Pobierz” do „Gotowe”, który przetrwa restart, awarię procesu, brak miejsca i odłączenie dysku (FR07–FR13, FR19–FR21, BR02–BR07, NFR01–NFR05, NFR11).

**Wymaga:** etapy 2, 3, 5.

## Zadania

### 6.1 Domena zadań (`src/shared/domain/`)
- `job-state.ts`: tabela dozwolonych przejść (`01-architektura.md`), funkcja `transition(job, event) → job | error`. Testy wszystkich przejść i odrzuceń.
- `job-status.ts`: `deriveJobStatus(job, files, subtitleTasks)` (BR02) — testy dla: gotowe, film gotowy + napisy wymagają uwagi, napisy wyłączone, seedowanie po gotowości, pauza z powodu dysku.
- `file-selection.ts`: z listy plików torrenta wybiera domyślny plik: dla filmu największy plik wideo (`mkv|mp4|avi|m4v|ts|webm`) bez `sample`/`trailer`/`extras` w ścieżce; dla odcinka plik wideo pasujący do `SxxEyy` celu. Nigdy nie wybiera `exe|bat|cmd|msi|scr|lnk|ps1|vbs|js|com` ani archiwów (FR09). Zwraca `{ selected, ambiguous: boolean, candidates }` — `ambiguous` gdy ≥ 2 pliki wideo o rozmiarze > 50% największego albo brak dopasowania odcinka.
- `job-folder.ts`: ścieżka zadania wg D-75, z `sanitizeFileName`.

### 6.2 Konfiguracja pobrania (UI `/download-setup`)
- Dane: wybrane wydanie, `SearchTarget`, domyślne ustawienia.
- Pola: folder (domyślny + „Zmień…”), napisy (Bez napisów / język + opcjonalny fallback), polityka seedowania (domyślna z ustawień, edytowalna), wybór plików (jeśli metadane już znane z `.torrent`; dla magnetu: „Lista plików zostanie pobrana po rozpoczęciu”).
- Sprawdzenia przed startem (FR07, BR07): zapis w folderze, wolne miejsce ≥ rozmiar wydania + 1% (jeśli rozmiar znany; inaczej ostrzeżenie), długość ścieżki, konflikt: katalog zadania istnieje i nie jest pusty → wybór „Użyj innej nazwy (… (2))” albo „Wybierz inny folder”; brak cichego nadpisania. Duplikat (ten sam infohash w aktywnym zadaniu) → komunikat i przejście do istniejącego zadania (`DUPLICATE_JOB`).
- „Pobierz” wyłączone podczas tworzenia zadania (brak podwójnego kliknięcia).

### 6.3 Serwis pobrań (`src/main/services/download-service.ts`)
- `create(input)`: pobranie `.torrent` przez Torznab (jeśli `link` to plik, max 10 MB) albo magnet; zapis zadania w DB (`queued`), następnie kolejka.
- Kolejka: maks. `maxActiveDownloads` zadań w stanach `fetching_metadata|downloading|checking`; reszta `queued`. Seedujące nie zajmują slotu.
- Obsługa zdarzeń silnika: `metadata` → zapis `download_files`, weryfikacja `rel_path` przez `safe-path` (niebezpieczna ścieżka → `error` `UNSAFE_TORRENT_PATH`), ponowne sprawdzenie miejsca na dysku, automatyczny wybór plików albo stan `awaiting_file_selection` (UI pyta użytkownika). `progress` → bufor w pamięci + emisja `downloads:progress` co 500 ms; zapis `done_bytes` co 30 s. `fileCompleted` → uruchomienie napisów dla tego pliku (etap 7). `state` → przejścia w DB.
- Metadane magnetu: timeout 10 min bez metadanych → stan pozostaje `fetching_metadata` z komunikatem „Nadal szukam peerów z listą plików” i akcjami Anuluj/Ponów (nie błąd krytyczny).
- Brak peerów: brak ETA, komunikat „Oczekiwanie na peerów”; żadnej automatycznej zmiany torrenta (BR04).
- Pauza (FR11): `pause` → oczekiwanie na potwierdzenie silnika → stan `paused` w DB dopiero po potwierdzeniu. Wznowienie zachowuje dane.
- Usuwanie (FR13): domyślnie bez plików. Opcja „Usuń także pobrane pliki” z potwierdzeniem pokazującym listę plików zadania; usuwa tylko pliki zadania (przez silnik) i napisy utworzone przez Adrenaline, potem pusty katalog zadania.
- Seedowanie (FR19, BR06): po `downloaded` zadanie przechodzi do `seeding` z polityką (`setSeedPolicy`); `stopped` po limicie. UI pokazuje wysyłanie.
- Dysk (NFR05): `DISK_FULL` → `paused(disk_full)` z wymaganym/dostępnym miejscem i przyciskiem „Ponów”; `DISK_MISSING` → `paused(disk_missing)`; sprawdzanie co 30 s, czy dysk wrócił (bez automatycznego wznowienia, tylko informacja).
- Otwieranie folderu (FR21): `shell.showItemInFolder(plik)`; brak pliku/dysku → `FILE_MISSING` z opcją „Sprawdź ponownie” (recheck).

### 6.4 Odtwarzanie po restarcie i awarii (FR12, NFR04)
- Start aplikacji: wczytaj z DB zadania nie-`removed`; po `hello` dodaj do silnika aktywne i spauzowane (z `paused` zgodnie ze stanem), zachowując `jobId`, folder, wybór plików i opcje napisów.
- Brak/uszkodzony plik resume → silnik robi recheck; brak katalogu danych → `FILE_MISSING`.
- Awaria silnika w trakcie: UI pokazuje „Silnik pobierania uruchamia się ponownie” i dane jako nieaktualne (NFR02); po restarcie odtworzenie jak wyżej.
- Test: skrypt `scripts/dev/crash-loop.mjs` (lokalny, na fake lub prawdziwym silniku) wykonujący 20 cykli dodaj → pobieraj → `kill` aplikacji/silnika → start, sprawdzający brak utraty zadań (NFR04). Wynik zapisany w `STATUS.md`.

### 6.5 UI
- **Pobrane** (`/downloads`): sekcje Aktywne / Zakończone; wiersz: tytuł (+SxxEyy), nazwa wydania, etap (Pobieranie metadanych / Oczekiwanie na wybór plików / Pobieranie / Sprawdzanie / Wstrzymane / Seedowanie / Gotowe / Błąd), pasek postępu z procentem i bajtami „1,2 GB z 4,8 GB”, prędkość ↓/↑, peery, ETA lub „nieznany”, status napisów osobno, akcje: Pauza/Wznów, Otwórz folder, Więcej (Usuń, Szczegóły). Aktualizacja co 500 ms bez przerysowania całej listy.
- **Wybór plików** (dialog przy `awaiting_file_selection`): lista plików z rozmiarami, domyślnie zaznaczony kandydat, inne wideo widoczne, pliki wykonywalne oznaczone i nie do zaznaczenia domyślnie.
- **Szczegóły zadania** (`/downloads/:jobId`): pliki z postępem, źródła wydania, infohash (zwinięte „Szczegóły techniczne”), polityka seedowania, stan napisów (etap 7), przyczyna błędu z kodem i akcją.
- Zasobnik: „Wstrzymaj wszystko / Wznów wszystko”, tooltip z łączną prędkością.
- Ustawienia → Transfer i seedowanie: limity, maks. aktywnych pobrań, port, polityka seedowania (FR19).

### 6.6 Smoke i E2E w fake engine
- Smoke test z `03-testy.md` pkt 4 (zadanie → postęp → pauza → restart → zadanie na liście).

## Kryteria odbioru
- [ ] Testy jednostkowe: `job-state`, `job-status`, `file-selection` (paczka z próbką i `.exe`, paczka sezonu dla odcinka, niejednoznaczne), `job-folder`, serwis pobrań na `FakeEngine` (kolejka 3 sloty, duplikat, pauza po potwierdzeniu, usunięcie bez plików, DISK_FULL → pauza, restart odtwarza zadania).
- [ ] Smoke test z restartem przechodzi.
- [ ] Ręczny test na prawdziwym silniku w kontenerze (lokalny seeder z testu swarm + aplikacja z `ADRENALINE_NO_JACKETT=1` i ukrytym trybem dev „dodaj magnet”): pobranie wybranego pliku, pauza, zamknięcie aplikacji, ponowne uruchomienie, wznowienie i ukończenie.
- [ ] 20 cykli crash-loop bez utraty zadań (NFR04).
- [ ] Pomiar pamięci dla 1 i 3 pobrań zapisany w `STATUS.md` (NFR11).
- [ ] Wydanie `v0.6.0`.

## Poza zakresem
Napisy (etap 7), pełne sezony, przenoszenie zadań między dyskami, import magnet/.torrent przez użytkownika.
