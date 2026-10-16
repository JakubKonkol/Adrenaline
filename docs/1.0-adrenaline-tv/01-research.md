# Research i wybór technologii

Weryfikacja źródeł: 16.10.2026. Linki prowadzą do dokumentacji producentów i oficjalnych repozytoriów. Dokumentacja i gałęzie upstream mogą się zmieniać; przed implementacją przypiąć wersje SDK i rewizje analizowanego kodu. Wnioski projektowe poniżej są rekomendacjami dla Adrenaline, nie obietnicami producentów.

## Jellyfin: co wykorzystać jako wzorzec

[Jellyfin server](https://github.com/jellyfin/jellyfin) to backend i API oddzielone od aplikacji klienckich. Adrenaline ma już własną domenę pobierania; uruchamianie drugiego, kompletnego serwera oznaczałoby drugą konfigurację, bazę i cykl życia. Z tego wynika wybór własnego małego API, a nie hostowania Jellyfin.

[Jellyfin Android TV](https://github.com/jellyfin/jellyfin-androidtv) jest osobnym klientem. [Jellyfin Tizen](https://github.com/jellyfin/jellyfin-tizen) pakuje zbudowany interfejs jellyfin-web w aplikację TV. Instrukcja Tizen pokazuje budowę WGT, połączenie SDB, instalację CLI i problemy certyfikatów. To potwierdza wzorzec lokalnie zbundlowanego klienta; nie dowodzi możliwości automatycznej instalacji na nieprzygotowanym TV ani zgodności z API Adrenaline.

[Quick Connect](https://jellyfin.org/docs/general/server/quick-connect/) pokazuje wygodę zatwierdzania logowania na innym urządzeniu. W Adrenaline proponujemy krótkotrwałe żądanie parowania zatwierdzane na desktopie. Nie kopiujemy protokołu ani nie traktujemy samej znajomości IP jako autoryzacji.

[Sieć Jellyfin](https://jellyfin.org/docs/general/post-install/networking/) rozdziela port HTTP/HTTPS od odkrywania serwera przez UDP. Dla Adrenaline odkrywanie pozostaje dodatkiem; ręczne wpisanie adresu serwera musi działać nawet przy blokowanym multicast/broadcast. Nie zajmujemy domyślnych portów Jellyfin.

[Transcoding](https://jellyfin.org/docs/general/post-install/transcoding/) i [codec support](https://jellyfin.org/docs/general/clients/codec-support/) rozróżniają odtwarzanie bez zmian, zmianę kontenera i przetwarzanie ścieżek. Wniosek: rozszerzenie `.mkv` lub deklaracja „HEVC supported” nie wystarcza. Plan odtwarzania musi uwzględniać kontener, kodeki, profil, bitrate, audio, napisy i urządzenie.

Repozytoria [serwera](https://github.com/jellyfin/jellyfin/blob/master/LICENSE) i [Android TV](https://github.com/jellyfin/jellyfin-androidtv/blob/master/LICENSE) zawierają GPL. Obecny `package.json` Adrenaline ma `UNLICENSED`. Rekomendacja organizacyjna: inspiracja architekturą, własna implementacja; przed kopiowaniem kodu osobno ocenić licencję danego pliku i sposób dystrybucji. Nie zakładamy, że „open source” pozwala bezwarunkowo wkleić komponenty do aktualnego produktu.

## Android TV / Google TV

Oficjalne [Compose for TV](https://developer.android.com/training/tv/playback/compose) dostarcza elementy interfejsu przeznaczone do pilota i widocznego fokusu. [Tworzenie aplikacji TV](https://developer.android.com/training/tv/get-started/create) opisuje manifest, launcher TV i wymagania urządzeń. Rekomendacja: Kotlin, Compose for TV, Media3 ExoPlayer, MediaSession; osobny projekt Gradle w `tv/android`.

[Media3 supported formats](https://developer.android.com/media/media3/exoplayer/supported-formats) rozdziela obsługę kontenera od dekodowania zależnego od urządzenia. Dlatego APK nie obiecuje wszystkich kodeków: raportuje możliwości i korzysta z serwerowego planu odtwarzania. Brak lokalnego torrenta, Jackett i kont dostawców.

[ADB](https://developer.android.com/tools/adb) obsługuje instalację APK i wskazanie konkretnego urządzenia przez `-s`. Dokumentacja wireless debugging podaje Android 13+ dla TV i parowanie kodem/QR. Nie należy przenosić progu Android 11 dla telefonów na telewizory. Starsza ścieżka TCP/IP zwykle wymaga wcześniejszego USB lub opcji producenta. IP i port parowania mogą różnić się od portu właściwego połączenia; `5555` nie jest uniwersalne. Wniosek: kreator rozpoznaje oba warianty, a nie zakłada otwartego ADB.

[App signing](https://developer.android.com/studio/publish/app-signing) uzasadnia stałą tożsamość podpisu i zarządzanie kluczem wydania. Budujemy release APK, nie AAB do instalacji ADB. Tożsamość pakietu i klucz muszą przetrwać aktualizacje. [Network security configuration](https://developer.android.com/privacy-and-security/security-config) wymaga świadomej polityki HTTP/TLS; nie wyłączamy globalnie walidacji certyfikatów.

## Samsung Tizen

Oficjalna ścieżka to aplikacja webowa WGT. [Application Testing Q&A](https://developer.samsung.com/smarttv/develop/faq/application-testing.html) opisuje ograniczenia pakietów i błędy instalacji. [TV Device](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html) wymaga wspólnej sieci, Developer Mode i konfiguracji hosta. Układ menu zależy od generacji TV; kreator powinien wskazywać instrukcję dla modelu, a nie utrwalać jeden zrzut jako uniwersalny.

[Creating Certificates](https://developer.samsung.com/smarttv/develop/tools/additional-tools/vscode/creating-certificates.html) opisuje certyfikat autora, dystrybutora i DUID urządzenia. Z tego wynika najważniejsze ograniczenie bundlingu: można dołączyć gotowe zasoby klienta, ale podpisanie instalowalnego WGT może wymagać lokalnego profilu użytkownika. Jeden wspólny prywatny klucz autora w instalatorze byłby niewłaściwym rozwiązaniem. Trzeba zachować lokalną tożsamość podpisu do kolejnych aktualizacji.

[Web Engine Specifications](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html) pokazuje duże różnice: Tizen 6.0 (2021) korzysta z Chromium M76, a Tizen 10.0 (2026) z M130. Desktopowy build Vite dla nowego Electron nie jest automatycznie kompatybilny z TV. Potrzebny osobny target, kontrola zależności, polyfille tylko tam, gdzie konieczne, zgodne CSS i test na najstarszym wspieranym sprzęcie. Rekomendujemy React z prostym routingiem TV; nie wymagamy ponownego użycia obecnego React Router 8 na starym silniku.

[AVPlay guide](https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-avplay.html) i [AVPlay API](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html) dają dostęp do natywnego odtwarzania. Trzeba poprawnie obsłużyć stany `open → prepareAsync → play`, seek, pauzę i zwolnienie zasobów. Obsługi zaufania TLS ani własnych nagłówków nie wolno zakładać na podstawie działania `fetch`; warstwa AVPlay jest osobna. P0 testuje oba stosy na realnym TV.

[Remote Control](https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html) oraz [konfiguracja WGT](https://developer.samsung.com/smarttv/develop/guides/fundamentals/configuring-tv-applications.html) są podstawą obsługi klawiszy i uprawnień. Niektóre klawisze multimedialne wymagają rejestracji; Back/Return musi zachowywać się sensownie w menu i playerze. [Media Specifications](https://developer.samsung.com/smarttv/develop/specifications/media-specifications.html) prowadzi do tabel dla roczników — brak wspólnej gwarancji DTS/TrueHD/HDR dla całej rodziny Samsung.

[Samsung distribution](https://developer.samsung.com/tv-seller-office/guides/applications/distributing-application.html) opisuje oddzielny proces dystrybucji sklepowej. Jest alternatywą długoterminową, ale nie usuwa zależności i ograniczeń wymaganego sideloadingu 1.0.0.

## Porównanie wariantów

| Wariant | Zalety | Koszt / wada | Decyzja |
| --- | --- | --- | --- |
| Własne API + Android native + Tizen web | Natywne odtwarzacze i sterowanie; mała ingerencja w backend | Dwa UI, Kotlin i TS | Rekomendowany |
| Wspólne TV web UI + Android WebView/Media3 bridge | Większe współdzielenie UI | Fokus, klawiatura, lifecycle i bezpieczeństwo mostka; dodatkowy prototyp | Zapasowy, jeśli P0 wykaże przewagę |
| Cały Jellyfin jako sidecar | Gotowa biblioteka/transcoding i ekosystem | Drugi serwer, konfiguracja, użytkownicy, synchronizacja; klienci nie znają pobierania Adrenaline | Odrzucony dla 1.0 |
| Fork klientów Jellyfin | Dojrzałe UI/odtwarzanie | Silne związanie z Jellyfin API i obowiązki licencyjne | Odrzucony bez osobnej decyzji |
| Przeglądarka TV / casting / DLNA | Szybki pokaz odtwarzania | Nie spełnia instalowalnego klienta i całej obsługi wyszukiwania/pobrań | Nie zastępuje celu |

## Nierozstrzygnięte przez dokumentację

Nie ustalono modeli TV właściciela, praw do redystrybucji wybranych binariów SDK, sposobu zaufania lokalnemu HTTPS w AVPlay ani trwałości developerskiej instalacji na docelowym firmware. Nie przypisujemy certyfikatom/Developer Mode jednej uniwersalnej daty ważności. W P0 zebrać konkretny model, wersję, wynik testu i komunikat narzędzia. [Licencje FFmpeg](https://ffmpeg.org/legal.html) zależą również od konfiguracji kompilacji; trzeba wybrać i udokumentować dokładny build przed dołączeniem go do instalatora.
