# Akceptacja, testy i ryzyka

Status wszystkich odbiorów TV: **niewykonane**. Źródła ograniczeń platform: [research](01-research.md). Progi poniżej są propozycjami mierzalnego kontraktu produktu, do kalibracji w P0 i zapisania wraz ze sprzętem referencyjnym.

## Kryteria wydania 1.0.0

| ID | Scenariusz | Wymagany dowód |
| --- | --- | --- |
| AC-01 | Desktop działa tak jak 0.9.0 przy TV wyłączonym i włączonym | Regresja wyszukiwarki, wydań, folderów, napisów optional, pauzy/resume, seedowania, restartu, ustawień i updatera |
| AC-02 | NSIS zawiera wersję TV dla obu platform | Manifest/hash APK i zasobów Tizen, kontrola rzeczywistego zainstalowanego katalogu bez repo |
| AC-03 | TV → Deploy to TV instaluje Android TV po IP z niezbędną autoryzacją | Nagranie/checklista czystego PC, release APK, poprawny konkretny TV |
| AC-04 | TV → Deploy to TV instaluje Samsung Tizen po IP z prerequisites i lokalnym podpisem | Model/firmware, DUID/profil bez sekretów w logach, install/launch/handshake WGT |
| AC-05 | Wyszukiwanie filmu i pojedynczego odcinka, szczegóły, wybór wydania i plików działa na obu TV pilotem | Ten sam legalny/syntetyczny scenariusz na obu urządzeniach |
| AC-06 | Pobranie zlecone z TV trafia na PC i pojawia się na desktopie | Zgodne jobId/stan/pliki; wyłączenie TV nie przerywa pobierania; brak torrenta na TV |
| AC-07 | Zarządzanie pobraniem zachowuje reguły domeny | Pause/resume, duplikat, brak miejsca, nieznane metadane, opcjonalne napisy, błędy źródeł |
| AC-08 | Biblioteka i ukończone filmy odtwarzają się na obu platformach | Direct play + remux + audio fallback + ograniczony video fallback; seek, napisy i resume |
| AC-09 | Brak dostępu bez parowania, revoke działa natychmiast | Próby odczytu/mutacji bez tokena oraz zatrzymanie sesji i biletów po revoke ≤2 s |
| AC-10 | Desktop i dwa TV pracują równolegle | Brak wypierania sesji wyszukiwania, podwójnego zadania i niespójnego postępu |
| AC-11 | Reconnect i lifecycle działają | Utrata Wi-Fi, restart/uśpienie PC, zamknięcie do tray, Quit, restart TV i aktualizacja serwera |
| AC-12 | Upgrade klienta zachowuje dane | Ponowny deploy APK/WGT z tym samym podpisem; niezgodny podpis nie powoduje automatycznego uninstall |
| AC-13 | Desktop 0.9.0 aktualizuje się bez utraty historii/plików | Kopia profilu i migracja; nowy feature domyślnie wyłączony |
| AC-14 | Udokumentowany zakres kompatybilności i transport | Minimum OS/model/firmware, wynik P0 TLS/HTTP, znane ograniczenia, angielska instrukcja |
| AC-15 | Oba buildy i publikacja są powtarzalne | Zielone Actions, przypięte narzędzia, bez sekretów w artefaktach, komplet licencji |

AC-03 i AC-04 nie wymagają ominięcia zabezpieczeń fabrycznego TV. Wymagają jasno opisanych kroków przygotowania oraz późniejszej instalacji prowadzonej przez aplikację. Jeśli Samsung pozostanie wyłącznie ręczną instalacją z terminala, AC-04 **nie jest spełnione**.

## Macierz mediów i urządzeń

| Próbka własna / dozwolona | Co sprawdzamy |
| --- | --- |
| MP4 H.264 1080p SDR + AAC stereo | Bazowy direct play, start, seek, pauza, koniec i resume |
| MKV H.264 + AAC | Kontener: direct albo remux zgodnie z profilem |
| HEVC Main10 + nieobsługiwane audio | Rozdzielenie możliwości video/audio; konwersja audio lub jasny fallback |
| Format wideo nieobsługiwany przez TV | 1080p SDR transcode, limit CPU i kolejki |
| SRT UTF-8 z polskimi znakami i długimi liniami | Synchronizacja i seek, rozmiar tekstu, brak HTML injection |
| ASS ze stylami / napisy obrazkowe | Udokumentowany fallback/burn-in albo jawne ograniczenie, bez obietnicy pełnego stylu |
| Film >4 GiB, długi czas, plik brakujący lub częściowy | Range, liczby 64-bit, bilety podczas długiej sesji, błędy i odmowa częściowego pliku |

Każdy obowiązkowy test: Android TV z najniższego zadeklarowanego OS, Samsung z najstarszego zadeklarowanego rocznika, nowszy Samsung. Uzupełnić tabelę wyników o model/firmware, wersję app/toolchain, rodzaj sieci, kodeki, bitrate i tryb playback. Nie utożsamiać zgodności emulatora z dekoderem telewizora. Testy 4K/HDR informacyjne, dopóki nie staną się jawnie wspieranym profilem.

## Testy automatyczne bez rozbudowanej infrastruktury

- Vitest: DTO i projekcje bez sekretów, owner sesji, idempotencja, dwa równoległe polecenia, planner odtwarzania i błędy.
- Test integracyjny API na loopback z FakeEngine i fixtures: pairing → catalog → release → download → events → library, revoke i restart. Nie wywołuje TMDB/Jackett/OpenSubtitles w Internecie.
- Media: krótkie własne pliki, Range/HEAD/416, path traversal, junction/symlink, wygaśnięcie biletu, autoryzacja segmentów/napisów, limit/sprzątanie FFmpeg. Kontrola pobrania całego pliku nie może być zastąpiona tylko statusem HTTP.
- Deploy: stuby procesów ADB/SDB/CLI (unauthorized, timeout, certificate, brak miejsca, konflikt podpisu, cancel). Wartości IP/ścieżek nie mogą uruchamiać poleceń. Test konkretnego serialu przy wielu TV.
- Klient Android: kontrakty i model stanu na fixtures; Tizen: logika fokusu i adapter AVPlay na mocku. Oba wymagają dodatkowo ręcznego testu sprzętowego.
- Zachować istniejący smoke Electron; rozszerzyć o zakładkę TV disabled/enabled i handshake lokalnego klienta testowego. Nie tworzyć osobnego ciężkiego systemu E2E.
- CI nadal uruchamia istniejący lokalny swarm silnika; dopisać kontrolę buildów/manifestów i migracji. Ręczne testy sieci/sprzętu wykonywane poza CI.

## Proponowane progi i pomiar

Pomiar na opisanej sieci LAN i PC referencyjnym, własny MP4 H.264/AAC 1080p o stałym bitrate 10 Mb/s. Zapisać liczby, nie tylko wynik „zaliczone”.

- Pilot → widoczna reakcja UI p95 ≤100 ms; wyniki zewnętrznych providerów mierzyć osobno, nie wliczać do reakcji fokusu.
- Aktualizacja stanu pobrania na drugim kliencie ≤2 s przy stabilnym LAN.
- Start direct play ≤3 s, seek ≤2 s; transcode ma osobny wynik i profil sprzętu, bez tej samej obietnicy.
- Dwa jednoczesne direct streamy 1080p + trzy pobrania nie zamrażają desktopu; 30 min testu, brak wzrostu RAM proporcjonalnego do długości filmu.
- Reconnect ≤10 s od przywrócenia sieci, z odtworzeniem snapshotu i bez zduplikowanego pobrania.
- Po stop/quit brak osieroconych procesów FFmpeg, brak otwartych sesji i usunięty cache zgodnie z TTL; twardy limit miejsca cache testowany.

## Ryzyka i działania

| Ryzyko | Skutek | Ograniczenie / warunek |
| --- | --- | --- |
| Samsung Developer Mode/certyfikaty/DUID | Nie działa uniwersalny install po samym IP | P0 na fizycznym TV, kreator profilu i lokalne podpisy; żadnych obejść zabezpieczeń |
| TLS fetch vs AVPlay | API działa, player nie łączy się | Osobny test obu stosów, jawna decyzja transportowa przed P2 |
| Redystrybucja SDK/FFmpeg | Bundle nie może zawierać planowanych narzędzi albo wymaga dodatkowych obowiązków | Audyt konkretnego artefaktu; oficjalny toolchain jako prerequisite, notices i źródła zgodnie z licencją |
| Stary Chromium i zależności frontend | Czarny ekran na starszym Samsungu | Oddzielny build target, test dependency graph i rzeczywisty minimalny model |
| Różnice kodeków/napisów | Brak audio, seek, napisów | Profile i zestaw próbek; remux/transcode, jawne ograniczenia HDR |
| Słaby CPU i dysk | Streaming psuje pobieranie/desktop | Limity procesów/cache, pomiar obciążenia, fallback jakości; brak kodowania w main |
| Kilka TV korzysta z lokalnych serwisów | Wypieranie sesji, duplikaty, wyścigi | Owner/TTL/limity i idempotencja; jeden właściciel SQLite |
| LAN API rozszerza powierzchnię ataku | Odczyt danych lub zlecanie operacji przez obcy host | Default off, parowanie, tokeny, minimalne DTO, firewall, walidacja plików |
| IP/firewall/VPN/sleep | TV widzi instalację, ale nie serwer | Diagnostyka dwóch kierunków połączenia, jawny interfejs, retry i tray |
| Utrata klucza podpisu lub zmiana API | Brak upgrade / utrata parowania | Backup kluczy, manifest apiMin/apiMax, brak cichego uninstall |

## Otwarte decyzje i dane do zebrania w P0

1. Dokładne modele TV i najstarsza wspierana wersja. Propozycja Android 9/Tizen 6.0 nie jest jeszcze deklaracją kompatybilności.
2. Czy wymagany UX akceptuje jednorazową konfigurację Samsung SDK/certyfikatów? Pełna automatyzacja fabrycznego TV po samym IP nie ma potwierdzonej ścieżki.
3. HTTPS na rzeczywistym Tizen; jeśli niewykonalne bez dodatkowej infrastruktury, wybór wymaganej konfiguracji albo jawnego HTTP LAN. Nie ukrywać kompromisu.
4. Czy właściciel potwierdza odtwarzanie/transcoding w zakresie 1.0? Plan zakłada tak; wyszukiwanie i pobieranie na obu TV pozostają wymagane niezależnie.
5. Konkretny build FFmpeg, narzędzia SDK, licencje dystrybucji i budżet rozmiaru instalatora.
6. Sprzęt referencyjny i mierzalny profil transkodowania; nie obiecywać dowolnej liczby streamów na dowolnym PC.

Te niewiadome nie blokują sporządzenia planu. Są bramkami przyszłej implementacji, a nie pytaniami wymagającymi teraz odpowiedzi ani wykonanymi testami.
