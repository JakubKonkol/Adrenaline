# Kontynuacja — Claude, 16.10.2026 (sesja „1.0: TV + biblioteka”)

Zlecenie Jakuba: klienci Samsung Tizen i Android TV z instalacją z zakładki TV po IP, nowoczesne UI TV (Discover + Library), negocjacja odtwarzania w stylu Jellyfin (D-85, „BARDZO WAŻNE”), brak seedowania po pobraniu, zakładka Library w desktopie, audyt procesów po zamknięciu. **Pełny postęp, decyzje i następne kroki: [1.0-adrenaline-tv/STATUS.md](1.0-adrenaline-tv/STATUS.md).** Wersja nadal 0.9.0, nic nie wydano.

---

# Kontynuacja — Claude, 15/16.10.2026 (sesja „dokończenie + napisy opcjonalne + angielski”)

Zlecenie Jakuba (15.10.2026 wieczorem):
1. Dokończyć implementację, wszystkie testy zielone, przygotować release (Jakub odpali release rano, jeśli agent nie ma uprawnień).
2. Napisy opcjonalne: przy starcie pobierania pytamy o napisy; można je potem pominąć/wyłączyć albo dociągnąć później. Błąd z v0.7.0: bez konta OpenSubtitles zadanie wisiało na „oczekiwaniu na napisy” i nie kończyło się.
3. Aplikacja, README i wszystko, co widzi użytkownik lub osoba klonująca repo — po angielsku (docs implementacyjne mogą zostać po polsku). README ze zrzutami ekranu.

Gałąź robocza sesji: `claude/finish-implementation-readme-e3hepr` (narzucona przez środowisko; do scalenia na `main`).

Plan i postęp (aktualizowane na bieżąco):
- [x] Engine CI na `d89d97a` padł na Windows (timeout „download complete” w teście paczki; kolejne testy z tym samym seederem przeszły, krok licencji vcpkg przeszedł). Lokalnie (Ubuntu 24.04, libtorrent 2.0.10) swarm 4/4 w 10 przebiegach. Seeder dostał stały port (na wypadek ponownego otwarcia gniazd), a timeout wypisuje stan leechera i port seedera — przyczyna nadal niepotwierdzona (`74bf422`).
- [x] UI po angielsku (`en.ts`, błędy, nazwy języków, formatowanie, zasobnik, TMDB `en-US`, foldery `Season NN`, instalator `en_US`), decyzja D-77 (`0b00b33`).
- [x] Napisy opcjonalne: przełącznik w konfiguracji pobrania (domyślnie wł. tylko z kontem OpenSubtitles), „Skip subtitles” (lista + szczegóły), „Get subtitles” (szczegóły), D-78; testy serwisu, domeny, komponentu i smoke (`b9e59ce`).
- [x] README po angielsku + zrzuty (`scripts/dev/readme-screenshots.mjs`), `docs/user-guide.md`, `docs/dev-setup.md`, README fixtures i komunikaty skryptów live po angielsku (`29cec0a`, `9423bad`).
- [x] Licencje npm bez pliku LICENSE → tekst MIT; mapa wymagań z kolumną Status; STATUS i manual-tests zaktualizowane.
- [ ] Odbiory ręczne Jakuba i wydanie v0.9.0 (poniżej).

### Co zostało — dla Jakuba (rano)

1. Scalić gałąź na `main` (fast-forward, gałąź wychodzi z `d89d97a`):
   ```bash
   git fetch origin
   git checkout main && git pull
   git merge --ff-only origin/claude/finish-implementation-readme-e3hepr
   git push origin main
   ```
   Push na `main` uruchomi CI i Engine CI (Windows). Warto poczekać na zielone Engine CI (swarm) przed tagiem.
2. Wydanie bety: `npm version 0.9.0 -m "Release v%s"` → `git push origin main --follow-tags`. Workflow Release opisze v0.9.0 jako betę. Jeśli swarm na Windows znów padnie: „Re-run failed jobs” w runie Release (log pokaże stan leechera).
3. Odbiory z `docs/manual-tests.md` (instalacja/aktualizacja z v0.7.0, odinstalowanie, dyski, OpenSubtitles live, punkt 8 — napisy opcjonalne bez konta).

Uwaga przy aktualizacji z ≤ v0.7.0: zapisane ustawienia zostają; jeśli język napisów nigdy nie był zmieniany, nowa wartość domyślna to angielski (D-77). Cache katalogu TMDB jest w nowym kluczu `en-US`, więc tytuły pobiorą się ponownie po angielsku.

Środowisko w kontenerze: Node 24 przez `/opt/nvm` (`source /opt/nvm/nvm.sh && nvm use 24`), `npm ci`, `node node_modules/electron/install.js` jeśli brak `dist`. Silnik: `apt-get install libtorrent-rasterbar-dev nlohmann-json3-dev cmake ninja-build`, potem preset `linux-system`. Swarm wymaga `LANG=C.UTF-8` (polska nazwa pliku) i `ADRENALINE_SKIP_BIG=1` w kontenerze.

---

# Kontynuacja — Codex, 15.10.2026

Źródło statusu punktów: [implementation-plan/STATUS.md](implementation-plan/STATUS.md).

- Przejęcie po Claude: HEAD `059cc8c`, v0.6.0, dwa nieśledzone katalogi OpenSubtitles. Zachowano i dokończono jego hash, klienta i fixtures.
- Release v0.6.0 **opublikowany**, workflow `38786238007` zielony (aplikacja, Windows engine/swarm, instalator). Starszy błąd wznowienia w swarmie poprawiony już przez Claude w `6e3f2b0`; nie wyłączono żadnego testu.
- 7.2–7.6: klient, SQLite/pipeline, ranking, bezpieczne pliki, retry/wybór/język i UI gotowe w kodzie. Szczegóły odstępstw w STATUS (archiwa w pamięci, zapis NTFS/FAT, ostatnie dozwolone pobranie przy remaining=0).
- Końcowy `npm.cmd run check`: **342 zaliczone, 3 pominięte**; build i rozszerzony smoke WSL/xvfb: 1/1. Brak uruchamiania okien na pulpicie właściciela.
- Naprawiono kolejność zamykania: SQLite dopiero po serwisach i silniku.
- 7.1 live pozostaje otwarte: brak danych konta OpenSubtitles. Skrypt `node scripts/live/opensubtitles.mjs` domyślnie nie zużywa limitu pobrań; wyniki w ignorowanym folderze `tests/fixtures/opensubtitles/live`. Plik `.env` nie jest źródłem konfiguracji uruchomionej aplikacji — konto wpisuje się w Ustawieniach.
- Etap 7 wypchnięty jako `2f05349`; wersja `0.7.0` w `0cf9e0d`. CI obu commitów zielone. Release v0.7.0: [38789174329](https://github.com/JakubKonkol/Adrenaline/actions/runs/38789174329) — test aplikacji i silnik/swarm zakończone sukcesem; przy ostatnim sprawdzeniu trwało pakowanie. Publikację trzeba potwierdzić osobno.
- Etap 8: tabela wyjątków, diagnostyka i instrukcja gotowe. Diagnostyka nie kopiuje tytułów, ścieżek, adresów ani sekretów; schowek obsługiwany w main. Dokumenty `/guide` i `/licenses` działają offline. Zestawienie npm zawiera teksty wskazane przez skaner; dla `@nodable/entities` i `lazy-val` pakiety dostarczają README zamiast osobnego LICENSE — zweryfikować upstream w końcowym audycie. Nowy krok Engine CI zbiera copyright bibliotek vcpkg, a Release dołącza je do instalatora.
- Dostępność: poprawione kolory o niskim kontraście, aria-live, skip-link. Rozszerzony istniejący smoke przeszedł w WSL: katalog → syntetyczne źródło → wydanie → pobranie → folder, dokumenty, diagnostyka, restart. NFR01 przy 3 pobraniach: p95 52,7 ms / 20 próbek. Pozostaje pełny test Tab/czytnika i Windows.
- Workflow Release pozwala ponowić pakowanie istniejącego draftu i sprawdza instalator/blockmap/metadane przed publikacją. Nie ponawia publikacji istniejącego publicznego wydania. Ta zmiana oraz zbieranie licencji wymagają nowego zielonego CI.
- Rozdzielono `tsconfig.smoke.json`, żeby typy DOM testów Playwright nie zmieniały typów `fetch` w testach main.
- Nie potwierdzono czystego Windows/Sandbox ani aktualizacji przez baner. Repo nadal prywatne; widoczności nie zmieniano. **v0.9.0 nie wydano**. Zakończenie pracy na prośbę właściciela.

## Następne kroki dla Claude’a

1. Sprawdzić wynik Release v0.7.0 oraz CI najnowszego main (zwłaszcza ścieżkę `native/engine/build/windows-release/vcpkg_installed/x64-windows-static/share` i artefakt `engine-licenses`). Jeśli nowy Engine CI zawiedzie, poprawić zbieranie licencji; nie wyłączać swarmu.
2. Konto OpenSubtitles: test skryptem i rzeczywistą aplikacją na legalnym materiale. Brak konta nie oznacza zaliczenia 7.1. Sprawdzić dostawcę również po błędnym logowaniu i zmianie danych.
3. Dokończyć 8.2/8.6 oraz odbiory `docs/manual-tests.md`; zaktualizować `05-mapa-wymagan.md` na podstawie dowodów. Zweryfikować dwa fallbacki README w licencjach npm. Nie wpisywać „zaliczone” przy próbach właściciela bez jego relacji.
4. Dopiero po ocenie otwartych punktów przygotować `v0.9.0` przez `npm version` + push taga. Na teraz najbardziej sprawdzony pełny instalator to v0.6.0; v0.7.0 dodaje nieprzetestowanego live dostawcę napisów.

Walidacja GUI wyłącznie WSL + xvfb (życzenie właściciela). Kopia robocza testów: `/root/adrenaline-codex-validation/project`, node_modules z `/root/adrenaline/node_modules`. `npm.cmd` na Windows. Sekretów nie wyświetlać ani nie commitować.
