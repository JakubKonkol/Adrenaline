# Odtwarzanie na TV: negocjacja w stylu Jellyfin (wymóg 1.0)

Polecenie Jakuba z 16.10.2026, oznaczone jako **BARDZO WAŻNE**. Rozszerza P3 z [02-architecture-and-api.md](02-architecture-and-api.md) („Biblioteka i player”) i **zastępuje D-83** (1.0 tylko direct play) decyzją **D-85**. Bez tego 1.0 nie jest gotowe do wydania.

## Wymagania (dosłownie z polecenia, uporządkowane)

1. **FFmpeg w instalatorze.** Przypięte `ffmpeg.exe`/`ffprobe.exe` (Windows x64) z NVENC/QSV/AMF, sprawdzona licencja, checksum w repo, notices w instalatorze. Binaria pobiera workflow release (jak Jackett), nie trafiają do gita.
2. **ffprobe każdego pliku biblioteki**, wynik w cache `media_probe`: kontener, kodek i profil wideo, HDR10 / HDR10+ / Dolby Vision (profil 5/7/8), ścieżki audio (TrueHD/Atmos, E-AC3 JOC, DTS-HD), napisy (SRT/ASS/PGS).
3. **Klient raportuje możliwości urządzenia**: Android przez `MediaCodecList` / `AudioCapabilities` (passthrough E-AC3/TrueHD/DTS, DV); Tizen przez `webapis.avinfo` i listę modeli. **PlaybackPlanner** wybiera najtańszy wariant:
   1. direct play,
   2. remux do **HLS fMP4** (kopia HEVC/DV, bez strat),
   3. transkod tylko audio (TrueHD/DTS → E-AC3 5.1 z zachowaniem Atmos tam, gdzie się da, inaczej AAC),
   4. transkod wideo **sprzętowo** (NVENC/QSV/AMF) z tone mappingiem HDR/DV → SDR, gdy TV nie wspiera HDR/DV. **DV profil 5 na TV bez DV — zawsze z tone mappingiem** (profil 5 nie ma warstwy bazowej HDR10/SDR).
4. **Tizen: AVPlay** zamiast `<video>` (wybór ścieżek audio/napisów, passthrough, HLS). **Android: Media3** z passthrough audio i wyborem ścieżek.
5. Segmenty HLS i napisy **za tym samym biletem**; cache w `userData` z limitem miejsca; **max 1 transkod naraz**; zabijanie procesów FFmpeg po stop / seek / quit / revoke. PGS/ASS: **burn-in** przy transkodzie wideo.
6. **Ustawienia na PC**: akceleracja sprzętowa (auto / NVENC / QSV / AMF / CPU), maksymalna rozdzielczość i bitrate transkodu. **Diagnostyka w zakładce TV**: który wariant i dlaczego.
7. **Testy offline** na własnych krótkich próbkach: planner na fixtures ffprobe, cleanup procesów, autoryzacja segmentów. Odbiór 4K DV/Atmos tylko ręcznie na sprzęcie → `docs/manual-tests.md`.

## Projekt

### Moduły (main)

| Plik | Odpowiedzialność |
| --- | --- |
| `src/main/media/ffmpeg-path.ts` | Lokalizacja binariów (`resources/ffmpeg` w instalatorze, `vendor/ffmpeg` w dev, `ADRENALINE_FFMPEG_DIR` w testach), weryfikacja obecności |
| `src/main/media/probe.ts` | `ffprobe -v error -print_format json -show_format -show_streams` (+ `-show_frames` 1 klatki dla side data DV/HDR10+), timeout, limit wyjścia, parser → `MediaProbe` |
| `src/main/media/probe-cache.ts` | Tabela `media_probe` (migracja 003): klucz `item_id` + `size` + `mtime_ms`, JSON wyniku, wersja parsera |
| `src/shared/domain/playback.ts` | Typy `MediaProbe`, `DeviceProfile`, `PlaybackPlan` i **czysty** `planPlayback()` (testowalny bez FFmpeg) |
| `src/main/media/hwaccel.ts` | Wykrycie enkoderów (`ffmpeg -hide_banner -encoders` + próbny encode 1 klatki) → `nvenc/qsv/amf/cpu`, cache na sesję |
| `src/main/media/ffmpeg-args.ts` | Budowa argumentów dla planu (allowlista, tablica argumentów, bez shell) |
| `src/main/media/transcoder.ts` | Sesje HLS: proces FFmpeg, katalog segmentów, kolejka (1 transkod), restart od pozycji przy seek, kill drzewa procesów (`taskkill /T /F` na Windows) |
| `src/main/media/hls-cache.ts` | Cache w `userData/transcode`, limit miejsca (ustawienie, domyślnie 10 GiB), sprzątanie przy starcie i po sesji |
| `src/main/tv/api.ts` | `POST /playback/:itemId` przyjmuje `DeviceProfile`, zwraca plan + URL (`/media/:ticket/video` albo `/media/:ticket/hls/master.m3u8`), `GET /media/:ticket/hls/*` za biletem |

### Profil urządzenia (`DeviceProfile`, wysyła klient)

```ts
{
  platform: 'android' | 'tizen' | 'web',
  model: string | null,
  maxWidth: number, maxHeight: number,         // panel / wyjście
  video: [{ codec: 'h264'|'hevc'|'av1'|'vp9', maxLevel?, profiles?: string[], tenBit: boolean }],
  hdr: { hdr10: boolean, hdr10plus: boolean, hlg: boolean, dolbyVision: { profiles: number[] } },
  audio: { decode: string[], passthrough: string[], maxChannels: number },  // 'aac','ac3','eac3','eac3-joc','truehd','dts','dts-hd','flac','opus'
  containers: string[],                         // 'mp4','mkv','webm','ts','hls-fmp4','hls-ts'
  subtitles: { external: string[], embedded: string[] } // 'vtt','srt','ass','pgs'
}
```

- **Android:** `MediaCodecList.getCodecInfos()` (typy MIME, profile HEVC Main10 / DV `video/dolby-vision`), `Display.getHdrCapabilities()` (API 24+) / `Display.Mode`, `AudioCapabilities.getCapabilities(context)` (Media3) → passthrough `ENCODING_E_AC3`, `E_AC3_JOC`, `DOLBY_TRUEHD`, `DTS`, `DTS_HD`. Most JS ↔ natywny (`AdrenalineNative.deviceProfile()`).
- **Tizen:** `webapis.avinfo.isHdrTvSupport()`, `webapis.avinfo.getDolbyDigitalCompMode()`, `webapis.productinfo.is8KPanelSupported()/isUdPanelSupported()`, `webapis.productinfo.getRealModel()` + **tabela modeli** (rocznik → kodeki, DV od 2023 tylko w wybranych liniach — domyślnie DV = false, dopóki model nie jest na liście potwierdzonej ręcznie). Wymaga `<script src="$WEBAPIS/webapis/webapis.js">` i przywilejów w `config.xml`.
- **Przeglądarka (dev):** `MediaSource.isTypeSupported` / `canPlayType`; bez HDR, bez passthrough.

### PlaybackPlanner (czysta funkcja)

Wejście: `MediaProbe`, `DeviceProfile`, ustawienia PC (hwaccel, maxHeight, maxBitrate), wybrane ścieżki audio/napisów. Wyjście: `PlaybackPlan`:

```ts
{ mode: 'direct' | 'remux' | 'audio' | 'video',
  container: 'file' | 'hls-fmp4',
  video: { action: 'copy' | 'encode', codec, toneMap: boolean, scaleTo?: { w, h }, bitrate?, encoder? },
  audio: { streamIndex, action: 'copy' | 'encode', codec?: 'eac3'|'aac', channels? },
  subtitles: { streamIndex|null, delivery: 'external-vtt' | 'embedded' | 'burn-in' | 'none' },
  reasons: string[] }        // np. ['container mkv not supported', 'audio truehd not supported → eac3']
```

Kolejność decyzji: direct play tylko gdy kontener + wideo (kodek, profil, bit depth, rozdzielczość, HDR/DV) + wybrane audio (decode lub passthrough) + wybrane napisy (zewnętrzne VTT lub osadzone wspierane) pasują. Inaczej remux (wideo i audio kopiowane, kontener HLS fMP4). Inaczej audio-only transkod. Wideo transkodowane tylko gdy: kodek/profil/bit depth/rozdzielczość nieobsługiwane, HDR/DV bez wsparcia (tone mapping), napisy obrazkowe/ASS wymagające burn-in, albo bitrate ponad limit. DV: profil 5 bez DV → zawsze `video encode + toneMap` (kolory w IPTPQc2 bez warstwy bazowej); profil 8.1 bez DV → kopia jako HDR10 (warstwa bazowa), profil 7 → kopia warstwy bazowej HDR10 (EL odrzucona) lub tone mapping, gdy brak HDR10. Atmos: E-AC3 JOC kopiowany, gdy passthrough `eac3-joc`; TrueHD Atmos → E-AC3 5.1 (Atmos z TrueHD nie przetrwa transkodu do E-AC3 bez enkodera Dolby — **zachowanie Atmos tylko przez passthrough/kopię**; dokumentujemy to jawnie w powodach planu).

### FFmpeg

- Build: **BtbN FFmpeg-Builds `win64-gpl`** z przypiętego wydania (zawiera nvenc/ffnvcodec, qsv/libvpl, amf, libx264/x265 jako fallback CPU, zscale/libzimg i libplacebo do tone mappingu). Wersja i SHA-256 w `scripts/ffmpeg-version.txt` / `scripts/ffmpeg-sha256.txt`, pobieranie `scripts/fetch-ffmpeg.mjs` w workflow (wzorem `fetch-jackett.mjs`). Licencja GPL-3.0: osobny program wywoływany jako proces (agregacja), w instalatorze `resources/licenses/ffmpeg/` (LICENSE + link do dokładnego źródła wydania). Audyt licencji = bramka przed wydaniem (zapisać w D-85).
- Tone mapping: `zscale=t=linear:npl=100,tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv,format=yuv420p` (CPU) albo `libplacebo` (Vulkan) — wybór po teście sprzętu; dla NVENC/QSV/AMF dekodowanie sprzętowe i tone mapping na CPU/GPU zgodnie z dostępnymi filtrami. DV profil 5: `libplacebo` z obsługą DV RPU (FFmpeg ≥ 6) albo jawny błąd, gdy niedostępne.
- HLS fMP4: `-f hls -hls_segment_type fmp4 -hls_time 6 -hls_playlist_type event -hls_flags independent_segments`, seek = nowy proces od `-ss` z nową sesją segmentów. Remux HEVC/DV: `-c:v copy -tag:v hvc1` (DV: `-strict unofficial` dla zachowania `dvcC`).
- Procesy: `spawn` bez shell, `windowsHide`, argumenty z allowlisty, limit czasu bezczynności (brak żądań segmentów 60 s → kill), kill drzewa przy stop/seek/quit/revoke, limit wyjścia logu.

### Ustawienia (PC) i diagnostyka

`transcodeHwAccel: 'auto'|'nvenc'|'qsv'|'amf'|'cpu'`, `transcodeMaxHeight: 2160|1440|1080|720`, `transcodeMaxBitrateMbps`, `transcodeCacheGiB`. Zakładka TV: ostatnie sesje odtwarzania (urządzenie, plik, tryb, powody, encoder, czy tone mapping, aktualna prędkość FFmpeg ×realtime).

### Testy (offline)

- `planPlayback` na fixtures ffprobe (`tests/fixtures/ffprobe/*.json`, ręcznie spisane z własnych/syntetycznych próbek): H.264 MP4 → direct; MKV H.264 na Tizen bez MKV → remux; HEVC Main10 HDR10 na TV bez HDR → video + tone mapping; DV P5 na TV bez DV → tone mapping; DV P8.1 bez DV → kopia HDR10; TrueHD Atmos bez passthrough → E-AC3 5.1; E-AC3 JOC z passthrough → kopia; PGS przy transkodzie → burn-in; limit rozdzielczości/bitrate.
- Transcoder ze stubem procesu: 1 transkod naraz, kill po stop/seek/revoke/quit, sprzątanie cache i limit miejsca.
- Serwer: segmenty i playlisty tylko za biletem; inny bilet/urządzenie → 401; traversal w nazwie segmentu → 400.
- Opcjonalny test z prawdziwym FFmpeg, gdy `ADRENALINE_FFMPEG_DIR` ustawione (pomijany w CI bez binariów), na wygenerowanej przez FFmpeg próbce `testsrc` (własna treść).
- Ręcznie (`docs/manual-tests.md`): 4K DV P5/P8, HDR10, Atmos TrueHD/E-AC3 JOC, DTS-HD, PGS na fizycznym Android TV i Samsungu.
