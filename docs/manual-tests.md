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
