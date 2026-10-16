# Adrenaline — plan implementacji

Plan kolejnej wersji **1.0.0 (Android TV i Samsung Tizen)**: [../1.0-andrenalive-tv/README.md](../1.0-andrenalive-tv/README.md). To osobny research i plan rozszerzenia po 0.9.0 (D-79), nie zadania wykonane w bieżącym MVP.

Ten katalog jest kompletną instrukcją dla agenta, który ma zbudować Adrenaline od pustego repozytorium do wydania beta. Polecenie „w tym katalogu masz plan, implementuj” oznacza: przeczytaj ten plik, potem pliki w kolejności poniżej, i realizuj etapy po kolei.

## Czym jest Adrenaline

Aplikacja desktopowa na **Windows x64** (Electron + React + TypeScript), która prowadzi użytkownika od wyszukania filmu lub odcinka (TMDB), przez wyszukanie wydań w wielu źródłach (Torznab przez dołączony Jackett), pobranie wybranego wydania wbudowanym silnikiem (własny helper C++ na libtorrent), aż do zapisania dopasowanych napisów (OpenSubtitles) obok pliku wideo. Aplikacja aktualizuje się sama z GitHub Releases.

Pełne wymagania: [`../requirements/wymagania-biznesowe.md`](../requirements/wymagania-biznesowe.md). Research techniczny: [`../requirements/plan-techniczny.md`](../requirements/plan-techniczny.md). Gdy te dokumenty różnią się od planu, **wygrywa plan** (patrz [`00-decyzje.md`](00-decyzje.md)).

## Kolejność czytania

| Plik | Zawartość |
|---|---|
| [`00-decyzje.md`](00-decyzje.md) | Wszystkie podjęte decyzje (zakres, technologie, wersje, domyślne ustawienia). Czytaj zawsze. |
| [`01-architektura.md`](01-architektura.md) | Struktura repo, procesy, moduły, IPC, model danych, stany. |
| [`02-protokol-silnika.md`](02-protokol-silnika.md) | Kontrakt JSON Lines między Electronem a `adrenaline-engine`. |
| [`03-testy.md`](03-testy.md) | Strategia testów (celowo prosta). |
| [`04-release-i-autoupdate.md`](04-release-i-autoupdate.md) | electron-builder, workflowy GitHub Actions, electron-updater, wersjonowanie. |
| [`etapy/`](etapy/) | Etapy 0–8 z zadaniami, plikami i kryteriami odbioru. |
| [`05-mapa-wymagan.md`](05-mapa-wymagan.md) | Mapowanie FR/NFR na etapy i testy. |
| [`STATUS.md`](STATUS.md) | Bieżący postęp. Agent aktualizuje go po każdym zadaniu. |

## Etapy

| Etap | Plik | Cel | Wynik |
|---|---|---|---|
| 0 | [`etapy/etap-0-szkielet.md`](etapy/etap-0-szkielet.md) | Szkielet repo, narzędzia, CI | Pusta aplikacja Electron startuje, testy i lint działają w CI |
| 1 | [`etapy/etap-1-release-autoupdate.md`](etapy/etap-1-release-autoupdate.md) | Instalator, release workflow, autoupdate | Tag `v0.1.0` produkuje instalator; `v0.1.1` aktualizuje zainstalowaną `v0.1.0` |
| 2 | [`etapy/etap-2-silnik-torrent.md`](etapy/etap-2-silnik-torrent.md) | Helper C++ na libtorrent + klient w main | Kontrolowany torrent pobrany, spauzowany, wznowiony po zabiciu procesu |
| 3 | [`etapy/etap-3-rdzen-aplikacji.md`](etapy/etap-3-rdzen-aplikacji.md) | SQLite, ustawienia, sekrety, IPC, nawigacja, zasobnik | Bezpieczny szkielet UI z trwałymi ustawieniami |
| 4 | [`etapy/etap-4-katalog-tmdb.md`](etapy/etap-4-katalog-tmdb.md) | Wyszukiwanie filmów/seriali, szczegóły, odcinki | Użytkownik wybiera film lub odcinek |
| 5 | [`etapy/etap-5-zrodla-jackett.md`](etapy/etap-5-zrodla-jackett.md) | Dołączony Jackett, Torznab, normalizacja, deduplikacja | Lista wydań z ≥3 źródeł z wynikami częściowymi |
| 6 | [`etapy/etap-6-pobieranie.md`](etapy/etap-6-pobieranie.md) | Kolejka, wybór plików, postęp, pauza, restart, dysk, seedowanie | Pełny cykl pobrania odporny na restart |
| 7 | [`etapy/etap-7-napisy.md`](etapy/etap-7-napisy.md) | OpenSubtitles, dopasowanie, zapis, ponowienie | Film z napisami i poprawny częściowy sukces |
| 8 | [`etapy/etap-8-dopracowanie-beta.md`](etapy/etap-8-dopracowanie-beta.md) | Błędy, dostępność, O aplikacji, smoke test, beta | Spełnione kryteria MVP, wydanie beta `v0.9.0` |

Etap 1 jest celowo wcześnie: od pierwszego tygodnia każda wersja jest instalowana i aktualizowana tak, jak zrobi to użytkownik. Kolejne etapy dokładają funkcje do działającego produktu.

## Zasady pracy agenta

1. **Jeden etap naraz, po kolei.** Nie zaczynaj etapu N+1, dopóki kryteria odbioru etapu N nie są spełnione albo odstępstwo nie jest zapisane w `STATUS.md` (sekcja „Odstępstwa”) z uzasadnieniem.
2. **Pracuj na `main`**, commituj małymi krokami jako Jakub Konkol (szczegóły w `/CLAUDE.md`). Każdy commit przechodzi `npm run check` (lint + typecheck + testy).
3. **Aktualizuj `STATUS.md`** po każdym zamkniętym zadaniu: zaznacz checkbox, dopisz krótką notatkę, jeśli coś odbiega od planu.
4. **Nie zmieniaj decyzji po cichu.** Jeśli decyzja z `00-decyzje.md` okaże się niewykonalna (np. pakowanie Jackett), opisz problem, wybierz rozwiązanie zapasowe wskazane w planie, dopisz nową decyzję `D-xx` ze statusem „zmieniona” i datą.
5. **Pętla dev w kontenerze Linux.** Agent zwykle pracuje w chmurowym kontenerze Linux. Aplikacja docelowo jest tylko na Windows, ale kod (TS i C++) jest przenośny, więc rozwój i testy jednostkowe/integracyjne działają na Linuksie. Binarka Windows silnika i instalator powstają w GitHub Actions na `windows-latest`. Nie dodawaj pakowania na Linux/macOS.
6. **Sekrety.** Klucze TMDB/OpenSubtitles do testów live czytane są z `.env` (nigdy commitowanego). Testy w CI nie wołają usług live.
7. **Treści.** Testy i fixtures używają wyłącznie własnych danych lub materiałów dopuszczonych do dystrybucji (np. własnoręcznie wygenerowane pliki, domena publiczna). Aplikacja służy do pobierania treści, do których użytkownik ma prawa.
8. **Gdy coś jest niejasne**, wybierz rozsądne rozwiązanie zgodne z dokumentem wymagań, zapisz je w `STATUS.md` i idź dalej; pytaj właściciela tylko o rzeczy nieodwracalne lub zmieniające zakres.
