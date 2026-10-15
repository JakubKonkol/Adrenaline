# Etap 8 — Dopracowanie, sytuacje wyjątkowe, dostępność i wydanie beta

**Cel:** wszystkie wymagania M i NFR mają test albo jawnie zaakceptowane odstępstwo, podstawowy scenariusz działa na czystym Windows, wydanie beta `v0.9.0`.

**Wymaga:** etapy 0–7.

## Zadania

### 8.1 Sytuacje wyjątkowe (sekcja 10 wymagań)
Przejdź tabelę z `docs/requirements/wymagania-biznesowe.md` §10 i dla każdego wiersza upewnij się, że istnieje: kod błędu, polski komunikat, dalsza akcja w UI, test (jednostkowy lub w checkliście ręcznej). Wynik jako tabela w `docs/manual-tests.md`.

### 8.2 Dostępność i UX (NFR01, NFR08)
- Pełna ścieżka klawiaturą: wyszukaj → szczegóły → wydania → konfiguracja → Pobierz → Pobrane → Otwórz folder.
- `aria-live="polite"` dla postępu i statusów; etykiety dla ikon; kontrast AA.
- Brak blokujących animacji; pomiar reakcji UI przy 3 aktywnych pobraniach (fake engine z szybkim strumieniem zdarzeń): kliknięcie → zmiana stanu < 200 ms w 95% (NFR01). Zapisz wynik w `STATUS.md`.

### 8.3 O aplikacji i diagnostyka
- Wersje: aplikacja, Electron, silnik, libtorrent, Jackett.
- Licencje: wyświetlenie `THIRD_PARTY_NOTICES.md` (uzupełnione przez `license-checker-rseidelsohn --production`), atrybucja TMDB (logo + tekst), informacja o OpenSubtitles.
- „Kopiuj diagnostykę”: wersje, stan procesów, liczba zadań w stanach, ostatnie kody błędów — **bez** tytułów, magnetów, tokenów i pełnych ścieżek (BR05).
- Aktualizacje: stan, ręczne sprawdzenie, przełącznik „Wersje testowe”.

### 8.4 Dokumentacja użytkownika
- `docs/user-guide.md` (po polsku, krótko): pierwsze uruchomienie i klucze (TMDB, OpenSubtitles), źródła i ich ograniczenia, czym jest seedowanie i jak je ustawić, statusy napisów, co oznacza „Film gotowy — napisy wymagają uwagi”, gdzie są dane i logi, odinstalowanie. Link z „O aplikacji”.

### 8.5 Instalator i aktualizacja (NFR10)
- Checklista ręczna w `docs/manual-tests.md` dla właściciela (Windows Sandbox):
  1. Czysta instalacja `v0.9.0` → pierwsze uruchomienie → kreator → pełny scenariusz z legalnym materiałem.
  2. Instalacja poprzedniej wersji, dodanie 2 zadań (jedno w trakcie, jedno spauzowane) → aktualizacja przez baner → oba zadania wracają w tym samym stanie.
  3. Odinstalowanie → filmy i napisy zostają.
  4. Folder tylko do odczytu, mały dysk (VHD 1 GB) z brakiem miejsca, odłączenie pendrive’a w trakcie, ścieżka z polskimi znakami.
- Wpisy „zaliczone / niezaliczone / odstępstwo” właściciel lub agent (na podstawie relacji właściciela) wpisuje do `STATUS.md`.

### 8.6 Przegląd bezpieczeństwa
- Lista kontrolna z `01-architektura.md` i §11 planu technicznego: ustawienia `webPreferences`, CSP, walidacja IPC, brak `shell.openExternal` dla niezweryfikowanych URL, safe-path, limity XML/archiwów, Jackett tylko na loopback (sprawdź `netstat -ano` w spike/CI), brak sekretów w logach (grep logów po teście).
- `npm audit --omit=dev` bez krytycznych podatności (albo udokumentowane wyjątki).

### 8.7 Wydanie beta
- `npm version 0.9.0` → zwykły (stabilny) release oznaczony w opisie jako beta. Kanał prerelease (D-76) zostaje na później; dzięki temu wszyscy testerzy dostają aktualizacje bez przełączników.
- Uzupełnij `05-mapa-wymagan.md` kolumną „Status” (zaliczone / odstępstwo + powód).

## Kryteria odbioru (= definicja gotowości MVP)
- [ ] Wszystkie FR z priorytetem M i wszystkie NFR mają zaliczony test lub zaakceptowane przez właściciela odstępstwo (`05-mapa-wymagan.md`).
- [ ] Podstawowy scenariusz działa na czystym Windows bez dodatkowych programów (FR08) — potwierdzone przez właściciela.
- [ ] Dokumentacja użytkownika wyjaśnia źródła, konta, seedowanie i status napisów.
- [ ] `v0.9.0` (beta) opublikowane, autoupdate z poprzedniej wersji działa.
