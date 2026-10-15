> Kopia dokumentu źródłowego z 15.10.2026. Robocza nazwa "XXX" została zastąpiona nazwą **Adrenaline**. Tam, gdzie ten dokument różni się od `docs/implementation-plan/00-decyzje.md`, obowiązują decyzje z planu (m.in. tylko Windows x64, uproszczona struktura repo, proste testy).

# Adrenaline Research i plan techniczny

Data researchu: 15 października 2026. Wersja: 1.0. Odbiorca: właściciel produktu i agent implementujący Adrenaline.

## 1 Rekomendacja

Adrenaline należy zbudować jako aplikację desktopową **Electron + React + TypeScript + Vite**, z silnikiem **libtorrent rasterbar 2.x w osobnym procesie C++**, dołączanym do instalatora. Wyszukiwanie wielu źródeł powinno przechodzić przez **Torznab i dołączony Jackett**. Dane filmów i seriali: **TMDB**. Napisy: **OpenSubtitles.com REST API**, z możliwością ręcznego wyboru i importu. Lokalny stan: **SQLite**.

Jest to rekomendacja projektowa, a nie wynik testu gotowego prototypu. Najpierw trzeba przeprowadzić krótki eksperyment techniczny potwierdzający pakowanie silnika i Jackett oraz prawidłowe wznowienie pobierania. W tej sesji nie powstał kod aplikacji ani prototyp. Dokument określa przyszłe prace.

Największe ryzyka to utrzymanie źródeł, dopasowanie napisów do wydania i niezawodność zapisu na dysku. Sam ekran z paskiem postępu jest znacznie prostszy niż te trzy elementy.

Założenia do planowania: pierwsza platforma Windows x64, lokalne pobieranie na komputer użytkownika, brak konta Adrenaline i centralnego serwera w MVP. macOS i Linux po ustabilizowaniu wersji Windows. Są to proponowane decyzje, a nie wymagania podane przez użytkownika.

## 2 Electron czy aplikacja webowa

| Opcja | Ocena dla Adrenaline | Konsekwencje |
|---|---|---|
| Electron + React | Rekomendowana | Dostęp do dysku, procesów, TCP/UDP i działania w zasobniku; jeden instalator zawierający silnik |
| Electron + Angular | Wykonalna | Te same możliwości desktopowe; sensowna przy istniejącym zespole Angular, bez przewagi dla tego zakresu |
| Electron + Next.js | Możliwa, zbędna złożoność | SSR i publiczne SEO nie są potrzebne; lokalny serwer Next zwiększa liczbę komponentów |
| React lub Angular wyłącznie w przeglądarce | Nie spełnia dobrze głównego scenariusza | Ograniczenia transportu BitTorrent i cyklu życia karty; trudniejsze długie pobrania i zarządzanie folderami |
| React/Next.js + serwer pobierający | Inny model produktu | Pliki trafiają na serwer, a następnie przez HTTP do użytkownika; koszty dysku i transferu, uwierzytelnianie i utrzymanie |
| Web UI + lokalny daemon | Wykonalna alternatywa | Nadal wymaga instalacji programu lokalnego; może być dobrym późniejszym wariantem dla NAS |

WebTorrent w przeglądarce korzysta z peerów WebRTC i nie łączy się bezpośrednio ze zwykłymi peerami TCP/UDP. Uruchomienie WebTorrent w środowisku Node jest innym wariantem. Wybór Reacta, Angulara czy Next.js nie usuwa ograniczeń przeglądarki [S1, S2]. Wniosek: Electron odpowiada dokładnie wymaganiu lokalnego, zbundlowanego pobierania.

## 3 Wybór silnika torrentowego

| Silnik | Zalety | Koszt i ograniczenia | Decyzja |
|---|---|---|---|
| libtorrent rasterbar | Silnik C++, obsługa v1/v2 i danych wznowienia; rozbudowana kontrola sesji | Własny cienki program pomocniczy, kompilacja i paczki per OS/CPU | Docelowy wybór |
| WebTorrent w Node | Proste API JavaScript, łatwy start w Electronie | Semantyka pauzy wymaga własnej obsługi; kompatybilność wymaganych torrentów do testu | Alternatywa dla szybkiego, ograniczonego MVP |
| Transmission daemon | Gotowy proces sterowany przez RPC | Pakowanie binariów, licencje i różnice wersji protokołu | Plan rezerwowy, jeśli wrapper C++ okaże się zbyt kosztowny |
| qBittorrent z Web API | Bogaty gotowy klient i sterowanie HTTP | Zależności dystrybucyjne i dostępność odpowiednich binariów per platforma | Opcjonalna integracja z instalacją użytkownika |

Dokumentacja libtorrent opisuje zapis i odtwarzanie danych fast-resume oraz torrenty v2 i hybrydowe [S3, S4]. Nie należy mylić libtorrent rasterbar z biblioteką używaną przez rTorrent.

**Pułapka WebTorrent:** udokumentowane `torrent.pause()` ogranicza nawiązywanie nowych połączeń; nie zatrzymuje istniejących strumieni. Nie wolno podpiąć tego wywołania wprost pod obietnicę pełnej pauzy. W wariancie WebTorrent potrzebne byłoby odłączenie zadania z zachowaniem plików i kontrolowane ponowne dodanie, albo inna przetestowana implementacja. `done` dotyczy całego torrenta; pobranie wybranych plików musi mieć własny warunek zakończenia [S1].

Transmission ma udokumentowane RPC; dokumentacja gałęzi main może wyprzedzać wydanie instalowane użytkownikom. Adapter musi sprawdzać wersję protokołu, a nie polegać na przykładach dla innego wydania [S5]. qBittorrent oferuje Web API, ale traktowanie go jako wymaganej zewnętrznej instalacji nie realizuje postulatu jednego kompletnego instalatora [S6].

### Projekt procesu silnika

Proponowany program `adrenaline-engine` będzie cienką warstwą nad libtorrent, a nie nową implementacją protokołu. Electron uruchamia go bez powłoki systemowej, przez bezwzględną ścieżkę do spakowanego pliku. Komunikacja: wersjonowany JSON Lines po stdin/stdout; stderr wyłącznie na zredagowane logi. Brak lokalnego serwera HTTP dla silnika upraszcza ochronę dostępu.

Projekt kontraktu, do zaimplementowania później:

| Operacja | Cel |
|---|---|
| `hello` | Wersja protokołu, wersja silnika i lista obsługiwanych funkcji |
| `add` | Magnet lub zweryfikowane bajty .torrent; start w trybie pobrania metadanych |
| `selectFiles` | Lista indeksów plików i priorytetów, po poznaniu metadanych |
| `start`, `pause`, `resume` | Sterowanie jednym zadaniem z potwierdzeniem faktycznego stanu |
| `remove` | Usunięcie z kolejki; kasowanie danych tylko jako osobna jawna opcja |
| `setLimits` | Limity transferu, połączeń i polityka seedowania |
| `snapshot` | Pełny stan do odtworzenia UI po ponownym połączeniu |
| `shutdown` | Zapis wznowienia i kontrolowane zamknięcie |

Każde żądanie ma `requestId`, `protocolVersion`, a operacje na zadaniu `jobId`. Odpowiedź zawiera wynik albo stabilny kod błędu. Zdarzenia mają numer sekwencji. Komendy muszą być idempotentne; timeout nie może prowadzić do drugiego pobrania. Heartbeat i ograniczony restart procesu chronią przed pętlą awarii.

Pauza oznacza zatrzymanie aktywności sieciowej zadania po potwierdzeniu silnika. Przy libtorrent trzeba zweryfikować wpływ automatycznego zarządzania kolejką na ręczną pauzę. Nie należy obiecywać natychmiastowego zatrzymania wszystkich bajtów już znajdujących się w buforach.

## 4 Architektura aplikacji

| Moduł | Odpowiedzialność | Granica |
|---|---|---|
| Renderer React | Wyszukiwanie, wybór wydania, lista pobrań i ustawienia | Bez Node i bez bezpośredniego dostępu do plików lub sekretów |
| Preload | Wąskie, typowane API dla UI | Udostępnia określone operacje przez contextBridge |
| Electron main | Okna, dialog katalogu, lifecycle procesów, koordynacja | Weryfikuje IPC i uprawnienia do operacji |
| Usługi aplikacyjne | TMDB, Torznab, napisy, kolejka, zapis stanu | Wymienne adaptery, brak logiki zależnej od komponentów UI |
| Proces libtorrent | Transfer, kontrola integralności, statystyki | Brak parsowania stron i logowania do API napisów |
| Proces Jackett | Adaptery poszczególnych indeksatorów | Lokalny endpoint, osobny katalog konfiguracji |
| SQLite i pliki resume | Stan biznesowy i wznowienia | Baza ma jednego właściciela zapisu |

Przepływ: wyszukanie tytułu w TMDB → identyfikacja filmu/odcinka → równoległe zapytania do źródeł → normalizacja wydań → wybór → metadane torrenta i pliki → transfer → dopasowanie oraz zapis napisów → gotowy folder.

Długie zadania nie mogą blokować głównego wątku Electrona. Usługi o większym obciążeniu można przenieść do utility process; natywny helper C++ uruchamia się jako osobny plik wykonywalny. `utilityProcess` jest mechanizmem procesu Node, nie bezpośrednim loaderem binariów C++ [S17].

Proponowany podział repozytorium: `apps/desktop` na main/preload/renderer, `packages/domain` na modele i reguły, `packages/contracts` na komunikaty, `packages/providers` na adaptery, `packages/persistence` na SQLite, `native/torrent-engine` na wrapper oraz `tests/fixtures` na kontrolowane dane. To plan struktury, nie utworzone pliki projektu.

## 5 Wyszukiwanie torrentów i źródła

Indeksator wyszukuje wydania po nazwie lub ID. Tracker pomaga znaleźć peerów dla znanego torrenta. DHT również wyszukuje peerów dla hasha; samo DHT nie jest wyszukiwarką filmów. Dodanie dziesiątek adresów trackerów nie zastępuje integracji indeksatorów.

### Warstwa integracyjna

Jackett tłumaczy zapytania aplikacji na zapytania do wielu serwisów i udostępnia wyniki przez Torznab. Prowlarr jest alternatywnym menedżerem indeksatorów [S7, S8]. Rekomendacja: wspólny adapter Torznab, dołączony Jackett jako ustawienie domyślne i możliwość podania istniejącego endpointu Jackett/Prowlarr.

Nie tworzyć osobnego scrapera HTML w Adrenaline dla każdego serwisu. Zmiany domen, layoutów i uwierzytelniania są kosztem utrzymania adapterów. Nie zakładać publicznego, stabilnego API dla każdego źródła.

### Lista kandydatów

| Źródło | Rola | Proponowany etap | Stan weryfikacji |
|---|---|---|---|
| The Pirate Bay | Ogólne filmy i seriale | Kandydat do pierwszego zestawu | Wymieniony w aktualnie odczytanej liście Jackett; bez testu live |
| YTS | Wydania filmowe | Kandydat do pierwszego zestawu | Lista Jackett zawiera nazwę YTS.ag; nie jest to potwierdzenie bieżącej domeny |
| Torrent Downloads | Dodatkowe źródło ogólne | Kandydat do pierwszego zestawu | Wymieniony w Jackett; test potrzebny |
| LimeTorrents | Dodatkowa redundancja | Kandydat do pierwszego zestawu | Wymieniony w Jackett; test potrzebny |
| Nyaa.si | Anime | Opcjonalnie po MVP | Wymieniony w Jackett; osobna numeracja odcinków i języki |
| EZTV przez wariant Jackett | Serialowe uzupełnienie | Po sprawdzeniu wymagań konta | W odczytanej liście występuje wariant wymagający logowania |
| Internet Archive | Kontrolowany katalog materiałów z dostępnymi torrentami | Testy i opcjonalny adapter | Udokumentowane Metadata API; torrent i uprawnienia sprawdzane per pozycja |
| Torznab użytkownika | Prywatne lub inne źródła | MVP | Dostęp i zakres zależą od konfiguracji użytkownika |

Lista Jackett potwierdza istnienie definicji, nie aktualną dostępność serwisu, wiarygodność plików ani prawo do pobrania [S7]. Pierwszy release powinien oferować 3–4 zweryfikowane źródła ogólne, a nie bezwarunkowo włączać wszystkie. Nie ma podstaw do obiecania znalezienia każdego tytułu.

1337x nie jest podstawą MVP: nie został potwierdzony w odczytanej liście Jackett. Nie zakładać również działania historycznych domen RARBG czy TorrentGalaxy na podstawie nazw podobnych klonów. Dalszą integrację poprzedza osobny test definicji, dostępności i zasad użycia. Internet Archive nie stanowi automatycznej gwarancji uprawnień do każdego opublikowanego materiału [S16].

### Algorytm wyszukiwania

1. Użytkownik wybiera wynik TMDB z typem, rokiem i plakatem. Dla serialu wskazuje sezon i odcinek.
2. Budujemy zapytania z oryginalnego tytułu, lokalnego tytułu i roku. Dla odcinka dodajemy SxxEyy. Identyfikatory zewnętrzne wykorzystujemy tylko tam, gdzie źródło deklaruje obsługę.
3. Odczytujemy możliwości Torznab przez `caps`; nie zakładamy identycznych kategorii i filtrów. Uruchamiamy maksymalnie 3 zapytania jednocześnie, timeout pojedynczego źródła startowo 12 s, limit całej sesji 20 s. To wartości do strojenia.
4. Wyniki prezentujemy częściowo w miarę napływania. Awaria jednego źródła nie usuwa wyników pozostałych. UI podaje „odpowiedziały 3 z 4 źródeł”.
5. Normalizujemy rozdzielczość, źródło obrazu, kodek, HDR, język audio, rozmiar, seedów i grupę wydania. Brak pola oznacza „nieznane”, nie wartość domyślną.
6. Deduplikujemy po infohash v1/v2 i ich potwierdzonych powiązaniach dla torrentów hybrydowych. Zachowujemy listę źródeł. Same podobne tytuły służą tylko do grupowania kandydatów.
7. Sortujemy najpierw według zgodności tytułu/roku/odcinka, potem preferencji jakości i dostępności. Liczba seedów to informacja od indeksatora, często opóźniona; nie gwarantuje transferu.

Nie sumować seedów tego samego swarma z kilku źródeł. Nie łączyć prywatnych magnetów, trackerów i passkey między kontami. Nie pobierać wszystkich magnetów tylko po to, by wzbogacić listę wyników: powodowałoby to zbędny ruch i ujawnianie zainteresowania wieloma swarmami.

Cache zapytań startowo 5 minut, przycisk odświeżenia, ograniczony backoff z jitterem i obsługa `Retry-After`. Parser nazwy wydania powinien mieć własne testy na realnych, zanonimizowanych nazwach; nie należy budować decyzji wyłącznie na jednym regexie.

## 6 Metadane filmów i seriali

TMDB służy do identyfikacji dzieła oraz prezentacji, nie dostarcza torrentów. Wyszukiwanie i szczegóły to osobne kroki opisane w dokumentacji [S9]. Własny cienki klient HTTP jest wystarczający; dodatkowy wrapper npm nie jest konieczny.

Planowane wywołania API v3: `/search/movie`, `/search/tv`, szczegóły `/movie/{id}` i `/tv/{id}`, sezony oraz odcinki i `external_ids`. Dokładne parametry potwierdzić w specyfikacji przypiętej na etapie implementacji. Preferować polskie opisy z fallbackiem językowym, przechowywać także oryginalny tytuł. Nie utożsamiać numeru ID filmu z ID serialu: kluczem jest para typ + ID.

Wyniki wyszukiwania: cache startowo 15 minut; szczegóły i obrazy 24 godziny z ograniczeniem rozmiaru. Offline dostępna lokalna kolejka i historia, a nie obietnica pełnego katalogu. Numeracja specjalnych odcinków, anime i kolejność DVD mogą różnić się między wydaniem a TMDB; wymagana ręczna korekta mapowania.

TMDB wymaga atrybucji; wykorzystanie komercyjne trzeba uzgodnić z dostawcą. W „O aplikacji” zaplanować zatwierdzone logo oraz wymagany komunikat. Nie traktować klucza w aplikacji desktopowej jako sekretu niemożliwego do wyciągnięcia [S10]. Dla prywatnego MVP można przyjąć własny klucz użytkownika; publiczna dystrybucja wymaga ustalenia modelu kluczy i limitów przed wydaniem.

## 7 Napisy

Pierwszy dostawca: OpenSubtitles.com REST API. Nie opierać nowej integracji na historycznym XML-RPC OpenSubtitles.org. Oficjalny opis usługi potwierdza REST API, a narzędzie dostawcy pokazuje dopasowywanie napisów i zapis obok filmu [S11, S12].

Przed pobieraniem użytkownik wybiera „bez napisów” albo język podstawowy i opcjonalny fallback. Dostępność przed pobraniem oznaczamy jako wstępną. Dopiero plik pozwala zwiększyć pewność dopasowania.

### Pipeline

1. Wyszukanie kandydatów po identyfikatorze dzieła, języku oraz sezonie/odcinku. Nazwa wydania jest dodatkowym sygnałem.
2. Zachowanie listy kandydatów i metadanych. Nie zużywać limitu pobrań na każdy wiersz wyników.
3. Po pobraniu wybranego pliku policzyć hash zgodnie z aktualną specyfikacją OpenSubtitles. Hash napisów nie jest infohashem torrenta. W MVP liczymy go dopiero po zakończeniu pliku.
4. Ponowne dopasowanie: preferować zgodny hash, potem wydanie i wariant materiału, a następnie zgodność nazwy. Samo ID filmu nie potwierdza zgodności czasów.
5. Wybrać właściwy `file_id`, uzyskać link pobrania w API i od razu pobrać plik. Nie przechowywać tymczasowego linku jako trwałego źródła.
6. Sprawdzić limit rozmiaru, format, kodowanie, zgodność języka z odpowiedzią i bezpiecznie zapisać napisy obok konkretnego pliku wideo. Jeśli wejście jest archiwum, rozpakować wyłącznie do kontrolowanego katalogu z limitem rozmiaru i ochroną przed traversal.
7. Niska pewność dopasowania → wybór użytkownika, a nie automatyczne oznaczenie „idealnie dopasowane”. Brak napisów → stan częściowego sukcesu z opcją ponowienia.

Projekt przewiduje wywołania logowania, wyszukiwania napisów i pobrania. Dokładny schemat nagłówków `Api-Key`, `User-Agent`, tokena oraz parametrów wyszukiwania należy zatwierdzić na podstawie bieżącej specyfikacji dostawcy podczas eksperymentu integracyjnego. Strona dokumentacji Stoplight nie udostępniła tu treści pozwalającej zweryfikować cały schemat; nie należy kopiować parametrów ze starego SDK w ciemno [S13].

Kwoty zależą od konta i planu. Nie wpisywać na stałe liczby darmowych pobrań. Czytać limit i czas resetu z odpowiedzi, obsłużyć wygaśnięcie sesji, 429 i niedostępność API. Nie ponawiać bezmyślnie żądania, które mogło już zużyć limit.

Nazewnictwo: przy `Release.Name.mkv` tworzyć `Release.Name.pl.srt`; dla kolejnego języka `Release.Name.en.srt`. Zachować format ASS, jeśli jest potrzebny do stylizowanych napisów; konwersja do SRT nie jest bezstratna. Rozróżniać napisy pełne, forced i SDH. Nie zmieniać pliku wideo ani jego nazwy podczas seedowania. Folder z napisem i filmem jest domyślnym rezultatem; nie muxujemy napisów do MKV.

Alternatywy po MVP: ręczny import SRT/ASS/VTT, ewentualnie adapter drugiego dostawcy po potwierdzeniu API i warunków użycia. Nie obiecywać NapiProjekt, Napisy24 czy innych serwisów bez osobnego researchu. Automatyczna synchronizacja i generowanie napisów przez ASR są poza MVP; FFmpeg nie jest potrzebny do samego pobierania plików i napisów.

## 8 Dysk i trwałość

Każde zadanie dostaje własny folder, np. `Filmy/Tytul (rok)/Wydanie/`. Wewnątrz zachowujemy bezpieczną strukturę torrenta, aby nie utrudniać wznawiania i seedowania. Napisy zapisujemy w tym samym podkatalogu co odpowiadający im plik wideo. Dla seriali logiczny widok sezon/odcinek w aplikacji nie musi wymuszać przenoszenia plików na dysku.

Po pobraniu metadanych silnik pokazuje listę plików. Domyślnie sugerujemy główny plik wideo, pomijamy próbki i pliki wykonywalne. Przy niejednoznaczności użytkownik potwierdza wybór. Pakiet sezonu wymaga mapowania wielu plików do odcinków; w MVP UI może obsłużyć wybór jednego odcinka z pakietu.

Przed startem: prawa do zapisu, wolne miejsce, długość ścieżek, nazwy zastrzeżone Windows, konflikt nazwy i ograniczenia systemu plików. Po metadanych ponownie obliczyć potrzebne miejsce. Pobranie selektywne może wymagać fragmentów współdzielonych z innymi plikami; rozmiar transferu nie zawsze równa się rozmiarowi wybranych plików.

Zapis resume ma być atomowy i okresowy, a także wykonywany na pauzie i zamknięciu. SQLite przechowuje stan produktu, pliki resume stan silnika. Po awarii uzgadniamy oba źródła, sprawdzamy istnienie danych i uruchamiamy recheck, jeśli stan jest niepewny. Nie używać odpowiednika `skipVerify` do niezweryfikowanych danych.

Napisy: zapis do pliku tymczasowego, walidacja, atomowa zmiana nazwy. Nigdy nie nadpisywać pliku użytkownika bez ustalonej polityki. W MVP nie przenosić aktywnego pobrania między woluminami. Odłączony dysk i brak miejsca powodują pauzę z zachowaniem zadania.

## 9 Model danych i stany

| Encja | Najważniejsze pola |
|---|---|
| MediaItem | lokalne ID, typ, TMDB ID, IMDb ID opcjonalnie, tytuły, rok |
| Episode | MediaItem, sezon, odcinek, ID odcinka, wariant numeracji |
| Release | nazwa surowa, pola jakości, rozmiar, hashe, źródła, pewność dopasowania |
| SourceConfig | typ adaptera, endpoint, włączony, stan zdrowia, odwołanie do sekretu |
| DownloadJob | UUID, Release, katalog, wybrane pliki, stan, polityka seedowania, błędy |
| DownloadFile | indeks silnika, ścieżka względna, rozmiar, ukończenie, powiązany odcinek |
| SubtitleTask | plik wideo, język, dostawca, kandydat, stan, dopasowanie, docelowa ścieżka |
| AppSettings | katalog domyślny, preferencje, limity, zachowanie zamknięcia |

Projekt stanów pobrania: `queued`, `fetching_metadata`, `awaiting_file_selection`, `downloading`, `paused`, `checking`, `downloaded`, `seeding`, `stopped`, `error`, `removed`. Stan napisów jest niezależny: `disabled`, `pending`, `searching`, `needs_selection`, `downloading`, `ready`, `not_found`, `quota_exceeded`, `error`.

„Gotowe” oznacza wszystkie wybrane pliki zweryfikowane oraz wszystkie żądane napisy zapisane. „Film gotowy, napisy wymagają uwagi” jest prawidłowym częściowym wynikiem. Seedowanie może trwać po osiągnięciu gotowości. Brak peerów oznacza oczekiwanie, nie natychmiastową awarię.

UI aktualizujemy startowo 2 razy na sekundę. Postęp liczymy dla wybranych plików na podstawie potwierdzonych bajtów, nie całej paczki. Pokazujemy pobrane/łącznie, prędkość pobierania i wysyłania, peerów, etap, ETA i osobny status napisów. Przy zerowej lub niestabilnej prędkości ETA jest nieznane. Baza nie wymaga zapisu każdego odświeżenia paska.

## 10 Biblioteki i narzędzia

| Obszar | Propozycja | Uzasadnienie i weryfikacja |
|---|---|---|
| Desktop i UI | Electron, React, TypeScript, Vite | Lokalny renderer bez potrzeby SSR; Vite ma wsparcie projektów React/TS [S18] |
| Silnik | libtorrent rasterbar, CMake, C++ | Jawnie kontrolowany proces natywny; przypięte wersje źródeł i toolchainu |
| Dostawcy | Node fetch, AbortController | Małe adaptery HTTP zamiast kilku niepewnych wrapperów API |
| Walidacja | Zod | Walidacja DTO i danych IPC na granicach [S19] |
| Zapytania UI | TanStack Query | Cache i stany zapytań; postęp silnika dostarczany osobnym strumieniem zdarzeń [S20] |
| Dane lokalne | SQLite, Drizzle, better-sqlite3 jako kandydat | Migracje i typowane zapytania; binding natywny trzeba przetestować z wybranym Electronem [S21] |
| Parsowanie Torznab | Parser XML z wyłączonymi encjami zewnętrznymi | Konkretną paczkę wybrać po sprawdzeniu utrzymania, limitów i testów złośliwego XML |
| Pakowanie | electron-builder | Binaria i zasoby przez extraResources [S15] |
| Sekrety | Electron safeStorage | Sposób działania zależy od systemu i wersji Electrona [S14] |
| Testy UI | Playwright Electron | API oznaczone jako eksperymentalne; potrzebny smoke test przypiętej wersji [S22] |

Nie utrwalać numerów „latest” z tego dokumentu. W etapie 0 przygotować tabelę dokładnych wersji Electron/Node/React/bindingów/libtorrent/Jackett i lockfile, sprawdzić licencje oraz znane podatności. Budowa aplikacji korzysta z Node dostarczonego przez Electron; Node z komputera dewelopera nie jest dowodem zgodności instalatora.

## 11 Bezpieczeństwo i dystrybucja

Renderer: `nodeIntegration: false`, `contextIsolation: true`, sandbox, restrykcyjne CSP, lokalny interfejs. Dane indeksatorów traktować jako tekst, nie HTML. Preload nie udostępnia dowolnego IPC ani `exec`. Sprawdzać nadawcę i schemat argumentów. Oficjalny przewodnik Electron opisuje te podstawowe granice [S23].

Własne reguły Adrenaline: walidacja ścieżek po normalizacji, zakaz wyjścia poza katalog zadania, ochrona przed symlinkami/reparse points, limity metadanych i archiwów. Nie uruchamiać plików z torrenta. Adresy z wyników traktować jako niezaufane: ograniczać protokoły, sprawdzać przekierowania i dostęp do sieci lokalnej. Wyjątek lokalny dotyczy tylko jawnie skonfigurowanego endpointu Torznab, nie dowolnego URL zwróconego przez indeksator.

Jackett: dołączone wydanie samowystarczalne, jeśli dostępne dla platformy; oddzielny profil Adrenaline, port przypisany do loopback, losowy klucz, health check i kontrolowane zamknięcie. Zabezpieczyć także panel administracyjny, nie tylko API. Nie wystawiać do LAN. Podczas etapu 0 potwierdzić możliwość konfiguracji źródeł bez ręcznej instalacji .NET oraz zakres stabilnego API administracyjnego. Jeśli go zabraknie, kontrolowany ekran konfiguracji lokalnego Jackett jest kompromisem wymagającym decyzji produktowej; sam standard Torznab służy do zapytań, nie pełnej konfiguracji źródeł.

Tokeny i hasła nie trafiają do renderera ani logów. safeStorage chroni zapis lokalny w zakresie możliwości systemu; na Linux trzeba wykrywać brak odpowiedniego magazynu sekretów i zaoferować sesję bez trwałego zapisu [S14]. Nie składać obietnic anonimowości: połączenia P2P ujawniają adres sieciowy peerom, a pobieranie może jednocześnie wysyłać dane.

Instalator zawiera silnik, Jackett i wymagane biblioteki; użytkownik nie instaluje qBittorrent, Pythona ani kompilatora. Binaria poza ASAR. Procesy mają własne katalogi danych, nie zapisują do katalogu instalacji. Windows: podpisany instalator; macOS: podpisanie także helperów i notarization; Linux: uzgodniony format i biblioteki systemowe. Każda platforma wymaga niezależnego testu czystej maszyny.

Aktualizacje instalować dopiero po bezpiecznym zatrzymaniu sesji i zapisie resume. Nie aktualizować samodzielnie Jackett w środku aktywnego wyszukiwania. Wersjonować także definicje źródeł i pozwalać na rollback wadliwej aktualizacji. Nie pobierać wykonywalnych „wtyczek” z dowolnych wyników wyszukiwania.

Jackett publikuje tekst GPL v2, Prowlarr GPL v3; libtorrent ma licencję BSD opisaną na stronie projektu [S3, S24, S25]. Przed dystrybucją trzeba sprawdzić warunki konkretnych wersji i zależności, dołączyć wymagane informacje oraz spełnić obowiązki dotyczące kodu źródłowego. Oddzielny proces nie jest automatycznym rozstrzygnięciem licencji całego produktu. Model komercyjny wymaga również uzgodnienia użycia TMDB i napisów. Produkt powinien obsługiwać treści, do których użytkownik ma uprawnienia; lista źródeł nie zastępuje ich weryfikacji.

## 12 Plan realizacji dla kolejnego agenta

Podane czasy są orientacyjnym nakładem jednego doświadczonego developera przy sprawnym wsparciu AI, nie ofertą ani gwarancją. Zakres Windows MVP: około 6–10 tygodni; największa niewiadoma to pakowanie procesów i utrzymanie integracji.

| Etap | Zakres | Orientacyjnie | Warunek zakończenia |
|---|---|---|---|
| 0 | Test libtorrent, resume, Jackett i API napisów; wersje i licencje | 3–5 dni | Jeden kontrolowany torrent pobrany, wznowiony po awarii; instalator testowy działa na czystym Windows; Torznab i napisy dają zweryfikowane odpowiedzi |
| 1 | Szkielet Electron, IPC, SQLite, katalogi, profile procesów | 3–5 dni | UI bez uprawnień Node, bezpieczny wybór folderu i trwałe zadania |
| 2 | TMDB, film/serial/odcinek, Torznab, normalizacja | 4–7 dni | Co najmniej trzy źródła; wyniki częściowe, deduplikacja, raport błędów |
| 3 | Kolejka, wybór plików, transfer, pauza, resume, postęp | 6–10 dni | Obsługa restartu, braku miejsca i odłączenia dysku; brak utraty danych |
| 4 | OpenSubtitles, języki, dopasowanie, zapis i retry | 4–6 dni | Film z napisami oraz poprawna ścieżka częściowego sukcesu |
| 5 | UX, instalator, aktualizacja, testy regresji i wydanie beta | 5–10 dni | Spełnione kryteria PRD, test czystej maszyny i aktualizacji |

macOS/Linux, pełne pakiety sezonów i drugi dostawca napisów wymagają osobnej estymacji po MVP. Jeśli etap 0 nie potwierdzi wykonalności helpera libtorrent w budżecie, porównać Transmission i ograniczony wariant WebTorrent oraz zapisać nową decyzję architektoniczną. Nie zmieniać silnika po cichu.

### Testy obowiązkowe

Testy domeny: parser wydań, deduplikacja, identyfikacja odcinka, ranking napisów i przejścia stanów. Testy kontraktowe: zapisane odpowiedzi dostawców, puste wyniki, limity, HTML zamiast JSON/XML i zmieniony schemat.

Integracja na kontrolowanym swarmie: magnet z opóźnionymi metadanymi, .torrent, v1/v2/hybrid, pojedynczy plik i pakiet, plik ponad 4 GB, brak peerów, weryfikacja błędnego fragmentu, pauza i awaria procesu. Fixtures obejmują własne dane i materiały dopuszczone do dystrybucji; nie polegamy na dostępności konkretnego komercyjnego filmu.

E2E: wyszukaj tytuł → wybierz wydanie → wybierz język → pobierz → sprawdź plik i napis → zamknij i otwórz aplikację. Osobno: token wygasł, limit napisów, zła numeracja odcinka, katalog tylko do odczytu, brak miejsca, Unicode w ścieżce, usunięty plik i brak jednego źródła.

Testy live dostawców uruchamiać rzadko, respektując limity. CI powinno przede wszystkim używać fixture i własnego swarma, aby awaria publicznego serwisu nie blokowała każdej zmiany UI.

## 13 Decyzje do zatwierdzenia przed implementacją

1. Czy Windows x64 jest właściwą pierwszą platformą?
2. Czy Adrenaline będzie prywatne, otwartoźródłowe, czy komercyjne? Zmienia to model kluczy, dystrybucję i koszty.
3. Czy akceptujemy C++ helper jako koszt solidnego silnika, czy priorytetem jest krótszy eksperyment WebTorrent?
4. Czy konfiguracja źródeł ma być w całości w UI Adrenaline? Rekomendacja: tak; potwierdzić możliwości administracyjne Jackett.
5. Domyślne seedowanie po pobraniu: rekomendowany proponowany limit to ratio 1 albo 60 minut, zależnie od tego, co nastąpi wcześniej; ma być widoczny i edytowalny. To decyzja produktu, nie wymóg protokołu ani gwarancja zgodności z regułami prywatnego trackera.
6. Czy wystarczy pojedynczy odcinek w MVP? Rekomendacja: tak, również wybierany z paczki sezonu; pełna automatyzacja sezonów później.

Agent rozpoczyna od etapu 0 i dokumentu `Adrenaline_Opis_i_wymagania_biznesowe.md`. Nie rozpoczyna od rozbudowanego design systemu, streamingu ani automatyzacji seriali. Dokumenty opisują plan; wykonanie wymaga osobnej sesji implementacyjnej.

## 14 Źródła i zakres weryfikacji

Wszystkie odnośniki sprawdzano 15.10.2026. Źródła to dokumentacja producentów i repozytoria projektów. Research nie obejmował uruchomienia silnika, logowania do API, testów dostępności wskazanych torrentów ani benchmarku. Wartości timeoutów, cache, czasów realizacji i polityk UX są rekomendacjami, nie deklaracjami dostawców.

- [S1 WebTorrent API](https://webtorrent.io/docs) — semantyka pauzy, pliki i zdarzenia.
- [S2 WebTorrent repozytorium](https://github.com/webtorrent/webtorrent) — różnica między przeglądarką a Node.
- [S3 libtorrent](https://www.libtorrent.org/) — biblioteka i licencja.
- [S4 libtorrent manual](https://www.libtorrent.org/manual-ref.html) — fast-resume i BitTorrent v2; korzystać z dokumentacji odpowiadającej wybranej wersji.
- [S5 Transmission RPC](https://github.com/transmission/transmission/blob/main/docs/rpc-spec.md) — protokół sterowania; main nie oznacza stabilnego wydania.
- [S6 qBittorrent Web API](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-%28qBittorrent-5.0%29) — alternatywny klient.
- [S7 Jackett](https://github.com/Jackett/Jackett) — Torznab i lista definicji źródeł.
- [S8 Prowlarr](https://github.com/Prowlarr/Prowlarr) — alternatywny menedżer indeksatorów.
- [S9 TMDB Search and Query](https://developer.themoviedb.org/docs/search-and-query-for-details) — przepływ identyfikacji tytułu.
- [S10 TMDB FAQ](https://developer.themoviedb.org/docs/faq) — atrybucja i wykorzystanie komercyjne.
- [S11 OpenSubtitles About the API](https://opensubtitles.tawk.help/article/about-the-api) — aktualna usługa REST.
- [S12 OpenSubtitles CLI](https://github.com/opensubtitles-dev/opensubs-cli/blob/main/README.MD) — referencyjny workflow napisów i kwoty konta.
- [S13 OpenSubtitles REST docs](https://opensubtitles.stoplight.io/docs/opensubtitles-api/e3750fd63a100-getting-started) — punkt wejścia do specyfikacji; treść schematu wymaga dalszego odczytu na etapie integracji.
- [S14 Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) — magazyn sekretów zależny od platformy.
- [S15 electron-builder Application Contents](https://www.electron.build/docs/contents/) — dołączanie binariów.
- [S16 Internet Archive Metadata API](https://archive.org/developers/md-read.html) — pliki i metadane pozycji.
- [S17 Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process) — izolacja procesów Node.
- [S18 Vite](https://vite.dev/guide/) — narzędzia budowy UI.
- [S19 Zod](https://zod.dev/) — walidacja schematów.
- [S20 TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview) — stan zapytań.
- [S21 Drizzle SQLite](https://orm.drizzle.team/docs/get-started-sqlite) — integracja z SQLite.
- [S22 Playwright Electron](https://playwright.dev/docs/api/class-electron) — automatyzacja testów desktopowych.
- [S23 Electron Security](https://www.electronjs.org/docs/latest/tutorial/security) — granice bezpieczeństwa UI.
- [S24 Jackett LICENSE](https://github.com/Jackett/Jackett/blob/master/LICENSE) — warunki licencyjne.
- [S25 Prowlarr LICENSE](https://github.com/Prowlarr/Prowlarr/blob/develop/LICENSE) — warunki licencyjne.
