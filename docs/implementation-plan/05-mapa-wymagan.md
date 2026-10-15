# Mapa wymagań → etapy → testy

Identyfikatory z `docs/requirements/wymagania-biznesowe.md`. Kolumnę „Status” uzupełnia agent w etapie 8 (`zaliczone`, `odstępstwo: <powód>`, `po MVP`). Stan na 16.10.2026 (Claude): „auto” = test automatyczny w `npm run check`/smoke/swarm; próby ręczne właściciela pozostają otwarte, dopóki Jakub ich nie potwierdzi.

## Wymagania funkcjonalne

| ID | Wymaganie | Etap | Weryfikacja | Status |
|---|---|---|---|---|
| FR01 | Identyfikacja filmu i serialu | 4 | kontrakt TMDB + przypadek remake (fixture) | zaliczone (auto: kontrakt TMDB + remake 1968/1990; live 15.10.2026) |
| FR02 | Wybór odcinka | 4, 5 | `SearchTarget`, ostrzeżenie „inny sezon” w `match.ts` | zaliczone (auto: `release-domain.test.ts`, Catalog.test, smoke) |
| FR03 | Wiele źródeł | 5 | test serwisu z 1 źródłem w błędzie + ręczny live ≥ 3 źródła | zaliczone (auto + live 15.10.2026: 3/5 źródeł, częściowe wyniki) |
| FR04 | Deduplikacja | 5 | `dedupe.test.ts` | zaliczone (auto: `release-domain.test.ts`, scalanie po info hash) |
| FR05 | Porównanie wydań | 5 | `release-parser.test.ts` + UI „nieznane” | zaliczone (auto: parser 48 nazw, UI „unknown”) |
| FR06 | Filtry i sortowanie | 5 | test sortowania/filtrów | zaliczone (auto: sortowanie/filtry w `release-domain.test.ts`) |
| FR07 | Katalog zapisu | 3, 6 | `checkWritable`, test `PATH_NOT_WRITABLE` | zaliczone (auto: `fs.test.ts`, preflight) |
| FR08 | Wbudowany silnik | 2, 8 | test czystej maszyny (ręczny) | **otwarte** — czysty Windows/Sandbox do potwierdzenia przez właściciela (8.5) |
| FR09 | Wybór plików | 6 | `file-selection.test.ts` | zaliczone (auto: `jobs-domain.test.ts`) |
| FR10 | Postęp wybranych plików | 2, 6 | test swarm + smoke | zaliczone (auto: swarm + smoke) |
| FR11 | Pauza i wznowienie | 2, 6 | test swarm (brak przyrostu bajtów) + serwis | zaliczone (auto: swarm, serwis, smoke) |
| FR12 | Restart i awaria | 2, 6 | test swarm (kill), smoke z restartem, crash-loop | zaliczone (auto: swarm kill, smoke z restartem, crash-loop 20/20) |
| FR13 | Usuwanie | 6 | test serwisu (bez plików / z plikami zadania) | zaliczone (auto: `download-service.test.ts`) |
| FR14 | Język napisów i fallback | 7 | test pipeline | zaliczone w kodzie (auto: pipeline); live OpenSubtitles otwarte (7.1); napisy opcjonalne per pobranie (D-78) |
| FR15 | Pobranie napisów obok wideo | 7 | test nazw + ręczny live | zaliczone w kodzie (auto: nazwy/sidecar); live otwarte (7.1) |
| FR16 | Brak/błąd napisów, ponowienie | 7 | test „retry bez komend silnika” | zaliczone (auto: retry bez silnika, pomijanie/dociąganie D-78) |
| FR17 | Ręczny wybór kandydata | 7 | test `needs_selection` | zaliczone (auto: `needs_selection`) |
| FR18 | Konfiguracja źródeł | 5 | test `jackett-admin` na fake HTTP + ręczny | zaliczone (auto: Jackett admin na fake HTTP + live 15.10.2026) |
| FR19 | Limity i seedowanie | 2, 6 | test swarm `setSeedPolicy` + serwis | zaliczone (auto: swarm `setSeedPolicy` + serwis) |
| FR20 | Zamknięcie do zasobnika / Zakończ | 3 | smoke (proces kończy się) | zaliczone (auto: smoke — zamknięcie < 15 s) |
| FR21 | Otwieranie folderu | 6 | test `FILE_MISSING` | zaliczone (auto: `FILE_MISSING`, smoke „Open folder”) |
| FR22 | Konta dostawców | 7 | test 401 → relogin → `SUBS_AUTH` | zaliczone w kodzie (auto: 401 → relogin → `SUBS_AUTH`); live otwarte (7.1) |
| FR23 | Pełny sezon (S) | po MVP | — | po MVP |
| FR24 | Import ręczny (S) | po MVP | — | po MVP |

## Reguły biznesowe

| ID | Etap | Gdzie |
|---|---|---|
| BR01 jakości osobno | 5 | `release-parser`, kolumny UI |
| BR02 kompletność | 6, 7 | `deriveJobStatus` |
| BR03 częściowy sukces | 7 | pipeline napisów |
| BR04 brak podmiany wydania | 6, 7 | brak automatycznej zmiany torrenta/języka (test) |
| BR05 prywatność | 3, 8 | logger z redakcją, diagnostyka bez danych |
| BR06 seedowanie | 6 | polityka D-70, UI wysyłania |
| BR07 duplikaty i konflikty | 6, 7 | `DUPLICATE_JOB`, konflikt nazw |
| BR08 wiarygodność statusu | 5, 6 | stany źródeł, ETA nieznane, seedy z datą |

## Wymagania niefunkcjonalne

| ID | Etap | Weryfikacja | Status |
|---|---|---|---|
| NFR01 responsywność | 8 | pomiar przy 3 pobraniach (fake engine) | zaliczone (p95 52,7–56,9 ms, WSL/xvfb, 3 pobrania); pomiar na Windows otwarty |
| NFR02 postęp 500 ms | 2, 6 | protokół + UI „brak aktualnych danych” przy restarcie silnika | zaliczone (auto: protokół, UI „out of date”) |
| NFR03 wyniki < 1 s | 5 | emisja po każdej odpowiedzi źródła | zaliczone (live: pierwsze wyniki po 1. źródle, sesja 3,5 s) |
| NFR04 trwałość 20 cykli | 6 | crash-loop | zaliczone (crash-loop 20/20, Windows + FakeEngine) |
| NFR05 dysk | 2, 6 | `DISK_FULL`/`DISK_MISSING` → pauza (test + ręczny) | zaliczone auto (pauza `DISK_FULL`/`DISK_MISSING`); próby ręczne (VHD, pendrive) otwarte |
| NFR06 bezpieczeństwo ścieżek | 3, 6 | `safe-path.test.ts`, brak uruchamiania plików | zaliczone (auto: `safe-path.test.ts`, archiwa napisów) |
| NFR07 izolacja | 0, 3, 5 | smoke (brak Node w rendererze), Jackett na loopback | zaliczone (smoke: brak Node w rendererze; Jackett tylko 127.0.0.1 — spike/netstat) |
| NFR08 dostępność | 3, 8 | przegląd klawiatura/etykiety | częściowo: kontrast, aria-live, skip-link, klawiatura w smoke; pełny przegląd Tab/czytnika otwarty |
| NFR09 utrzymanie | wszystkie | stabilne `AppErrorCode`, adaptery oddzielone od UI | zaliczone (stabilne kody, test „message + action dla każdego kodu”) |
| NFR10 instalacja/aktualizacja | 1, 8 | checklista ręczna | **otwarte** — checklista 8.5 dla właściciela |
| NFR11 zasoby | 6 | pomiar pamięci 1 i 3 pobrań | zaliczone (working set ≤ 512 MiB, 3 × 256 MiB) |
| NFR12 język/Unicode | 2, 3 | testy ścieżek z polskimi znakami, UI po polsku | zaliczone (polskie znaki w ścieżkach: swarm/fs); UI po angielsku od D-77 |
