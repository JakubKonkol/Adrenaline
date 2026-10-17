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
3. Kliknij „Restart and update”. Aplikacja zamyka się, instalator aktualizuje ją i uruchamia ponownie.
4. „About” pokazuje nową wersję.

Wymaga publicznego repozytorium (D-07). Wynik: **do potwierdzenia przez Jakuba**.

## Beta — odbiór na czystym Windows (8.5)

Status wszystkich poniższych prób: **nie wykonano**. v0.9.0 jeszcze nie wydano; użyć aktualnego instalatora kandydującego do bety.

1. Czysta instalacja bez dodatkowego .NET/klienta torrent → kreator → pełny scenariusz z legalnym materiałem → film i napisy obok niego.
2. W poprzedniej wersji utworzyć dwa zadania (aktywne i spauzowane), zaktualizować przez baner. Potwierdzić zachowanie stanów, plików i ustawień.
3. Odinstalować. Potwierdzić, że filmy, napisy i profil użytkownika zostały zachowane.
4. Wybrać folder bez uprawnień zapisu; sprawdzić komunikat błędu (po angielsku, D-77) i możliwość zmiany folderu.
5. Zapełnić testowy VHD 1 GB podczas pobierania; sprawdzić pauzę i wznowienie po zwolnieniu miejsca.
6. Odłączyć testowy pendrive podczas pobierania; podłączyć pod tą samą ścieżką i wznowić.
7. Powtórzyć zapis w ścieżce z polskimi znakami; przetestować także sidecary na FAT/exFAT (wyłączność zapisu, brak nadpisania).
8. Bez konta OpenSubtitles: przełącznik „Download subtitles” domyślnie wyłączony; pobranie kończy się jako „Ready”. Włączyć „Get subtitles” w szczegółach → ostrzeżenie o braku konta → „Skip subtitles” przywraca „Ready” (D-78).
9. Wpisać konto OpenSubtitles w Ustawieniach; sprawdzić limity, wylogowanie, zapis rzeczywistych napisów, ręczny wybór i ponowienie bez restartu filmu. Nie wykonywać celowo serii pobrań zużywających limit.

## Sytuacje wyjątkowe — wymagania §10 (8.1)

| Sytuacja | Kod / stan | Akcja w interfejsie | Dowód / próba |
|---|---|---|---|
| TMDB niedostępne | TMDB_UNAVAILABLE | Ponów; pobrania pozostają dostępne | tmdb-client.test.ts, Catalog.test.tsx |
| Jedno źródło nie odpowiada | SOURCE_TIMEOUT / SOURCE_UNAVAILABLE | Wyniki częściowe, odśwież / sprawdź źródło | release-search-service.test.ts |
| Wszystkie źródła niedostępne | ALL_SOURCES_FAILED | Odśwież, Ustawienia → Źródła | release-search-service.test.ts |
| Magnet bez metadanych | fetching_metadata / METADATA_TIMEOUT | Usuń lub wznów zadanie | download-service.test.ts, swarm |
| Brak peerów | peers=0, ETA nieznane | Poczekaj, wstrzymaj lub usuń | job-status.test.ts, UI; ręczny swarm bez seedera do odbioru |
| Za mało miejsca | DISK_FULL / paused_disk_full | Zwolnij miejsce, wznów | download-service.test.ts; VHD powyżej nie wykonano |
| Niedopasowane napisy | needs_selection | Wybierz innego kandydata albo „Skip subtitles” | subtitle-ranking.test.ts, subtitle-service.test.ts |
| Brak konta / logowania OpenSubtitles | SUBS_NO_KEY / SUBS_AUTH | Film gotowy; dodaj konto albo „Skip subtitles” (D-78) | subtitle-service.test.ts, Downloads.test.tsx, smoke |
| Limit napisów | SUBS_QUOTA / quota_exceeded | Film dostępny; data resetu, ponów po resecie | opensubtitles-client.test.ts, subtitle-service.test.ts |
| Plik usunięty poza aplikacją | FILE_MISSING | Sprawdź pliki / ponów; film nie jest podmieniany | download-service.test.ts; ręczny odbiór nie wykonano |
| Awaria silnika | ENGINE_CRASHED / restarting | UI działa; restart silnika lub wznowienie | engine-process.test.ts, crash-loop 20/20 opisany w STATUS |
| Konflikt nazwy | PATH_CONFLICT / DUPLICATE_JOB | Nowy katalog / numerowana nazwa, bez nadpisania | fs.test.ts, download-service.test.ts, subtitle-service.test.ts |

## Dostępność i bezpieczeństwo — stan przeglądu

- Smoke WSL/xvfb: aktywacja klawiaturą wyboru wydania, startu pobrania, otwarcia folderu, diagnostyki i dokumentów. Pełne przejście kolejności Tab i test czytnikiem ekranu pozostają do odbioru.
- NFR01: 3 aktywne zadania FakeEngine, 20 próbek kliknięcie → zmiana stanu → dwie klatki; p95 **52,7 ms** (15.10.2026), **56,9 ms** po zmianach z 16.10.2026. Próba w istniejącym smoke, załącznik `ui-response.json`.
- Paleta po poprawkach: minimalny kontrast badanych tekstów/statusów na podstawowych powierzchniach 5,62:1 (ciemny), 5,15:1 (jasny). Nie zastępuje pełnego audytu WCAG wszystkich kombinacji.
- `npm audit --omit=dev` 15.10.2026 i 16.10.2026: **0 podatności**.
- Licencje npm: dwa pakiety bez pliku LICENSE (`@nodable/entities`, `lazy-val`, oba MIT wg `package.json`) mają teraz tekst MIT z autorem z pakietu zamiast README (`scripts/generate-notices.mjs`).
- Przejrzano izolację renderera/CSP/walidację IPC, allowlistę hostów OpenSubtitles, limit archiwów i ochronę ścieżek. Diagnostyka testowana na danych z sekretami/URL: wyłącznie wersje, liczniki i znane kody błędów.
- Otwarte 8.6: końcowy przegląd całej listy z architektury, logów z rzeczywistego konta i nasłuchów na czystym Windows. Licencje natywne: krok „Collect dependency licenses” w Engine CI 38790983921 przeszedł (ścieżka vcpkg poprawna); ten sam run padł później na teście swarm (patrz STATUS).

## 1.0 — TV i biblioteka (odbiór ręczny na sprzęcie)

Zakres i progi: [docs/1.0-adrenaline-tv/05-acceptance-and-risks.md](1.0-adrenaline-tv/05-acceptance-and-risks.md) i [06-playback-negotiation.md](1.0-adrenaline-tv/06-playback-negotiation.md). Wynik każdego punktu wpisać z modelem TV, wersją firmware, wersją Adrenaline, siecią (Wi-Fi/Ethernet) i trybem odtwarzania z zakładki TV → Playback on TVs. Emulator/przeglądarka nie zamykają punktów sprzętowych.

### Desktop (Windows, bez TV)

1. Pobranie do końca: zadanie przechodzi w `completed`, upload spada do 0, torrent znika z silnika (brak ruchu w Menedżerze zasobów → Sieć dla `adrenaline-engine.exe`), film w zakładce Library.
2. Profil z 0.9.0 z zadaniem seedującym: po aktualizacji do 1.0 zadanie jest `completed`, nic nie wysyła.
3. Quit z zasobnika: po 15 s brak `adrenaline-engine.exe`, `JackettConsole.exe` i `ffmpeg.exe` w Menedżerze zadań. Zabicie `Adrenaline.exe` w Menedżerze zadań, ponowny start: pozostawiony Jackett/silnik zostaje zatrzymany (log „stopped a leftover…”).
4. Library: Play (domyślny odtwarzacz), Show in folder, Remove (pliki zostają / z „Also delete the files”), plik usunięty ręcznie → „File missing”.
5. TV → włączenie serwera: monit zapory Windows (Private), adres LAN w zakładce, port zajęty → `TV_PORT_IN_USE`, wyłączenie → port zamknięty (`netstat -ano | findstr 18790`).

### Android TV (fizyczny, Android 9+)

6. Deploy na PC bez Android SDK: automatyczne pobranie adb (kolejna instalacja z cache), debugowanie sieciowe (5555) i bezprzewodowe z kodem parowania (Android 11+); monit „Allow debugging” → instalacja → automatyczny start i parowanie z PC → kod na TV = kod w zakładce → Approve → stan „Installed and connected”. Ubicie aplikacji tuż po parowaniu i ponowny start zachowuje połączenie.
7. Ponowny Deploy tej samej wersji i nowszej: dane i parowanie zachowane. APK z innym podpisem → `DEPLOY_SIGNATURE_MISMATCH`, bez odinstalowania.
8. Pilotem: Discover (hero, rzędy, wyszukiwarka z klawiaturą TV), szczegóły filmu i serialu (sezony/odcinki), wydania, „Download to PC” → pobranie widoczne na PC i w Library na TV; Back w każdym miejscu wraca do poprzedniej pozycji.
9. Odtwarzanie (Media3): MP4 H.264 direct; MKV HEVC direct; napisy SRT obok pliku (polskie znaki); wybór ścieżki audio i napisów osadzonych (PGS w MKV direct play); wznowienie od zapisanej pozycji; Home w trakcie → pozycja zapisana.
10. Passthrough przez AVR/soundbar (eARC): E-AC3 JOC (Atmos) i TrueHD Atmos jako bitstream (wskaźnik Atmos na AVR), DTS-HD MA → DTS-HD na AVR; bez AVR → transkod audio do E-AC3/AAC zgodnie z powodem w zakładce TV.
11. Dolby Vision: P8.1 i P5 na TV z DV (direct, wskaźnik DV na TV); na TV bez DV: P8.1 jako HDR10, P5 → konwersja z tone mappingiem (poprawne kolory, bez zielono-fioletowego obrazu).

### Samsung Tizen (fizyczny, najstarszy deklarowany rocznik i nowszy)

Odbiór 17.10.2026: QE65Q77BATXXH, Tizen 6.5, automatyczna instalacja i aktualizacja (nowy łańcuch odrzucony → pojedynczy fallback legacy SDK distributor), start i auto-parowanie. Wszystkie 12 syntetycznych formatów osiągają PLAYING: H.264/AAC MP4, VP9/Opus WebM, AV1/Opus MKV, MPEG-2/MP2 TS, H.264/E-AC3 MP4, HEVC HDR10/E-AC3 MP4; HLS MPEG-TS: Saltwind HEVC Main10 HDR10 + TrueHD→E-AC3, H.264+DTS, HEVC+FLAC, MOV+PCM; transkod wideo: XviD/MP3 AVI i H.264 10-bit. Seek +30 s i zgodność napisów z osią czasu sprawdzone; pauza 95 s nie zrywa HLS. Ubicie aplikacji 1,5 s po parowaniu zachowuje połączenie. Są to wyniki API/AVPlay; końcowa ocena obrazu i dźwięku przez widza oraz passthrough do AVR pozostają ręczne. Android TV 14: emulator — deploy, auto-parowanie, direct/HLS, seek i zgodność napisów; brak fizycznego Android TV do odbioru passthrough/DV.

12. Samsung: zapisać dokładny model i firmware. Developer Mode z IP PC → Deploy, IP TV, Automatic, bez Tizen Studio → pierwsze pobranie narzędzi → instalacja WGT → uruchomienie i auto-parowanie bez pilota. Powtórzyć aktualizację z tym samym `author.json`, także bez dostępu PC do internetu (cache). Automatic potwierdzone na QE65Q77BATXXH. Przy odrzuceniu certyfikatu zapisać komunikat; osobno sprawdzić Advanced z profilem Samsung + DUID. Nie odinstalowywać aplikacji jako automatycznej naprawy.
13. Ponowny Deploy po aktualizacji Adrenaline (ten sam profil): dane i parowanie zachowane. Inny profil autora → `DEPLOY_CERTIFICATE`.
14. Pilotem jak w punkcie 8; klawisze mediów pilota (Play/Pause, FF/RW, Stop) w odtwarzaczu.
15. AVPlay: MP4/MKV direct, HLS VOD MPEG-TS (np. DTS→E-AC3 i AVI→H.264), natywny seek w obrębie i poza skonwertowaną częścią (restart FFmpeg w tej samej sesji), zmiana ścieżki audio (direct: w pliku; HLS: nowa sesja), napisy WebVTT zgodne z pełnym czasem filmu, pauza >60 s → wznowienie; standby TV w trakcie → powrót.
16. HDR10/HDR10+ na Samsungu HDR (direct), na modelu bez HDR → tone mapping; E-AC3 JOC przez eARC do soundbara (Atmos).

### Konwersja na PC (dowolny TV)

17. NVENC / Quick Sync / AMF: dla każdej dostępnej karty ustawić „Conversion with” i odtworzyć 4K HDR → SDR 1080p; prędkość w zakładce TV ≥ 1,0×; użycie GPU w Menedżerze zadań. „Processor only” → libx264.
18. Dwa TV jednocześnie: drugi transkod wideo → `TV_TRANSCODE_BUSY` na drugim TV, direct play działa równolegle.
19. Stop/seek/revoke/Quit w trakcie konwersji: `ffmpeg.exe` znika w ≤ 2 s, katalog `%APPDATA%\adrenaline\transcode` pusty po Quit; limit miejsca (np. 5 GB) nie jest przekraczany przy długim remuxie 4K.
20. PGS i ASS przy konwersji wideo: napisy wypalone, zsynchronizowane po seeku.

### Odtwarzacz i następny odcinek

21. Samsung: pasek czasu z podglądem pozycji, seek po OK / zakończeniu naciskania strzałek, −10/+30 s, pauza, „kończy się o”. Arkusze napisów/audio i ustawienia (rozmiar/tło/wysokość/synchronizacja ±0,25 s), fit/fill, informacje o źródle i strumieniu. Wyjść i wrócić: wygląd i język napisów zachowane. Ustawienia obejrzane w Chrome; ocena wyglądu na ekranie TV pozostaje ręczna.
22. Orbit Station S01E01 → przycisk „Next episode” otwiera S01E02 bez powrotu do biblioteki. Ponownie S01E01 → koniec → „Up next”, odliczanie 10 s → S01E02. Sprawdzić „Play now”, Back (anulowanie), ostatni odcinek i film (bez odliczania). Biblioteka może być nieposortowana, brakujący plik lub inny serial nie może być wybrany. Powtórzyć po zakończeniu natywnego Media3 na Androidzie.

Wynik 17.10.2026, build 1.0.0, QE65Q77BATXXH / Tizen 6.5: przycisk Next episode uruchamia S01E02 (AVPlay PLAYING). Rzeczywisty koniec S01E01 po przewinięciu do ostatnich 4 s pokazuje Up next z S01E02 i odliczaniem 10 s, po którym S01E02 odtwarza się automatycznie; jako ostatni dostępny odcinek nie ma przycisku Next episode. Wynik przez CDP/AVPlay, bez oceny obrazu/dźwięku przez widza. Anulowanie i Play now oraz zakończenie Media3 pozostają dodatkowymi odbiorami ręcznymi.
