# Testy ręczne

Rzeczy, których nie da się sensownie zautomatyzować (03-testy.md). Wynik wpisuje właściciel albo agent na podstawie relacji właściciela do `docs/implementation-plan/STATUS.md`.

## Jackett na czystym Windows (etap 5.1, D-51/D-56)

Cel: potwierdzić, że dołączony Jackett działa na systemie **bez .NET** i **bez uprawnień administratora**.

1. Włącz Windows Sandbox (Funkcje systemu Windows → „Piaskownica systemu Windows”) i uruchom go.
2. W Sandbox zainstaluj Node 24 (instalator `.msi` z nodejs.org) — to jedyny dodatek, potrzebny tylko do skryptu testowego.
3. Skopiuj do Sandbox folder repozytorium z katalogami `scripts/` i `vendor/jackett/` (po `node scripts/fetch-jackett.mjs` na swoim komputerze). `node_modules` nie są potrzebne.
4. W Sandbox otwórz **zwykły** wiersz polecenia (nie „Uruchom jako administrator”) w folderze repozytorium i wpisz:
   ```
   node scripts\jackett-spike.mjs
   ```
5. Oczekiwany wynik: `13/13 checks passed`, w tym „starts without --Port/admin”, „listens on 127.0.0.1 only” i linia `.NET: 9.0.x (…\vendor\jackett\)` (runtime z folderu Jackett, nie z systemu).

Wynik z 15.10.2026: komputer właściciela bez uprawnień administratora — 13/13. Sandbox: **do potwierdzenia przez Jakuba**.

## Aktualizacja (etap 1.4)

1. Pobierz `Adrenaline-Setup-0.1.0.exe` z GitHub Releases i zainstaluj (SmartScreen: „Więcej informacji” → „Uruchom mimo to”).
2. Uruchom aplikację, odczekaj ok. 10 s. Gdy dostępna jest nowsza wersja, u góry okna pojawia się baner „Dostępna jest wersja …”.
3. Kliknij „Uruchom ponownie i zaktualizuj”. Aplikacja zamyka się, instalator aktualizuje ją i uruchamia ponownie.
4. „O aplikacji” pokazuje nową wersję.

Wymaga publicznego repozytorium (D-07). Wynik: **do potwierdzenia przez Jakuba**.

## Beta — odbiór na czystym Windows (8.5)

Status wszystkich poniższych prób: **nie wykonano**. v0.9.0 jeszcze nie wydano; użyć aktualnego instalatora kandydującego do bety.

1. Czysta instalacja bez dodatkowego .NET/klienta torrent → kreator → pełny scenariusz z legalnym materiałem → film i napisy obok niego.
2. W poprzedniej wersji utworzyć dwa zadania (aktywne i spauzowane), zaktualizować przez baner. Potwierdzić zachowanie stanów, plików i ustawień.
3. Odinstalować. Potwierdzić, że filmy, napisy i profil użytkownika zostały zachowane.
4. Wybrać folder bez uprawnień zapisu; sprawdzić polski błąd i możliwość zmiany folderu.
5. Zapełnić testowy VHD 1 GB podczas pobierania; sprawdzić pauzę i wznowienie po zwolnieniu miejsca.
6. Odłączyć testowy pendrive podczas pobierania; podłączyć pod tą samą ścieżką i wznowić.
7. Powtórzyć zapis w ścieżce z polskimi znakami; przetestować także sidecary na FAT/exFAT (wyłączność zapisu, brak nadpisania).
8. Wpisać konto OpenSubtitles w Ustawieniach; sprawdzić limity, wylogowanie, zapis rzeczywistych napisów, ręczny wybór i ponowienie bez restartu filmu. Nie wykonywać celowo serii pobrań zużywających limit.

## Sytuacje wyjątkowe — wymagania §10 (8.1)

| Sytuacja | Kod / stan | Akcja w interfejsie | Dowód / próba |
|---|---|---|---|
| TMDB niedostępne | TMDB_UNAVAILABLE | Ponów; pobrania pozostają dostępne | tmdb-client.test.ts, Catalog.test.tsx |
| Jedno źródło nie odpowiada | SOURCE_TIMEOUT / SOURCE_UNAVAILABLE | Wyniki częściowe, odśwież / sprawdź źródło | release-search-service.test.ts |
| Wszystkie źródła niedostępne | ALL_SOURCES_FAILED | Odśwież, Ustawienia → Źródła | release-search-service.test.ts |
| Magnet bez metadanych | fetching_metadata / METADATA_TIMEOUT | Usuń lub wznów zadanie | download-service.test.ts, swarm |
| Brak peerów | peers=0, ETA nieznane | Poczekaj, wstrzymaj lub usuń | job-status.test.ts, UI; ręczny swarm bez seedera do odbioru |
| Za mało miejsca | DISK_FULL / paused_disk_full | Zwolnij miejsce, wznów | download-service.test.ts; VHD powyżej nie wykonano |
| Niedopasowane napisy | needs_selection | Wybierz innego kandydata | subtitle-ranking.test.ts, subtitle-service.test.ts |
| Limit napisów | SUBS_QUOTA / quota_exceeded | Film dostępny; data resetu, ponów po resecie | opensubtitles-client.test.ts, subtitle-service.test.ts |
| Plik usunięty poza aplikacją | FILE_MISSING | Sprawdź pliki / ponów; film nie jest podmieniany | download-service.test.ts; ręczny odbiór nie wykonano |
| Awaria silnika | ENGINE_CRASHED / restarting | UI działa; restart silnika lub wznowienie | engine-process.test.ts, crash-loop 20/20 opisany w STATUS |
| Konflikt nazwy | PATH_CONFLICT / DUPLICATE_JOB | Nowy katalog / numerowana nazwa, bez nadpisania | fs.test.ts, download-service.test.ts, subtitle-service.test.ts |

## Dostępność i bezpieczeństwo — stan przeglądu

- Smoke WSL/xvfb: aktywacja klawiaturą wyboru wydania, startu pobrania, otwarcia folderu, diagnostyki i dokumentów. Pełne przejście kolejności Tab i test czytnikiem ekranu pozostają do odbioru.
- NFR01: 3 aktywne zadania FakeEngine, 20 próbek kliknięcie → zmiana stanu → dwie klatki; p95 **52,7 ms** (15.10.2026). Próba w istniejącym smoke, załącznik `ui-response.json`.
- Paleta po poprawkach: minimalny kontrast badanych tekstów/statusów na podstawowych powierzchniach 5,62:1 (ciemny), 5,15:1 (jasny). Nie zastępuje pełnego audytu WCAG wszystkich kombinacji.
- `npm audit --omit=dev` 15.10.2026: **0 podatności**.
- Przejrzano izolację renderera/CSP/walidację IPC, allowlistę hostów OpenSubtitles, limit archiwów i ochronę ścieżek. Diagnostyka testowana na danych z sekretami/URL: wyłącznie wersje, liczniki i znane kody błędów.
- Otwarte 8.6: końcowy przegląd całej listy z architektury, logów z rzeczywistego konta i nasłuchów na czystym Windows. Licencje natywne zbierane przez nowy krok Engine CI — wynik tego kroku trzeba potwierdzić.
