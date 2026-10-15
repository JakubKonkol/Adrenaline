# Mapa wymagań → etapy → testy

Identyfikatory z `docs/requirements/wymagania-biznesowe.md`. Kolumnę „Status” uzupełnia agent w etapie 8 (`zaliczone`, `odstępstwo: <powód>`, `po MVP`).

## Wymagania funkcjonalne

| ID | Wymaganie | Etap | Weryfikacja | Status |
|---|---|---|---|---|
| FR01 | Identyfikacja filmu i serialu | 4 | kontrakt TMDB + przypadek remake (fixture) | |
| FR02 | Wybór odcinka | 4, 5 | `SearchTarget`, ostrzeżenie „inny sezon” w `match.ts` | |
| FR03 | Wiele źródeł | 5 | test serwisu z 1 źródłem w błędzie + ręczny live ≥ 3 źródła | |
| FR04 | Deduplikacja | 5 | `dedupe.test.ts` | |
| FR05 | Porównanie wydań | 5 | `release-parser.test.ts` + UI „nieznane” | |
| FR06 | Filtry i sortowanie | 5 | test sortowania/filtrów | |
| FR07 | Katalog zapisu | 3, 6 | `checkWritable`, test `PATH_NOT_WRITABLE` | |
| FR08 | Wbudowany silnik | 2, 8 | test czystej maszyny (ręczny) | |
| FR09 | Wybór plików | 6 | `file-selection.test.ts` | |
| FR10 | Postęp wybranych plików | 2, 6 | test swarm + smoke | |
| FR11 | Pauza i wznowienie | 2, 6 | test swarm (brak przyrostu bajtów) + serwis | |
| FR12 | Restart i awaria | 2, 6 | test swarm (kill), smoke z restartem, crash-loop | |
| FR13 | Usuwanie | 6 | test serwisu (bez plików / z plikami zadania) | |
| FR14 | Język napisów i fallback | 7 | test pipeline | |
| FR15 | Pobranie napisów obok wideo | 7 | test nazw + ręczny live | |
| FR16 | Brak/błąd napisów, ponowienie | 7 | test „retry bez komend silnika” | |
| FR17 | Ręczny wybór kandydata | 7 | test `needs_selection` | |
| FR18 | Konfiguracja źródeł | 5 | test `jackett-admin` na fake HTTP + ręczny | |
| FR19 | Limity i seedowanie | 2, 6 | test swarm `setSeedPolicy` + serwis | |
| FR20 | Zamknięcie do zasobnika / Zakończ | 3 | smoke (proces kończy się) | |
| FR21 | Otwieranie folderu | 6 | test `FILE_MISSING` | |
| FR22 | Konta dostawców | 7 | test 401 → relogin → `SUBS_AUTH` | |
| FR23 | Pełny sezon (S) | po MVP | — | |
| FR24 | Import ręczny (S) | po MVP | — | |

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
| NFR01 responsywność | 8 | pomiar przy 3 pobraniach (fake engine) | |
| NFR02 postęp 500 ms | 2, 6 | protokół + UI „brak aktualnych danych” przy restarcie silnika | |
| NFR03 wyniki < 1 s | 5 | emisja po każdej odpowiedzi źródła | |
| NFR04 trwałość 20 cykli | 6 | crash-loop | |
| NFR05 dysk | 2, 6 | `DISK_FULL`/`DISK_MISSING` → pauza (test + ręczny) | |
| NFR06 bezpieczeństwo ścieżek | 3, 6 | `safe-path.test.ts`, brak uruchamiania plików | |
| NFR07 izolacja | 0, 3, 5 | smoke (brak Node w rendererze), Jackett na loopback | |
| NFR08 dostępność | 3, 8 | przegląd klawiatura/etykiety | |
| NFR09 utrzymanie | wszystkie | stabilne `AppErrorCode`, adaptery oddzielone od UI | |
| NFR10 instalacja/aktualizacja | 1, 8 | checklista ręczna | |
| NFR11 zasoby | 6 | pomiar pamięci 1 i 3 pobrań | |
| NFR12 język/Unicode | 2, 3 | testy ścieżek z polskimi znakami, UI po polsku | |
