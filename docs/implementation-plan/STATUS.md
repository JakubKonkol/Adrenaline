# Status implementacji

Agent aktualizuje ten plik po każdym zamkniętym zadaniu (checkbox + krótka notatka, jeśli coś odbiega od planu). Zadania odpowiadają numeracji w `etapy/`.

**Bieżący etap:** 0
**Ostatnie wydanie:** brak

## Blokady wymagające właściciela

- [x] Wybór źródła aktualizacji (D-07): upublicznienie `Adrenaline`, Releases w tym samym repo (decyzja 15.10.2026).
- [ ] Zmiana widoczności repo `JakubKonkol/Adrenaline` na publiczną. Potrzebne przed etapem 1.4.
- [ ] Klucz TMDB i konto/klucz OpenSubtitles w `.env` do testów live (etapy 4 i 7).

## Etapy

### Etap 0 — Szkielet
- [x] 0.1 Inicjalizacja projektu
- [x] 0.2 electron-vite + TypeScript
- [x] 0.3 Minimalna aplikacja
- [x] 0.4 Skrypty npm
- [x] 0.5 Testy (Vitest, smoke)
- [ ] 0.6 CI
- [ ] 0.7 Pętla dev w kontenerze, `docs/dev-setup.md`

### Etap 1 — Release i autoupdate
- [ ] 1.1 electron-builder
- [ ] 1.2 Updater
- [ ] 1.3 Skrypty i workflow
- [ ] 1.4 Wydania v0.1.0 i v0.1.1

### Etap 2 — Silnik
- [ ] 2.1 Budowanie C++
- [ ] 2.2 Implementacja silnika
- [ ] 2.3 Klient w Electron
- [ ] 2.4 Test swarm
- [ ] 2.5 Pakowanie i CI
- [ ] 2.6 Diagnostyka w UI

### Etap 3 — Rdzeń aplikacji
- [ ] 3.1 Baza
- [ ] 3.2 Ustawienia
- [ ] 3.3 Sekrety
- [ ] 3.4 IPC
- [ ] 3.5 Pliki i dysk
- [ ] 3.6 Nawigacja, Ustawienia, kreator
- [ ] 3.7 Okno i zasobnik
- [ ] 3.8 Logger

### Etap 4 — Katalog TMDB
- [ ] 4.1 Weryfikacja API, fixtures
- [ ] 4.2 Klient
- [ ] 4.3 Serwis i IPC
- [ ] 4.4 UI
- [ ] 4.5 SearchTarget

### Etap 5 — Źródła
- [ ] 5.1 Spike Jackett (decyzje D-56, D-57)
- [ ] 5.2 JackettManager
- [ ] 5.3 Adapter Torznab
- [ ] 5.4 Domena wydań
- [ ] 5.5 Serwis wyszukiwania
- [ ] 5.6 UI

### Etap 6 — Pobieranie
- [ ] 6.1 Domena zadań
- [ ] 6.2 Konfiguracja pobrania
- [ ] 6.3 Serwis pobrań
- [ ] 6.4 Restart i awaria (crash-loop 20 cykli)
- [ ] 6.5 UI
- [ ] 6.6 Smoke z restartem

### Etap 7 — Napisy
- [ ] 7.1 Weryfikacja API, fixtures
- [ ] 7.2 Hash
- [ ] 7.3 Klient
- [ ] 7.4 Pipeline
- [ ] 7.5 Ponowienie i ręczny wybór
- [ ] 7.6 UI

### Etap 8 — Beta
- [ ] 8.1 Sytuacje wyjątkowe
- [ ] 8.2 Dostępność i UX
- [ ] 8.3 O aplikacji i diagnostyka
- [ ] 8.4 Dokumentacja użytkownika
- [ ] 8.5 Instalator i aktualizacja (checklista ręczna)
- [ ] 8.6 Przegląd bezpieczeństwa
- [ ] 8.7 Wydanie beta v0.9.0

## Przypięte wersje

Uzupełnić w etapie 0 (i przy każdej zmianie).

| Składnik | Wersja |
|---|---|
| Electron | 44.7.2 |
| Node (w Electronie) | 24.21 (lokalnie Node 24.11) |
| React | 19.3.1 (react-router 8.4.0, TanStack Query 5.104.3) |
| TypeScript | 6.0.3 |
| electron-vite / Vite | 6.0.0 / 8.3.4 (`@vitejs/plugin-react` 6.1.2) |
| electron-builder / electron-updater | 26.15.3 / 6.8.9 |
| Zod / fast-xml-parser | 4.6.7 / 5.11.2 |
| Vitest / Playwright | 5.0.5 / 1.64.1 |
| ESLint / typescript-eslint / Prettier | 10.12.0 / 8.71.2 / 3.9.10 |
| vcpkg baseline | |
| libtorrent | |
| Jackett | |

## Odstępstwa od planu

- **Środowisko dev (etap 0.7):** pętla dev działa na Windows właściciela (Node 24.11), a silnik C++ budowany jest w WSL Ubuntu 26.04 (libtorrent 2.0.12 z apt, preset `linux-system`). Lokalnie brak MSVC/vcpkg; binarka Windows powstaje tylko w CI.
- **Wygląd (prośba właściciela 15.10.2026):** Adrenaline wizualnie należy do rodziny Oxytocin: te same neutralne kolory, typografia (Inter + JetBrains Mono, dołączone przez `@fontsource-variable/*`, bo CSP blokuje zewnętrzne fonty), etykiety mono uppercase, własny pasek tytułu 36 px (`titleBarStyle: hidden` + overlay). Akcent pomarańczowy z logo zamiast niebieskiego. Nadal CSS Modules + zmienne CSS bez Tailwinda (D-21).
- **Preload:** sandboxowany preload nie może ładować modułów npm, więc nazwy kanałów są w osobnym pliku bez Zod (`src/shared/contracts/channels.ts`), a schematy w `ipc.ts`.
- **Audyt npm:** `npm audit --omit=dev` = 0 podatności; ostrzeżenia dotyczą tylko narzędzi deweloperskich (electron-builder → app-builder-lib). Do przeglądu w etapie 8.6.

## Pomiary

Brak.
