# Kontynuacja — Codex, 15.10.2026

Źródło statusu punktów: [implementation-plan/STATUS.md](implementation-plan/STATUS.md).

- Przejęcie po Claude: HEAD `059cc8c`, v0.6.0, dwa nieśledzone katalogi OpenSubtitles. Zachowano i dokończono jego hash, klienta i fixtures.
- Release v0.6.0 **opublikowany**, workflow `38786238007` zielony (aplikacja, Windows engine/swarm, instalator). Starszy błąd wznowienia w swarmie poprawiony już przez Claude w `6e3f2b0`; nie wyłączono żadnego testu.
- 7.2–7.6: klient, SQLite/pipeline, ranking, bezpieczne pliki, retry/wybór/język i UI gotowe w kodzie. Szczegóły odstępstw w STATUS (archiwa w pamięci, zapis NTFS/FAT, ostatnie dozwolone pobranie przy remaining=0).
- `npm.cmd run check`: 341 zaliczonych, 3 pominięte; build i smoke WSL/xvfb: 1/1. Brak uruchamiania okien na pulpicie właściciela.
- Naprawiono kolejność zamykania: SQLite dopiero po serwisach i silniku.
- 7.1 live pozostaje otwarte: brak danych konta OpenSubtitles. Skrypt `node scripts/live/opensubtitles.mjs` domyślnie nie zużywa limitu pobrań; wyniki w ignorowanym folderze `tests/fixtures/opensubtitles/live`. Plik `.env` nie jest źródłem konfiguracji uruchomionej aplikacji — konto wpisuje się w Ustawieniach.
- Trwa etap 8. Nie potwierdzono czystego Windows/Sandbox ani aktualizacji przez baner. Repo nadal prywatne; widoczności nie zmieniano.
