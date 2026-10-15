> Kopia dokumentu źródłowego z 15.10.2026. Robocza nazwa "XXX" została zastąpiona nazwą **Adrenaline**. Tam, gdzie ten dokument różni się od `docs/implementation-plan/00-decyzje.md`, obowiązują decyzje z planu (m.in. tylko Windows x64, proste testy).

# Adrenaline Opis aplikacji i wymagania biznesowe

Wersja 1.0. Data: 15 października 2026. Status: propozycja zakresu do rozpoczęcia prac. Dokument towarzyszący: `Adrenaline_Plan_techniczny.md`.

## 1 Cel produktu

Adrenaline to aplikacja desktopowa, która prowadzi użytkownika od wyszukania filmu lub odcinka serialu do pobrania wybranego wydania i zapisania dopasowanych napisów w tym samym katalogu. Użytkownik wybiera tytuł, jakość, język napisów i miejsce zapisu. Aplikacja obsługuje wyszukiwanie w wielu źródłach, transfer torrentowy i czytelny postęp bez konieczności instalowania osobnego klienta torrentów.

Główna wartość: ograniczenie ręcznego przełączania się między katalogiem filmów, wyszukiwarkami torrentów, klientem pobierania i serwisem napisów. Adrenaline nie gwarantuje dostępności każdego tytułu ani zgodności wszystkich napisów. Ma jasno pokazywać, co znalazła i jaki jest stan każdego etapu.

Nazwa Adrenaline jest robocza i powinna występować w dokumentacji oraz projekcie do momentu zmiany przez właściciela produktu.

## 2 Użytkownik i jego potrzeba

Podstawowy użytkownik chce pobrać materiał na własny komputer, rozumie wybór jakości typu 1080p lub 4K, ale nie chce samodzielnie integrować kilku narzędzi. Użytkownik zaawansowany może konfigurować źródła i limity, jednak nie powinno to komplikować standardowego pobierania.

Najważniejszy scenariusz biznesowy: „Wpisuję tytuł, wybieram właściwe wydanie i język napisów, klikam Pobierz i widzę postęp. Po zakończeniu otwieram folder z filmem i napisami”.

Przykład interfejsu z „Avengers: Endgame” służy wyłącznie pokazaniu przebiegu. Nie oznacza zapewnienia konkretnej oferty, dostępności torrenta lub napisów. Testy odbiorowe korzystają z kontrolowanych materiałów dopuszczonych do dystrybucji.

## 3 Założenia i decyzje produktowe

| Obszar | Proponowana decyzja | Status |
|---|---|---|
| Typ aplikacji | Desktop, Electron | Zgodne z preferencją użytkownika i wynikiem researchu |
| Pierwszy system | Windows x64 | Założenie do potwierdzenia |
| Konto Adrenaline | Nie jest wymagane | Propozycja MVP |
| Konta dostawców | Mogą być wymagane przez napisy lub wybrane źródła | Zależność zewnętrzna |
| Miejsce pobierania | Dysk wybrany przez użytkownika | Wymagane |
| Silnik | Dostarczony w instalatorze | Wymagane |
| Wieloźródłowe wyszukiwanie | Minimum trzy sprawdzone integracje w wydaniu beta | Proponowany próg odbioru |
| Filmy i seriale | Film oraz pojedynczy odcinek w MVP | Proponowane ograniczenie zakresu |
| Napisy | Jeden wybrany język i opcjonalny fallback | Propozycja MVP |
| Model biznesowy | Nieustalony | Do decyzji przed publiczną dystrybucją |

Aplikacja ma służyć pobieraniu i udostępnianiu materiałów, do których użytkownik ma uprawnienia. Warunki usług, licencje danych i zależności stanowią element przygotowania wydania. Dokument nie rozstrzyga statusu konkretnego materiału.

## 4 Zakres MVP

### Funkcje obowiązkowe

- Wyszukiwanie filmów i seriali z rozpoznaniem tytułu, roku i typu materiału.
- Wybór odcinka przez sezon i numer; szczegóły tytułu i plakat.
- Równoległe wyszukiwanie wydań w kilku źródłach, wyniki częściowe i widoczna kondycja źródeł.
- Lista wydań z jakością, rozmiarem, dostępnością i nazwą źródła; pola nieznane oznaczone wprost.
- Wybór katalogu, języka napisów oraz plików do pobrania.
- Wbudowany transfer, kolejka, pełna pauza, wznowienie i usunięcie zadania.
- Zachowanie zadań po restarcie i odzyskiwanie po awarii.
- Oddzielny status pliku wideo i napisów, ponowienie pobrania samych napisów.
- Otwieranie folderu wyniku, ustawienia transferu, źródeł i kont dostawców.
- Działający instalator, bez wymagania osobnego klienta torrentów.

### Po MVP

Pełne pakiety sezonów z mapowaniem wszystkich odcinków i napisów; wiele języków jednocześnie; macOS i Linux; drugi dostawca napisów; ręczny import napisów; zaawansowana obsługa prywatnych trackerów; import magnet/.torrent; automatyczne monitorowanie nowych odcinków; opcjonalne sterowanie istniejącym klientem na NAS.

### Poza obecnym zakresem

Streaming podczas pobierania, własny odtwarzacz, transkodowanie, automatyczne generowanie i synchronizacja napisów, pobieranie w chmurze, katalog społecznościowy, płatności, aplikacja mobilna i system rekomendacji. Nie są potrzebne do sprawdzenia podstawowej wartości Adrenaline.

## 5 Główny przebieg użytkownika

1. Przy pierwszym uruchomieniu użytkownik ustawia folder, język napisów i źródła. Jeśli dostawca wymaga konta, Adrenaline wyjaśnia to w kontekście danej funkcji.
2. Wpisuje „Avengers endgame”. Wyniki katalogowe pokazują tytuł, rok i plakat, aby odróżnić podobne pozycje.
3. Wybiera film. Adrenaline szuka wydań w aktywnych źródłach i pokazuje postęp wyszukiwania.
4. Wybiera np. wydanie 1080p WEBRip lub 2160p. Jakość obrazu, kodek, język audio i napisy są osobnymi informacjami.
5. Włącza napisy po polsku albo „bez napisów”. Przed pobraniem dostępność może być wstępna.
6. Wskazuje katalog i klika Pobierz. Jeśli magnet nie zawiera listy plików, Adrenaline najpierw pozyskuje metadane. Przy kilku kandydatach prosi o wybór pliku, zamiast pobierać przypadkowy.
7. W widoku pobrań obserwuje procent, liczbę bajtów, prędkość, szacowany czas i osobny status napisów. Może pauzować i wznawiać.
8. Po zakończeniu pliku Adrenaline kończy dopasowanie napisów i zapisuje je obok wideo.
9. Widzi „Gotowe” lub „Film gotowy — napisy wymagają uwagi”. Przycisk Otwórz folder jest dostępny także przy częściowym sukcesie.

Dla serialu przed krokiem 3 dochodzi wybór sezonu i odcinka. Wybór jednego odcinka z paczki nie oznacza zgody na pobranie całego sezonu.

## 6 Ekrany

| Ekran | Zawartość | Najważniejsza akcja |
|---|---|---|
| Start i wyszukiwanie | Pole wyszukiwania, filtry film/serial, wyniki katalogowe | Wybierz tytuł |
| Szczegóły | Plakat, opis, rok; dla serialu sezony i odcinki | Szukaj wydań |
| Wydania | Porównywalne wiersze, filtry, źródła i błędy częściowe | Wybierz wydanie |
| Konfiguracja pobrania | Folder, napisy, pliki, rozmiar i miejsce na dysku | Pobierz |
| Pobrania | Zadania aktywne i zakończone, postęp, błędy i transfer wysyłany | Pauza, Wznów, Otwórz folder |
| Szczegóły zadania | Lista plików, źródła, stan napisów i przyczyna problemu | Ponów napisy lub wybierz inne |
| Ustawienia | Folder, język, źródła, konta, limity, seedowanie, zachowanie zamknięcia | Zapisz i sprawdź połączenie |
| O aplikacji | Wersje, licencje, atrybucje | Diagnostyka i aktualizacja |

Styl wizualny: czytelna lista wydań, wyraźny przycisk głównej akcji, brak blokujących animacji i komunikatów opartych wyłącznie na kolorze. Techniczne szczegóły trackerów i hashy dostępne w szczegółach, a nie wymagane do standardowej obsługi.

## 7 Wymagania funkcjonalne i kryteria odbioru

Priorytet M oznacza obowiązkowe MVP; S oznacza rozszerzenie zalecane po MVP. Identyfikatory należy zachować w backlogu i testach.

| ID | Priorytet | Wymaganie | Kryterium odbioru |
|---|---|---|---|
| FR01 | M | Identyfikacja filmu i serialu | Dla kontrolowanego zapytania wynik pokazuje typ, tytuł, rok i prawidłowe ID; użytkownik może rozróżnić remake |
| FR02 | M | Wybór odcinka | Użytkownik wskazuje sezon i odcinek; wyszukiwanie nie miesza go z innym sezonem bez ostrzeżenia |
| FR03 | M | Wiele źródeł | Co najmniej trzy skonfigurowane adaptery przechodzą test wydania; awaria jednego nie blokuje pozostałych |
| FR04 | M | Deduplikacja | Ten sam potwierdzony infohash z dwóch źródeł daje jeden wynik z informacją o obu źródłach |
| FR05 | M | Porównanie wydań | Wiersz pokazuje rozdzielczość, rozmiar, nazwę wydania i źródła; brakujące pola są oznaczone |
| FR06 | M | Filtry | Działa filtr rozdzielczości i sortowanie według zgodności, rozmiaru lub raportowanej dostępności |
| FR07 | M | Katalog zapisu | Użytkownik wybiera folder; niepoprawny lub niezapisywalny folder blokuje start z czytelnym komunikatem |
| FR08 | M | Wbudowany silnik | Na czystym systemie pobranie działa po instalacji Adrenaline bez osobnego klienta, Pythona lub ręcznej instalacji runtime |
| FR09 | M | Wybór plików | Przy paczce można wybrać jeden plik; próbki i wykonywalne dodatki nie są automatycznie wybierane |
| FR10 | M | Postęp | UI pokazuje postęp wybranych plików i transfer; weryfikacja oraz oczekiwanie na metadane mają własne etapy |
| FR11 | M | Pauza i wznowienie | Po potwierdzeniu pauzy zadanie nie prowadzi aktywnego transferu; wznowienie zachowuje zweryfikowane fragmenty |
| FR12 | M | Restart | Po kontrolowanym zamknięciu i awarii zadanie wraca z folderem, wyborem plików i opcjami napisów |
| FR13 | M | Usuwanie | Domyślnie usuwa się zadanie bez danych; kasowanie plików wymaga osobnego wyboru i obejmuje tylko pliki zadania |
| FR14 | M | Język napisów | Wybór języka jest zapamiętany w zadaniu; fallback nie jest użyty bez ustalonej preferencji |
| FR15 | M | Pobranie napisów | Dla kontrolowanego zgodnego wydania napis trafia obok wideo i ma zgodną nazwę bazową oraz kod języka |
| FR16 | M | Brak lub błąd napisów | Ukończony film pozostaje dostępny; użytkownik może ponowić same napisy bez ponownego pobrania wideo |
| FR17 | M | Ręczny wybór kandydata | Przy niskiej pewności dopasowania dostępna jest lista kandydatów; Adrenaline nie oznacza ich jako gwarantowanie zgodnych |
| FR18 | M | Konfiguracja źródeł | Można włączyć/wyłączyć źródło, sprawdzić połączenie i zobaczyć przyczynę niedostępności |
| FR19 | M | Limity i seedowanie | Widoczny transfer wysyłany oraz ustawienia limitów; reguła zatrzymania po pobraniu działa zgodnie z konfiguracją |
| FR20 | M | Zamknięcie aplikacji | Zamknięcie okna może pozostawić Adrenaline w zasobniku; jawne Zakończ zapisuje stan i zatrzymuje procesy |
| FR21 | M | Otwieranie folderu | Otwiera właściwy folder istniejącego pliku; brak dysku lub usunięty plik daje komunikat |
| FR22 | M | Obsługa kont dostawców | Błędne lub wygasłe dane logowania dają możliwość ponownego połączenia bez utraty kolejki |
| FR23 | S | Pełny sezon | Każdy odcinek otrzymuje własne mapowanie i napisy; pojedynczy błąd nie blokuje reszty |
| FR24 | S | Import ręczny | Można dodać magnet/.torrent oraz lokalny plik napisów z walidacją wejścia |

## 8 Reguły biznesowe

**BR01 — wiele jakości.** 4K jest etykietą rozdzielczości, a nie gwarancją lepszego dźwięku, bitrate czy zgodności z odtwarzaczem. Adrenaline prezentuje odrębnie rozdzielczość, kodek i HDR, jeśli są znane.

**BR02 — kompletność.** Pobranie jest gotowe, gdy wszystkie wybrane pliki zostały zweryfikowane i wszystkie zamówione napisy zapisane. Wyłączone napisy nie blokują gotowości. Seedowanie jest stanem transferu niezależnym od gotowości plików.

**BR03 — częściowy sukces.** Brak napisów, przekroczony limit lub błąd dostawcy nie usuwa pobranego filmu i nie wymusza ponownego pobrania wideo.

**BR04 — brak podmiany wydania.** Adrenaline nie zastępuje wybranego torrenta innym wydaniem bez decyzji użytkownika. To samo dotyczy języka napisów i wersji reżyserskiej filmu.

**BR05 — prywatność.** Historia i ustawienia pozostają lokalne. Telemetria produktu nie jest wymagana do działania; ewentualna diagnostyka wysyłana w przyszłości powinna być dobrowolna i pozbawiona tytułów, magnetów, tokenów oraz pełnych ścieżek.

**BR06 — seedowanie.** Pobieranie P2P może równocześnie wysyłać dane. UI przedstawia to wprost. Proponowany domyślny limit po pobraniu: ratio 1 albo 60 minut, co nastąpi wcześniej; właściciel produktu zatwierdza tę propozycję. Zaawansowane reguły prywatnych trackerów nie są gwarantowane w MVP.

**BR07 — ochrona danych użytkownika.** Ponowne kliknięcie Pobierz nie tworzy duplikatu tego samego zadania. Konflikt ścieżki nie powoduje cichego nadpisania istniejących plików.

**BR08 — wiarygodność statusu.** Brak wyników i brak odpowiedzi źródeł to różne stany. Liczba seedów ma datę obserwacji; brak peerów nie oznacza, że film nie istnieje.

## 9 Wymagania niefunkcjonalne

Poniższe wartości są proponowanymi celami odbioru na uzgodnionym komputerze testowym, np. Windows x64, SSD i 16 GB RAM. Nie stanowią gwarancji czasu odpowiedzi usług zewnętrznych.

| ID | Obszar | Cel i sposób sprawdzenia |
|---|---|---|
| NFR01 | Responsywność | Reakcja lokalnego UI na akcję poniżej 200 ms w 95% pomiarów przy trzech aktywnych pobraniach |
| NFR02 | Postęp | Aktualizacja wskaźników co około 500 ms; przy utracie procesu UI pokazuje brak aktualnych danych |
| NFR03 | Wyszukiwanie | Wyniki dostawcy pojawiają się w UI do 1 s od odebrania; sesja ma ograniczony timeout i wyniki częściowe |
| NFR04 | Trwałość | 20 kontrolowanych cykli restartu/awarii nie gubi zadań; niepewne dane są ponownie weryfikowane |
| NFR05 | Dysk | Brak miejsca, utrata dostępu i odłączenie nośnika zatrzymują zapis bez usuwania zadania |
| NFR06 | Bezpieczeństwo | Niezaufana nazwa pliku nie pozwala zapisać poza folderem zadania; pobrany program nie zostaje uruchomiony |
| NFR07 | Izolacja | UI nie ma bezpośredniego dostępu do systemu plików ani sekretów; lokalne usługi nie są dostępne z LAN |
| NFR08 | Dostępność | Główna ścieżka działa z klawiatury, elementy mają etykiety, komunikaty nie opierają się tylko na kolorach |
| NFR09 | Utrzymanie | Adapter dostawcy można naprawić bez zmiany modeli UI; błędy mają stabilne kody |
| NFR10 | Instalacja | Test czystego systemu oraz aktualizacji zachowującej kolejkę; usunięcie aplikacji nie kasuje filmów domyślnie |
| NFR11 | Zasoby | Zużycie pamięci jest mierzone dla 1 i 3 pobrań; nie rośnie liniowo z całym rozmiarem pobieranego filmu |
| NFR12 | Język | Polski interfejs MVP, prawidłowy Unicode w nazwach i ścieżkach; przygotowane zasoby do późniejszych tłumaczeń |

## 10 Sytuacje wyjątkowe

| Sytuacja | Oczekiwane zachowanie |
|---|---|
| TMDB niedostępne | Informacja o awarii katalogu; istniejące pobrania nadal działają |
| Jedno źródło nie odpowiada | Wyniki pozostałych pozostają widoczne, stan źródła wskazuje błąd |
| Wszystkie źródła nie odpowiadają | „Nie udało się przeszukać źródeł”, zamiast „Brak filmu” |
| Magnet bez metadanych | Osobny etap z możliwością anulowania i ponowienia |
| Brak peerów | Stan oczekiwania, bez fikcyjnego ETA i bez zmiany torrenta |
| Za mało miejsca | Pauza, wymagane i dostępne miejsce, możliwość ponowienia po zwolnieniu dysku |
| Niedopasowane napisy | Wybór innego kandydata; brak deklaracji idealnego dopasowania |
| Limit napisów | Film nadal dostępny; informacja o limicie i resecie, jeśli dostawca go podaje |
| Plik usunięty poza Adrenaline | Status brakującego pliku i możliwość sprawdzenia lub ponowienia |
| Awaria silnika | UI pozostaje dostępne; kontrolowane wznowienie albo komunikat wymagający działania |
| Konflikt nazwy | Zachowanie istniejących danych, wybór nowego katalogu lub kontrolowanej nazwy |

## 11 Mierniki sukcesu

Pierwszym celem jest zakończenie podstawowej ścieżki bez użycia dodatkowych programów. Test z kilkoma osobami powinien sprawdzić, czy rozumieją różnicę między wyborem tytułu a wydania oraz między gotowym filmem a oczekiwaniem na napisy.

Proponowane mierniki beta:

- Co najmniej 4 z 5 uczestników samodzielnie kończy kontrolowany scenariusz od wyszukania do otwarcia folderu.
- 100% testów kontrolnego swarma zachowuje integralność ukończonych plików.
- 100% obowiązkowych przypadków błędu ma zrozumiały komunikat i dostępną dalszą akcję.
- Dla próbki przygotowanych zgodnych napisów wszystkie pliki trafiają do właściwych katalogów i odcinków.
- Odrębnie mierzymy sukces techniczny pobierania, dostępność wydań oraz trafność napisów; nie ukrywamy awarii w jednej liczbie.

Nie definiować obietnicy „99% filmów dostępnych” bez reprezentatywnego badania źródeł. Pomiar może być lokalny w testach; nie wymaga automatycznej telemetrii użytkowników.

## 12 Koszty i zależności biznesowe

Przy lokalnym modelu transfer plików nie przechodzi przez serwer Adrenaline. Nadal istnieją koszty utrzymania: podpisywanie aplikacji, infrastruktura wydań, aktualizacje zależności, naprawy źródeł, obsługa użytkowników i ewentualne płatne warunki API.

TMDB rozróżnia użycie niekomercyjne i komercyjne oraz wymaga atrybucji [B1]. OpenSubtitles stosuje model kont i limitów opisany przez dostawcę [B2, B3]. Właściciel produktu musi zdecydować, czy użytkownik korzysta z własnych kont, czy Adrenaline zawiera uzgodnioną integrację produktową. Nie ustalono ceny ani abonamentu Adrenaline.

Warunek publikacji: zakończony przegląd dystrybucji dołączanych bibliotek i usług. Liczba wspieranych źródeł powinna rosnąć zgodnie z możliwością ich utrzymania, nie tylko liczbą dostępnych definicji.

## 13 Kolejność prac i definicja gotowości

1. Potwierdzenie najtrudniejszych integracji: silnik, wznowienia, instalator, wiele źródeł i napisy.
2. Pionowa ścieżka jednego filmu od wyboru do folderu.
3. Wyszukiwanie wieloźródłowe, seriale z pojedynczym odcinkiem oraz obsługa błędów.
4. Uporządkowanie UI, ustawień, instalacji i aktualizacji.
5. Beta, ocena mierników i decyzja o rozbudowie.

MVP można uznać za gotowe, gdy wszystkie FR z priorytetem M i NFR mają zaliczone testy albo jawnie zaakceptowane odstępstwo, podstawowy scenariusz działa na czystym systemie, a dokumentacja użytkownika wyjaśnia źródła, konta, seedowanie i status napisów. Sama demonstracja UI z symulowanym postępem nie spełnia kryterium.

## 14 Otwarte decyzje

- Docelowy pierwszy system i lista późniejszych platform.
- Prywatny projekt, open source czy produkt komercyjny.
- Ostateczna polityka seedowania oraz domyślne zachowanie przy zamknięciu okna.
- Własne klucze i konta użytkownika czy integracja uzgodniona dla Adrenaline.
- Czy konfiguracja każdego źródła musi mieścić się w UI Adrenaline już w pierwszej wersji.
- Czy pełne sezony muszą wejść do pierwszego wydania; obecny plan zakłada pojedyncze odcinki.

Brak tych decyzji nie uniemożliwia eksperymentu technicznego, lecz może zmienić zakres i koszt wydania. Agent implementujący powinien zachować rozdział między wymaganiami użytkownika, proponowanymi ustawieniami domyślnymi i ograniczeniami dostawców.

## 15 Źródła zewnętrznych zależności

Wymagania, scenariusze i progi odbioru są opracowaniem projektowym dla Adrenaline. Fakty o usługach oparto na źródłach sprawdzonych 15.10.2026; szczegółowy research i lista technicznych źródeł znajdują się w dokumencie towarzyszącym.

- [B1 TMDB FAQ](https://developer.themoviedb.org/docs/faq) — zasady atrybucji i model komercyjny.
- [B2 OpenSubtitles About the API](https://opensubtitles.tawk.help/article/about-the-api) — usługa API i model dostępu.
- [B3 OpenSubtitles CLI](https://github.com/opensubtitles-dev/opensubs-cli/blob/main/README.MD) — informacje o koncie, limitach i przebiegu pobierania napisów.
- [B4 Jackett](https://github.com/Jackett/Jackett) — integracje źródeł; istnienie definicji nie potwierdza dostępności konkretnej treści.
