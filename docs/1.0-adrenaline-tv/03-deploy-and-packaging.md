# Deploy to TV, bundle i wydania

Instalacja i parowanie są osobnymi operacjami. ADB/SDB służy tylko do deploy; po instalacji aplikacja TV komunikuje się zwykłym API LAN. Wyłączenie debugowania nie może przerwać korzystania z aplikacji. Procedury platformowe wynikają ze źródeł opisanych w [research](01-research.md).

## Zakładka TV w desktopie

Elementy: włącznik serwera, adres PC/port i status, lista sparowanych urządzeń, uprawnienia, ostatnie połączenie, wersja klienta, Revoke, Update oraz **Deploy to TV**. Widoczna informacja, że komputer musi pozostać uruchomiony. Lista interfejsów wyklucza przypadkowe wskazanie loopback/VPN zamiast LAN; użytkownik może wybrać interfejs.

Kreator:

1. Wybór Android TV albo Samsung Tizen, adres IP telewizora i opcjonalny port. Walidacja jako adres, nie ciąg polecenia. Pierwszy zakres: prywatne IPv4 unicast; IPv6 poza baseline do osobnego testu. Bez skanowania całej sieci.
2. Preflight: serwer PC gotowy, pakiet właściwej platformy i hash poprawny, narzędzie dostępne, limit czasu połączenia, wersja/model o ile odczytywalne. Pokazać osobno IP PC i TV.
3. Instrukcja Developer Mode i autoryzacji właściwa dla platformy; stan `Action required`, nie generyczny błąd.
4. Android: pairing/authorization. Tizen: profil certyfikatu/DUID/permit, lokalne podpisanie bundle.
5. Instalacja ze stanami `Connecting → Awaiting authorization → Preparing package → Installing → Launching → Pairing → Ready`. Użytkownik widzi etap, możliwość anulowania i ponowienia.
6. Uruchomienie klienta, podanie/wykrycie adresu PC, zatwierdzenie parowania w desktopie. Sukces dopiero po autoryzowanym handshake aplikacji, nie po samym exit code narzędzia.

Każdy etap ma timeout, czytelny kod błędu i instrukcję naprawy. Rozróżnić: timeout sieci, zły port, `unauthorized`, niezgodny podpis, brak miejsca, brak DUID, wygasły certyfikat, blokadę firewall i niezgodne API. Anulowanie kończy własny proces; nie resetuje wszystkich urządzeń ADB użytkownika.

## Android

Bundle zawiera podpisany `Adrenaline-TV-<version>.apk`. Stały application ID (propozycja `com.jakubkonkol.adrenaline.tv`), monotonny `versionCode`, `versionName` z wersji wydania. Manifest: launcher TV/Leanback, banner, brak wymaganego touch, minimalne uprawnienia sieciowe. P0 przypina min/target SDK i biblioteki.

Przebieg sterowany adapterem narzędzia (przykłady składni, nie komendy wykonywane podczas tego researchu):

```text
adb pair <TV_IP>:<PAIRING_PORT>
adb connect <TV_IP>:<CONNECT_PORT>
adb -s <EXACT_SERIAL> install -r <LOCAL_RELEASE_APK>
adb -s <EXACT_SERIAL> shell am start -n <FIXED_PACKAGE>/<FIXED_ACTIVITY>
```

Kod parowania podawać interaktywnie przez stdin, bez zapisywania w logach/argumentach procesu. W starszym wariancie krok `pair` nie występuje; użytkownik akceptuje klucz ADB na TV, a port zależy od producenta. Nigdy nie wybierać „pierwszego urządzenia” ani nie zakładać `5555`. Nie oferować `adb tcpip` bez wcześniejszej legalnej, działającej ścieżki debugowania.

Aktualizacja przez `install -r`, tylko z tym samym podpisem i poprawnym versionCode. Błąd podpisu nie uruchamia automatycznego uninstall, bo utraciłby dane/parowanie. Klucz release APK tylko w sekretach CI z kopią odzyskiwania; klucz debug oddzielny.

## Tizen

W instalatorze dostarczamy **gotowe zbudowane zasoby aplikacji TV, config.xml i manifest hashy**, bez potrzeby Node/npm na komputerze użytkownika. Docelowy WGT powstaje przez lokalne podpisanie tych zasobów właściwym profilem. Jeżeli P0 potwierdzi działanie pre-signed WGT na określonej klasie urządzeń, można dodać go jako szybszą ścieżkę; nie jest to założenie uniwersalne.

Pierwsza konfiguracja wymaga Developer Mode, adresu hosta PC w TV i ewentualnego restartu według instrukcji Samsunga. Następnie profil autora/dystrybutora, DUID TV i permit. Konto Samsung/certyfikat tworzone w oficjalnym narzędziu; Adrenaline nie zbiera hasła konta Samsung. Kreator może prowadzić użytkownika do Certificate Manager i wznawiać pracę po utworzeniu profilu.

Przykładowe kroki CLI, do potwierdzenia na przypiętej wersji SDK:

```text
sdb connect <TV_IP>
sdb devices
tizen install-permit -t <EXACT_TARGET>
tizen package -t wgt -s <LOCAL_CERTIFICATE_PROFILE> -o <OUTPUT_DIR> -- <BUNDLED_WEB_DIR>
tizen install -n <SIGNED_WIDGET.wgt> -t <EXACT_TARGET>
```

Uruchomienie po instalacji: zweryfikowana komenda CLI dla stałego application ID lub ręczne otwarcie ikony na TV, jeśli firmware ogranicza launch. Parametry, sposób przekazania profilu oraz rzeczywiste wymagania `install-permit` rozstrzyga P0. Nie składać command line ze swobodnego tekstu użytkownika. Stałe package ID i author identity są warunkiem aktualizacji; DUID/certyfikat dystrybutora mogą wymagać odnowienia i ponownego pakowania.

Prywatny klucz autora i hasło nie trafiają do repo, GitHub Release ani uniwersalnego instalatora. Lokalny profil z kontrolą ACL, hasło w safeStorage; brak haseł w stdout i telemetryce. Wskazać użytkownikowi backup certyfikatu autora. Zmiana IP PC może wymagać aktualizacji hosta Developer Mode; nie rozparowuje automatycznie tożsamości serwera API.

## Narzędzia i granica obietnicy „bundled”

Trzy oddzielne kategorie:

| Artefakt | Dostarczenie | Bramka |
| --- | --- | --- |
| APK i zasoby Tizen | Obowiązkowo w instalatorze 1.0.0, także bez pobierania przy każdym deploy | Weryfikacja hashy i kompletności release |
| ADB / SDB / Tizen CLI / runtime wymagany przez SDK | Przypięty toolchain; bundle tylko jeśli warunki wybranego wydania pozwalają, inaczej wykrycie oficjalnej instalacji lub kontrolowany setup | P0: licencje, redystrybucja, rozmiar, zależności i czysty Windows |
| Podpis APK / profil Tizen użytkownika | APK podpisany w CI; Tizen podpisany lokalnie dla urządzenia | P0: instalacja i upgrade rzeczywistego TV |

Nie można nazwać wymogu spełnionym, jeśli użytkownik musi sam klonować repo, kompilować React albo szukać WGT w losowym repozytorium. Dopuszczalne przygotowanie platformy (SDK/certyfikat) trzeba opisać w UX i instrukcji, a następnie zweryfikować w odbiorze. Jeśli wymagana będzie całkowicie samowystarczalna instalacja po samym IP na nieprzygotowanym TV, obecny research wskazuje **blokadę platformową**, nie zadanie do obejścia.

Adaptery deploy wywołują konkretne exe przez `spawn/execFile`, `shell: false`, `windowsHide: true`, argumenty jako tablica, z timeoutem i limitem output. Tizen dostarcza także wrappery `.bat`: w P0 ustalić bezpieczne wywołanie właściwego runtime; nie przekazywać danych użytkownika przez `cmd /c`. Oddzielny katalog pracy w userData, kontrola ścieżek, hashy i zip-slip. Nie wykonywać dowolnych komend shell na TV. Nie pobierać narzędzi z niezweryfikowanego `latest`.

## CI i wersjonowanie 1.0.0

Zachowujemy jeden pakiet npm dla desktopu i Tizen, oddzielny Gradle w `tv/android`; bez wymuszania migracji całego repo do monorepo. Nowe buildy Windows w Actions, brak targetów desktopowych macOS/Linux. Przykładowe zasoby release:

```text
resources/tv/manifest.json
resources/tv/android/Adrenaline-TV-1.0.0.apk
resources/tv/tizen/web/...
resources/media/ffmpeg.exe
resources/media/ffprobe.exe
resources/licenses/...
```

Manifest: wersja produktu, apiMin/apiMax, build revision, platforma, hash SHA-256, ścieżka artefaktu, application ID, wymagany toolchain i zakres wsparcia OS. Prywatne klucze nigdy w manifeście. Wersje Android versionCode i Tizen widget version mapowane deterministycznie; prerelease nie może cofać numeru instalacyjnego.

Pipeline: testy desktop/API → build Android i Tizen → test artefaktów i licencji → engine → połączenie zasobów → NSIS → kontrola kompletu → dotychczasowa publikacja GitHub Release. APK podpisuje CI; zasoby Tizen podpisuje później lokalny profil użytkownika. Binaria FFmpeg i narzędzia mają przypięte źródła/checksumy i notices. Wzrost rozmiaru instalatora zmierzyć w P0.

Desktop updater dostarcza nowe klienty w zasobach, ale nie aktualizuje po cichu TV. Zakładka TV pokazuje Update; instalacja zachowuje dane. Handshake sprawdza zakres API; podczas aktualizacji PC starszy klient działa, jeśli zakresy się przecinają, inaczej pokazuje instrukcję. W 1.0 ustalić politykę obsługi poprzedniego klienta i testować ją na każdej zmianie kontraktu. Tag `v1.0.0` dopiero po odbiorze obu platform; publikacja przez Actions.
