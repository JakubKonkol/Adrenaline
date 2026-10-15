# Testy

Cel: proste, szybkie testy, które łapią regresje w logice i kontraktach. Bez rozbudowanej infrastruktury (D-03).

## Rodzaje

| Rodzaj | Narzędzie | Gdzie | Uruchamiane |
|---|---|---|---|
| Jednostkowe | Vitest | `src/**/*.test.ts` | `npm test`, każdy commit, CI |
| Kontraktowe (dostawcy) | Vitest + fixtures | `src/main/providers/**/*.test.ts`, dane w `tests/fixtures/<dostawca>/` | jak wyżej |
| Komponenty UI (wybrane) | Vitest + `@testing-library/react` + `happy-dom` | `src/renderer/**/*.test.tsx` | jak wyżej |
| Integracyjny silnika | Vitest steruje zbudowaną binarką | `native/engine/tests/swarm.test.ts` | `npm run test:engine` (lokalnie po zbudowaniu silnika i w workflow `engine-ci.yml`) |
| Smoke Electron | Playwright `_electron` | `tests/smoke/app.spec.ts` | `npm run test:smoke`, CI i release |

`npm run check` = `lint` + `typecheck` + `test` (bez silnika i smoke). To musi przejść przed każdym commitem.

## Zasady

- Testy nie wołają internetu. Klienty HTTP przyjmują wstrzyknięty `fetch`; testy podają fake zwracający fixtures.
- Fixtures odpowiedzi to zanonimizowane, ręcznie przycięte zapisy prawdziwych odpowiedzi (zapisane podczas weryfikacji API w etapach 4, 5, 7) oraz przypadki brzegowe: pusta lista, 401, 429 z `Retry-After`, HTML zamiast JSON/XML, zmieniony schemat (brak pola), za duża odpowiedź.
- Nazwy wydań do testów parsera: lista w `tests/fixtures/release-names.json` (nazwa → oczekiwane pola). Minimum 40 przypadków: rozdzielczości 480p–2160p, WEB-DL/WEBRip/BluRay/Remux/HDTV, x264/x265/HEVC/AV1, HDR/HDR10+/DV, SxxEyy, paczki sezonów, „Director's Cut”, rok w tytule, tytuły z cyframi.
- Ścieżki Windows testowane przez `path.win32` jawnie, żeby testy dawały ten sam wynik na Linuksie i Windows.
- Testy żywych usług (TMDB, OpenSubtitles, Jackett z prawdziwymi indeksatorami) to skrypty ręczne w `scripts/live/*.mjs`, czytające klucze z `.env`. Nie są częścią `npm test` ani CI.

## Test integracyjny silnika (lokalny swarm)

Jeden plik testu, który:
1. Generuje w katalogu tymczasowym własne dane: plik 3 MiB losowych bajtów i katalog z 3 plikami (w tym jeden > 4 GiB jako *sparse file* tylko na Linuksie/NTFS, opcjonalnie pomijany flagą `ADRENALINE_SKIP_BIG=1`).
2. Tworzy `.torrent` (v1 oraz hybrid) przez tryb pomocniczy silnika `adrenaline-engine --make-torrent <ścieżka> --out <plik> [--hybrid]` (wbudowany w binarkę, używa `lt::create_torrent`; przydatny tylko w testach).
3. Uruchamia dwie instancje silnika na `127.0.0.1`: seeder (z danymi) i leecher (pusty katalog), z wyłączonym DHT/UPnP (flaga `--no-dht --no-upnp` tylko do testów) i bezpośrednim peerem (`args.peers: ["127.0.0.1:<port>"]` w `add`, dostępne tylko przy fladze `--test-mode`).
4. Sprawdza: pobranie wybranego pliku z paczki (pozostałe niepobrane), postęp tylko dla wybranych plików, pauza (brak przyrostu bajtów przez 3 s), zabicie leechera `SIGKILL`/`TerminateProcess` w połowie, restart i wznowienie z zachowaniem zweryfikowanych fragmentów, zgodność SHA-256 pliku wynikowego, magnet bez metadanych (stan `fetching_metadata` → `metadata`), uszkodzony fragment wykrywany przez recheck.

## Smoke test Electron

`tests/smoke/app.spec.ts` (Playwright `_electron.launch` na zbudowanym `out/main/index.js`, zmienne `ADRENALINE_FAKE_ENGINE=1`, `ADRENALINE_NO_JACKETT=1`, `ADRENALINE_USER_DATA=<tmp>`):
1. Okno się otwiera, tytuł zawiera „Adrenaline”.
2. Widoczny ekran onboardingu / wyszukiwania (zależnie od etapu).
3. `window.require` i `window.process` są `undefined` w rendererze (izolacja, NFR07).
4. Od etapu 6: dodanie zadania z fake engine (przez ukryte API testowe dostępne tylko przy `ADRENALINE_FAKE_ENGINE=1`) → widoczny postęp → pauza → zamknięcie → ponowne uruchomienie z tym samym `userData` → zadanie wciąż jest na liście.

Na Linuksie smoke wymaga `xvfb-run` (`xvfb-run -a npm run test:smoke`). W CI uruchamiany na `windows-latest`.

## Testy ręczne (lista kontrolna w etapie 8)

Rzeczy, których nie da się sensownie zautomatyzować, są w checkliście etapu 8 i wykonuje je właściciel na Windows (czysta maszyna: Windows Sandbox): instalacja, aktualizacja z poprzedniej wersji z zachowaniem kolejki, odinstalowanie bez usuwania filmów, prawdziwe wyszukiwanie i pobranie legalnego materiału, napisy, brak miejsca na dysku (mały pendrive/VHD), odłączenie dysku.
