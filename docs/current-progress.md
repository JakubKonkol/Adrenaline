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
