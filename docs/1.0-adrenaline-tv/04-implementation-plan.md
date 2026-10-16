# Plan implementacyjny

Nie implementować etapów w ramach samego przygotowania tego dokumentu. Wszystkie checkboxy poniżej dotyczą przyszłej pracy. Zachować `npm run check` przed każdym commitem, małe logiczne commity na `main`, aktualizować status. Nowe testy są offline; używać własnych lub dozwolonych do dystrybucji mediów.

## Zależności i priorytety

Ścieżka krytyczna: **P0 oba urządzenia → P1 → P2 → P3 → P4/P5 → P6 → P7**. Prototypy odtwarzania i deploy wykonujemy już w P0, aby nie odkryć ograniczenia Tizena po napisaniu pełnego produktu. Można implementować P4/P5 w dowolnej kolejności, ale wydanie wymaga obu. P6 integruje adaptery sprawdzone w P0. Nie dodawać nowych funkcji desktopu poza TV podczas tej migracji.

## P0 — bramki wykonalności i zakres sprzętu (5–8 dni pracy)

- [ ] Zapisać modele, OS, firmware, pilot i połączenie LAN obu TV; wybrać także najstarszy model z proponowanego minimum.
- [ ] Android: minimalny podpisany APK z ikoną TV, instalacja ADB, autoryzacja/parowanie, upgrade bez utraty danych, start i odtwarzanie własnej próbki przez Media3.
- [ ] Tizen: minimalny WGT, DUID/profil/permit, instalacja SDB/CLI, upgrade tym samym autorem, reboot i ponowny start.
- [ ] Sprawdzić Tizen fetch oraz AVPlay osobno: HTTP, HTTPS z zaufanym certyfikatem, certyfikat lokalny, bilety w URL, Range/HLS, audio i napisy. Zapisać dokładny wynik, nie samo „działa”.
- [ ] Zweryfikować Compose/Media3 minSdk oraz target/build Tizen dla Chromium M76; krótka lista React + CSS + API kompatybilnych ze sprzętem.
- [ ] Wybrać wersje ADB/SDB/CLI, bezpieczny sposób wywoływania z Windows, wymagane runtime i dopuszczalny model dystrybucji narzędzi.
- [ ] Sprawdzić konkretny build FFmpeg: licencje/konfiguracja, H.264/AAC 1080p, remux, seek, RAM/CPU i rozmiar bundle.
- [ ] Decyzja o transporcie i rzeczywistym minimum OS, podpisana jako nowy wpis D-xx. Zaktualizować wymagania wsparcia, bez usuwania jednej platformy.

Artefakty: `docs/1.0-adrenaline-tv/spikes/` z wynikami, komendami bez sekretów, wersjami i tabelą kompatybilności; małe prototypy w `scripts/dev/tv-spike/` lub właściwych katalogach klientów. Dane prywatne/certyfikaty poza repo.

**Bramka:** na obu fizycznych urządzeniach powtarzalne install → start → API → play → upgrade. Negatywny wynik nie pozwala zaznaczyć P0; udokumentować zmianę planu, szczególnie TLS i warunki „bundled”. Nie budować pełnego UI w oczekiwaniu, że problem certyfikatów sam się rozwiąże.

## P1 — wspólny backend bez regresji desktopu (3–5 dni)

- [ ] Wydzielić inicjalizację usług z `src/main/index.ts` do `src/main/services/create-services.ts` lub równoważnego composition root.
- [ ] Pozostawić publiczne kontrakty IPC i sposób pracy istniejących ekranów. Wyodrębnić `openFolder` jako lokalną zdolność adaptera, bez wystawiania jej po sieci.
- [ ] Dodać klientów/właścicieli sesji do release-search; TTL, anulowanie i limity izolujące desktop od TV.
- [ ] Zdarzenia domenowe mają wielu odbiorców i niezależny lifetime od okna; po zamknięciu UI nadal działa kolejka.
- [ ] Wzmocnić idempotencję/serializację tworzenia pobrania i konfliktów operacji bez zmiany reguł domeny.

Pliki: istniejące services, events, lifecycle, IPC; kontrakty lokalne zmieniać tylko jeśli niezbędne. Testy: desktopowe zachowanie sprzed zmiany, dwa niezależne wyszukiwania i równoległe utworzenie tego samego torrenta.

**Bramka:** `check`, build i istniejący smoke Electron zielone; wyszukiwanie, napisy, foldery, kolejka, restart i updater mają poprzednie zachowanie. Brak nasłuchu LAN przy TV disabled.

## P2 — TV API, parowanie i dane (5–8 dni)

- [ ] `src/shared/contracts/tv/*`, OpenAPI i wspólne fixtures. Przypiąć lekką bibliotekę HTTP po sprawdzeniu wersji i licencji albo świadomie wybrać `node:http`; bez generowania RPC z całego IPC.
- [ ] `src/main/tv/server.ts`, `auth.ts`, `pairing.ts`, `routes/*`, `events.ts`; endpointy z dokumentu architektury.
- [ ] Migracje i repozytoria devices/idempotency/progress/probe; migracja istniejącego profilu 0.9.0.
- [ ] Połączenie API z usługami katalogu/pobierania/napisów, projekcje bez ścieżek i sekretów.
- [ ] Rate limiting, Host/Origin, kontrola tokenów, redakcja logów, limit body/czasów i decyzja transportowa z P0.
- [ ] Minimalna zakładka TV: start/stop, adres serwera, akceptacja parowania, revoke, status i lokalne uprawnienia.

**Bramka:** klient testowy po parowaniu wyszukuje i tworzy zadanie na PC; bez parowania nie ma dostępu. Revoke działa także na już otwarte połączenie. Restart zachowuje urządzenia i pobrania, ale unieważnia krótkotrwałe sesje. Nie wolno otworzyć Jackett do LAN.

## P3 — biblioteka i streaming (6–10 dni)

- [ ] `src/main/media/library-service.ts`, `probe.ts`, `playback-planner.ts`, `range.ts`, `transcoder.ts`, `tickets.ts`.
- [ ] Projekcja gotowych filmów/odcinków, wykrywanie brakujących plików i invalidacja probe.
- [ ] Range/HEAD i bilety, podpisane/zabezpieczone manifesty i segmenty HLS; brak dowolnego dostępu do dysku.
- [ ] ffprobe, direct play, remux, audio fallback, limitowany 1080p SDR transcode; procesy i cache sprzątane po błędach/quit.
- [ ] Audio/subtitle selection, seek/resume/progress, brak zależności od sukcesu opcjonalnych napisów.
- [ ] Równoczesny transfer filmu i pobieranie nie blokują desktopu; limity streamingu i kodowania widoczne w diagnostyce.

**Bramka:** własny materiał działa na obu odtwarzaczach z P0; poprawny seek, brak nieograniczonego zużycia RAM i żadnego odczytu spoza biblioteki. Niedostępny kodek daje fallback albo konkretny błąd.

## P4 — pełny klient Android TV (5–8 dni)

- [ ] `tv/android` z wrapperem Gradle, przypiętymi zależnościami, DTO API i release signing.
- [ ] Compose for TV: Connect, Search, Details/Season, Releases, Download setup, Downloads, Library.
- [ ] Media3 + MediaSession: play/pause, seek, audio/napisy, resume, standby/background i zwalnianie playera.
- [ ] Bezpieczne przechowywanie tokena, version handshake, retry/backoff i reconnect.
- [ ] Obsługa błędów konfiguracji PC, braku miejsca, metadanych torrenta i wyboru plików pilotem.

**Bramka:** pełny scenariusz na fizycznym Android TV tylko pilotem; żaden plik filmu nie jest pobierany na dysk TV poza buforem odtwarzacza. Testy DTO/ViewModel offline i krótki test nawigacji, bez budowy farmy E2E.

## P5 — pełny klient Samsung Tizen (6–10 dni)

- [ ] `src/tv` jako osobny entrypoint Vite; `tv/tizen/config.xml`, adapter platformy/playera i skrypty pakowania w `scripts/tv/`.
- [ ] Oddzielna konfiguracja targetu JS/CSS i zależności zgodna z P0; build bez Node/Electron/preload.
- [ ] Te same scenariusze produktu co Android, komponenty do D-pad i pamięć fokusu.
- [ ] AVPlay: lifecycle, przełączanie tracków, napisy, resize, Back/Return, wznowienie po standby i sieci.
- [ ] Manifest WGT i uprawnienia minimalne; offline shell, obsługa tokena/transportu zgodnie z P0.

**Bramka:** pełny scenariusz na realnym Samsungu, również najstarszym zadeklarowanym modelu; żadnych luk funkcjonalnych ukrytych pod „Tizen później”. Emulator/browser służy do iteracji, nie do certyfikacji odtwarzania.

## P6 — Deploy to TV i dostarczanie artefaktów (4–7 dni)

- [ ] `src/main/tv/deploy/{android,tizen,toolchain,process-runner}.ts` oraz desktop `screens/tv/*`.
- [ ] Kreator z trwałym stanem etapów, preflight, obsługą kodów platformowych i anulowaniem.
- [ ] Wybór konkretnego urządzenia, instalacja/update, launch i handshake. Profil certyfikatu Tizen i lokalny packaging bez potrzeby kompilacji aplikacji.
- [ ] `resources/tv/manifest.json`, `electron-builder.yml`, pipeline TV i kontrola release assets; APK i zasoby Tizen muszą trafić do NSIS.
- [ ] Narzędzia/FFmpeg z checksumami i notices, prywatne klucze poza bundle.
- [ ] Instrukcja po angielsku: przygotowanie TV, certyfikaty, firewall, połączenie, backup podpisu i aktualizacja.

**Bramka:** czysty Windows bez checkoutu repo instaluje obie aplikacje zgodnie z opisanymi prerequisites; drugie wdrożenie zachowuje parowanie/dane. Sprawdzić przerwaną instalację i brak internetu przy dostępnych narzędziach/certyfikatach. Nie testować tylko z deweloperskiego `npm run dev`.

## P7 — odbiór i 1.0.0 (4–6 dni)

- [ ] Wykonać całą [macierz akceptacji](05-acceptance-and-risks.md), wpisać modele/wersje/wyniki.
- [ ] Migracja 0.9.0 → 1.0.0 na Windows, restart kolejki, recovery i backup bez utraty danych.
- [ ] Przegląd nasłuchów, firewall, sekretów/logów, uprawnień plików i procesów.
- [ ] Dwa TV + desktop, utrata Wi-Fi, uśpienie PC, zajęty port, cofnięcie tokena, aktualizacja klienta/serwera.
- [ ] Przejście check/build/smoke, dotychczasowy test swarm silnika w CI oraz buildy obu klientów. Testy urządzeń ręczne, bez usług live w CI.
- [ ] Zaktualizować STATUS, decyzje, README/user guide i release checklist; dopiero wtedy wersja/tag `v1.0.0` i wydanie przez Actions.

## Estymacja i zasoby

Suma: **38–62 dni pracy jednej osoby**, orientacyjnie 8–13 tygodni roboczych plus dostęp do sprzętu, opóźnienia certyfikatów i 20–30% rezerwy. To estymacja planistyczna, nie wynik pomiaru istniejącej implementacji. Największa niepewność: Tizen deploy/TLS/firmware i kompatybilność multimediów. P0 ma zawęzić tę estymację przed pełną realizacją.

Potrzebne: komputer Windows x64, fizyczny Android TV, fizyczny Samsung z najstarszego deklarowanego rocznika oraz dostęp do nowszego Tizena do regresji, konto developerskie/certyfikaty Samsung, klucz APK dla CI i własny zestaw próbek. Brak sprzętu nie blokuje testów domeny, ale blokuje deklarację pełnego wsparcia i finalny release.
