# Adrenaline — instrukcja użytkownika

## Pierwsze uruchomienie

W kreatorze wybierz folder na filmy, język napisów i ewentualny język zastępczy. Język zastępczy jest używany tylko wtedy, gdy nie ma wyników dla podstawowego. „Bez napisów” wyłącza ich wyszukiwanie dla nowego pobrania.

W Ustawieniach → Konta zapisz własny klucz API v3 lub token odczytu TMDB. Bez niego katalog jest niedostępny; istniejące pobrania nadal działają. Konto TMDB i klucz można uzyskać na themoviedb.org w ustawieniach konta, w sekcji API.

Do napisów potrzebujesz klucza API OpenSubtitles.com oraz loginu i hasła do tego serwisu. Zapisz je, a następnie użyj „Sprawdź OpenSubtitles”. Zobaczysz pozostały limit. Sam test połączenia nie pobiera napisów. „Wyloguj i usuń hasło” usuwa zapisaną sesję i hasło. Dane konta pozostają na komputerze i są szyfrowane magazynem Windows; gdy szyfrowanie jest niedostępne, aplikacja wyraźnie informuje o zapisie tylko do końca sesji.

## Od tytułu do pobrania

Wyszukaj tytuł i sprawdź rok, aby odróżnić remake. W serialu wybierz sezon i pojedynczy odcinek. „Szukaj wydań” pokazuje konkretne pliki z dostępnych źródeł. Porównaj rozdzielczość, źródło, rozmiar i seedy; nieznana wartość nie oznacza zera. Liczba seedów pochodzi z ostatniej odpowiedzi źródła i nie gwarantuje transferu.

Wybierz wydanie, folder, język napisów i zasady seedowania. Przy konflikcie nazwy wybierz inny folder lub proponowany numerowany wariant. Magnet może najpierw pobierać metadane. Jeśli pliki wymagają potwierdzenia, wybierz właściwy plik w szczegółach zadania. Pliki wykonywalne i próbki nie są automatycznie wybierane.

Używaj źródeł i materiałów, do których masz uprawnienia. Dostępność tytułu w katalogu TMDB nie oznacza dostępności wydania w źródłach.

## Źródła

Ustawienia → Źródła pozwalają włączyć i sprawdzić indeksatory albo dodać własny endpoint Torznab z kluczem API. Jackett jest dołączony do instalatora i działa lokalnie, bez osobnej instalacji .NET. Awaria jednego źródła nie usuwa wyników innych. Przy awarii wszystkich źródeł aplikacja pokazuje błąd wyszukiwania. Niektóre źródła mogą wymagać własnego konta albo być niedostępne w danej sieci.

## Pobrane, pauza i seedowanie

Na ekranie Pobrane widzisz postęp wybranych plików, prędkość i stan zadania. „Wstrzymaj” czeka na potwierdzenie silnika. „Wznów” korzysta z pobranych danych. Po restarcie aplikacja przywraca zadania; podczas restartu silnika postęp jest oznaczony jako nieaktualny. Brak peerów oznacza oczekiwanie, nie obietnicę czasu ukończenia.

Seedowanie to udostępnianie już pobranych fragmentów innym uczestnikom. Film może być gotowy podczas seedowania. W Ustawieniach lub przy tworzeniu zadania ustaw limit proporcji wysłanych do pobranych danych albo czasu. Po osiągnięciu limitu wysyłanie ustaje.

„Otwórz folder” pokazuje plik w Eksploratorze. „Usuń” domyślnie usuwa zadanie z listy, zachowując pliki. Opcja usunięcia plików dotyczy plików torrenta wskazanych w potwierdzeniu; osobno zapisane napisy pozostają w folderze. Adrenaline nie uruchamia pobranych plików wykonywalnych.

## Napisy

Napisy są wyszukiwane dopiero po ukończeniu pliku wideo. Zgodność skrótu pliku daje najwyższą pewność; silna zgodność wydania może także pozwolić na automatyczny wybór. Przy niepewności lub kilku równorzędnych wynikach wybierz kandydata w szczegółach zadania. Oznaczenie SDH dotyczy napisów dla niesłyszących, a „Tylko obcojęzyczne fragmenty” oznacza niepełne napisy.

Gotowe napisy są zapisywane obok wideo, np. Film.pl.srt. Istniejący plik pozostaje zachowany; następny otrzymuje nazwę Film.pl.2.srt. Nazwa i zawartość wideo nie zmieniają się. Napisy są zapisywane w UTF-8.

„Film gotowy — napisy wymagają uwagi” oznacza, że wideo można już otworzyć, ale brakuje napisów, wystąpił błąd albo potrzebny jest wybór. „Szukaj napisów ponownie” nie pobiera ponownie filmu. Możesz też zmienić język tylko dla tego zadania. Po wyczerpaniu limitu poczekaj do wskazanej daty resetu. Timeout pobrania może zużyć limit dostawcy, dlatego aplikacja nie ponawia go automatycznie.

## Błędy i dane

Przy braku miejsca zwolnij przestrzeń i wznów zadanie. Po odłączeniu dysku podłącz go pod tą samą ścieżką. Jeżeli plik usunięto poza Adrenaline, sprawdź pliki w szczegółach; silnik może pobrać brakujące fragmenty. Błędy mają polski opis i sugerowaną akcję.

Ustawienia, baza zadań, dane wznowienia i logi znajdują się w profilu aplikacji Windows, zwykle %APPDATA%\adrenaline. Filmy i napisy są w wybranym folderze pobierania. „O aplikacji → Otwórz folder logów” prowadzi do logów. „Kopiuj diagnostykę” kopiuje wersje, stany procesów, liczbę zadań i kody błędów; pomija tytuły, ścieżki, adresy źródeł i sekrety.

## Zamknięcie, aktualizacje i odinstalowanie

Domyślnie zamknięcie okna chowa aplikację do zasobnika. „Zakończ” w zasobniku zapisuje stan i zatrzymuje procesy. To zachowanie można zmienić w Ustawieniach.

Aktualizacje są pobierane w tle. Kliknij baner ponownego uruchomienia, aby je zainstalować; zadania zostaną zachowane. Stan i ręczne sprawdzenie są w „O aplikacji”. Publiczny kanał aktualizacji wymaga publicznego repozytorium projektu.

Odinstalowanie usuwa aplikację, ale zachowuje filmy, napisy i profil użytkownika. Jeśli chcesz usunąć także profil, zrób to ręcznie po zamknięciu Adrenaline, zachowując wcześniej potrzebne dane.
