# Adrenaline 1.0.0 — desktop jako serwer, Android TV i Samsung Tizen

Data researchu: **16.10.2026**. Status: **plan, bez implementacji TV**. Bazą jest lokalne wydanie `v0.9.0`. Nazwa katalogu zachowana dokładnie według polecenia właściciela (`1.0-andrenalive-tv`); nazwa produktu pozostaje Adrenaline.

## Cel i najważniejszy wniosek

Windows x64 zachowuje dotychczasową wyszukiwarkę, wybór wydań, pobieranie, napisy, listę pobranych plików, ustawienia i aktualizacje. Dochodzi zakładka **TV**, serwer w aplikacji desktopowej oraz dwa instalowalne klienty: **Android TV/Google TV (APK)** i **Samsung Tizen TV (WGT)**. Wyszukiwanie i zlecanie pobrań działa pilotem; silnik, źródła, sekrety i pliki pozostają na komputerze.

Rekomendacja: własne, wąskie API nad istniejącymi serwisami, natywny klient Android TV w Kotlin/Compose for TV/Media3 oraz osobny klient Tizen w TypeScript/React z AVPlay. Jellyfin jest wzorcem rozdzielenia serwera, klientów i negocjacji odtwarzania; nie dokładamy całego serwera Jellyfin ani nie deklarujemy zgodności z jego API.

**„Deploy to TV po IP” jest wykonalne po przygotowaniu urządzenia, nie na dowolnym fabrycznie zamkniętym TV.** ADB wymaga debugowania i zgody/parowania. Samsung wymaga Developer Mode, dopuszczenia komputera i poprawnego podpisania aplikacji; w ścieżce certyfikatu Samsung potrzebny jest DUID urządzenia. Kreator musi prowadzić przez te kroki i później automatyzować instalację. Nie ma potwierdzenia, że jeden uniwersalny WGT da się zainstalować na każdym Samsungu. Źródła i granice tej obietnicy: [research](01-research.md) oraz [deploy](03-deploy-and-packaging.md).

## Kolejność czytania

| Dokument | Zawartość |
| --- | --- |
| [01-research.md](01-research.md) | Dokumentacja producentów, Jellyfin, warianty i ograniczenia |
| [02-architecture-and-api.md](02-architecture-and-api.md) | Mapa istniejącego kodu, serwer, kontrakty, bezpieczeństwo i odtwarzanie |
| [03-deploy-and-packaging.md](03-deploy-and-packaging.md) | Kreator TV, ADB/SDB, podpisy, bundling i wydania |
| [04-implementation-plan.md](04-implementation-plan.md) | Etapy, zależności, pliki, bramki i estymacja |
| [05-acceptance-and-risks.md](05-acceptance-and-risks.md) | Kryteria odbioru, testy, ryzyka i otwarte decyzje |

## Zakres 1.0.0

Wymagania właściciela są obowiązkowe: obie platformy TV, bundle klientów w wydaniu desktopowym, zakładka TV z instalacją po IP, wyszukiwanie/zlecanie pobrań z TV na PC oraz brak regresji desktopu. **Tizen nie może być odłożony na 1.1.** Publikacja w sklepach nie zastępuje wymaganego deploy z desktopu.

Przyjęte założenia planistyczne (do potwierdzenia prototypami, nie są stwierdzeniem gotowej kompatybilności):

- Sieć domowa LAN, jeden komputer i wiele sparowanych TV; bez kont w chmurze, przekierowania portów i dostępu przez Internet.
- Odtwarzanie ukończonych filmów na TV jest częścią sensownej wersji 1.0.0, choć polecenie wprost wymienia szukanie i pobieranie. Plan obejmuje direct play, remux i ograniczony fallback transkodowania do 1080p SDR. Nie obejmuje oglądania niekompletnego torrenta.
- Desktop działa jako serwer, gdy aplikacja jest uruchomiona, także w zasobniku. Nie powstaje osobny Windows Service. Wyłączony/uśpiony PC oznacza niedostępny serwer.
- Kandydat na minimum: Android TV 9/API 28 oraz Samsung z Tizen 6.0/rocznik 2021. To **proponowane minimum**, nie wynik testów ani zmiana kryteriów właściciela. P0 musi sprawdzić rzeczywiste urządzenia i opublikować listę modeli/firmware; starsze modele pozostają niezadeklarowane.
- Jeden domowy katalog/biblioteka, bez profili rodzinnych. TV może zarządzać pobraniami; kasowanie plików z TV domyślnie zabronione, uprawnienie nadaje desktop.
- Nowe UI po angielsku, implementacyjna dokumentacja po polsku zgodnie z D-77. Nie zmieniamy silnika torrent ani zasad napisów D-78.

Poza zakresem: macOS/Linux jako platformy produktu, LG webOS, Apple TV, Fire TV jako gwarantowany target, DLNA/casting, DRM, zdalny dostęp WAN, import całych dysków/bibliotek Jellyfin, 4K HDR transcode, synchronizacja wielu serwerów.

## Warunek rozpoczęcia pełnej implementacji

Najpierw P0: instalacja, ponowna instalacja, trwałość podpisu, połączenie API i odtwarzanie próbki na **fizycznym Android TV i Samsungu**. Szczególnie Tizen: TLS i certyfikaty aplikacji to dwa różne problemy. Jeśli warunki deploy lub transportu okażą się niewykonalne na wybranym sprzęcie, dokumentujemy wynik i zmieniamy projekt przed budową pełnego UI. Wynik emulatora nie zamyka tych bramek.

Nie wykonano teraz instalacji na TV, benchmarku streamingu, testu certyfikatów ani prototypu. Research jest analizą repozytorium i źródeł publicznych; kwestie zależne od sprzętu są jawnie otwarte.
