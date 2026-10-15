# Protokół `adrenaline-engine` (wersja 1)

Proces C++ czyta komendy z **stdin** i pisze odpowiedzi oraz zdarzenia na **stdout**, po jednym obiekcie JSON w linii (UTF-8, `\n`). **stderr** wyłącznie na logi tekstowe (main przekierowuje je do loggera z redakcją). Proces nie otwiera żadnego portu poza portami BitTorrent.

Schematy Zod wszystkich komunikatów: `src/shared/contracts/engine.ts`. Implementacja po stronie C++ musi przejść ten sam zestaw przykładów (`tests/fixtures/engine-protocol/*.jsonl`).

## Uruchomienie

```
adrenaline-engine.exe --data-dir <userData>/engine --listen-port 0
```

- `--data-dir`: katalog na pliki `.resume`, `.torrent` (metadane) i `session.state` (DHT). Tworzony, jeśli nie istnieje.
- `--listen-port 0`: losowy port; `6881` jako domyślny poza dev jest dopuszczalny, ale wybór portu zostaje w Ustawieniach (domyślnie losowy przy pierwszym uruchomieniu i zapamiętany).
- Po starcie silnik sam wysyła zdarzenie `ready` (patrz niżej), a następnie czeka na `hello`.
- Zamknięcie stdin = `shutdown` bez potwierdzenia (zabezpieczenie, gdy main umrze).

## Koperta

Żądanie (main → silnik):
```json
{"v":1,"id":"r-42","op":"pause","jobId":"6f1c…","args":{}}
```
Odpowiedź (silnik → main), dokładnie jedna na żądanie:
```json
{"v":1,"id":"r-42","ok":true,"result":{"state":"paused"}}
{"v":1,"id":"r-42","ok":false,"error":{"code":"JOB_NOT_FOUND","message":"…"}}
```
Zdarzenie (silnik → main, bez `id`):
```json
{"v":1,"event":"progress","seq":1201,"data":{…}}
```

- `seq` rośnie monotonicznie od 1 w obrębie jednego procesu. Main wykrywa luki (np. po restarcie) i wtedy woła `snapshot`.
- Nieznane `op` → `ok:false`, `code: UNKNOWN_OP`. Nieznane pola są ignorowane (kompatybilność w przód).
- Komendy są **idempotentne**: `add` z istniejącym `jobId` zwraca istniejące zadanie, `pause` na spauzowanym zwraca sukces. Main ponawia po timeoucie (10 s) z tym samym `id`; silnik pamięta ostatnie 256 odpowiedzi po `id` i zwraca je ponownie zamiast wykonywać drugi raz.

## Operacje

| `op` | `args` | `result` | Uwagi |
|---|---|---|---|
| `hello` | `{ "clientVersion": "0.3.0" }` | `{ "protocol": 1, "engineVersion": "0.3.0", "libtorrent": "2.1.2", "features": ["v2","resume","selectFiles","seedLimits"] }` | Main odrzuca silnik z innym `protocol` (`ENGINE_PROTOCOL_MISMATCH`). |
| `add` | `{ "magnet": "magnet:?…" }` albo `{ "torrentBase64": "…" }`, plus `"savePath": "C:\\…"`, `"paused": false` | `{ "jobId", "infoHashV1", "infoHashV2", "hasMetadata": bool }` | `jobId` nadaje main (UUID). Torrent dodawany bez `auto_managed` (D-43) i z priorytetem 0 dla wszystkich plików do czasu `selectFiles`, jeśli metadane są znane. Magnet bez metadanych: stan `fetching_metadata`. |
| `selectFiles` | `{ "files": [ { "index": 3, "priority": 4 } ] }` | `{ "ok": true }` | Pliki niewymienione dostają priorytet 0. |
| `files` | `{}` | `{ "files": [ { "index", "path", "size", "pad": bool } ] }` | Ścieżki względne, separator `/`. Pliki „pad” (v2/hybrid) pomijane w UI. |
| `pause` | `{}` | `{ "state": "paused" }` | Odpowiedź po `torrent_paused_alert` (maks. 5 s, potem `ok:true` z `"pending": true` i późniejsze zdarzenie `state`). Przed pauzą `save_resume_data`. |
| `resume` | `{}` | `{ "state": "<stan>" }` | |
| `remove` | `{ "deleteFiles": false }` | `{ "ok": true }` | `deleteFiles: true` → `remove_torrent` z `delete_files` (libtorrent usuwa tylko pliki torrenta). Usuwa też pliki resume zadania. |
| `recheck` | `{}` | `{ "ok": true }` | `force_recheck`. |
| `setLimits` | `{ "downloadBps": 0, "uploadBps": 0, "maxConnections": 200 }` (globalnie, bez `jobId`) | `{ "ok": true }` | 0 = bez limitu. |
| `setSeedPolicy` | `{ "ratio": 1.0, "minutes": 60 }` (per `jobId`) | `{ "ok": true }` | Silnik po osiągnięciu limitu pauzuje torrent i wysyła `state: stopped` z `reason: "seed_limit"`. |
| `snapshot` | `{}` | `{ "jobs": [ JobStatus… ], "seq": 1201 }` | Pełny stan do odtworzenia po ponownym połączeniu. |
| `shutdown` | `{}` | `{ "ok": true }` | Zapisuje resume wszystkich torrentów (czeka na alerty, maks. 10 s), zapisuje `session.state`, kończy proces kodem 0. |
| `ping` | `{}` | `{ "now": 1739… }` | Heartbeat co 5 s; 3 brakujące odpowiedzi = proces uznany za zawieszony. |

## Zdarzenia

| `event` | `data` |
|---|---|
| `ready` | `{ "engineVersion", "protocol": 1 }` |
| `metadata` | `{ "jobId", "name", "files": [ { "index", "path", "size", "pad" } ], "totalSize", "infoHashV1", "infoHashV2" }` |
| `state` | `{ "jobId", "state": "fetching_metadata|downloading|paused|checking|downloaded|seeding|stopped|error", "reason"?: "user|seed_limit|disk_full|…", "error"?: { "code", "message" } }` |
| `progress` | `{ "jobs": [ JobStatus… ] }`, wysyłane co 500 ms (NFR02) tylko dla zadań, które się zmieniły |
| `fileCompleted` | `{ "jobId", "index" }` (z `file_completed_alert`) |
| `resumeSaved` | `{ "jobId" }` |
| `log` | `{ "level", "message" }` (zredagowane; tylko ostrzeżenia/błędy) |

`JobStatus`:
```json
{
  "jobId": "…",
  "state": "downloading",
  "selectedBytes": 4800000000,
  "selectedDoneBytes": 1200000000,
  "files": [ { "index": 3, "doneBytes": 1200000000 } ],
  "downloadRate": 5242880,
  "uploadRate": 120000,
  "peers": 34,
  "seeds": 12,
  "ratio": 0.02,
  "seedingSeconds": 0,
  "etaSeconds": 720
}
```

- Postęp liczony z `file_progress` dla **wybranych** plików, nie z całej paczki (FR10).
- `etaSeconds` = `null`, gdy prędkość = 0 lub niestabilna (średnia z 10 s < 1 KiB/s). Brak peerów ≠ błąd (BR08).

## Kody błędów silnika

`BAD_REQUEST`, `UNKNOWN_OP`, `JOB_NOT_FOUND`, `JOB_EXISTS_DIFFERENT_HASH`, `INVALID_MAGNET`, `INVALID_TORRENT`, `METADATA_TIMEOUT` (nie timeout silnika, tylko informacja; timeout prowadzi main), `DISK_FULL`, `DISK_ERROR`, `PATH_ERROR`, `INTERNAL`. Mapowanie na `AppErrorCode` w `src/main/engine/error-map.ts`.

Błędy plikowe z `file_error_alert`: `ENOSPC` → `DISK_FULL`, brak dysku/ścieżki → `DISK_ERROR` z `reason: disk_missing`; silnik pauzuje torrent zamiast go usuwać (NFR05).

## Resume i trwałość

- `save_resume_data` co 60 s dla zadań ze zmianami, przy pauzie, `fileCompleted`, i przy `shutdown`.
- Zapis atomowy: `<jobId>.resume.tmp` → `fsync` → `rename` na `<jobId>.resume`. Metadane torrenta zapisywane raz jako `<jobId>.torrent`.
- Po starcie silnik **nie** wczytuje zadań sam. Main po `hello` odtwarza je przez `add` z tymi samymi `jobId`; silnik, widząc istniejący `<jobId>.resume`, przekazuje go do `add_torrent_params` (`read_resume_data`). Dzięki temu SQLite jest jedynym źródłem prawdy o liście zadań, a pliki resume tylko przyspieszają wznowienie.
- Gdy resume brak lub uszkodzone → pełny `recheck` (stan `checking`). Nigdy nie pomijać weryfikacji danych (brak „skipVerify”).

## Ustawienia sesji libtorrent (start)

- `alert_mask`: `status`, `error`, `storage`, `file_progress` nie jest potrzebny (postęp przez `post_torrent_updates` + `file_progress` na żądanie co 500 ms).
- `enable_dht: true`, `enable_lsd: true`, `enable_upnp: true`, `enable_natpmp: true`.
- `listen_interfaces`: `0.0.0.0:<port>,[::]:<port>`.
- `user_agent` / `peer_fingerprint`: `Adrenaline/<wersja>`.
- Nie ustawiać `anonymous_mode`. Nie obiecywać anonimowości.

## Klient po stronie Electron (`src/main/engine/`)

- `EngineProcess`: spawn, zbieranie stderr, wykrywanie wyjścia. Restart z backoffem 1 s, 5 s, 30 s; po 3 awariach w 5 min stan `ENGINE_CRASHED` i komunikat w UI (bez pętli restartów). Po restarcie: `hello` → ponowne `add` aktywnych zadań → `snapshot`.
- `EngineClient`: kolejka żądań z `id`, timeouty, ponowienia z tym samym `id`, parsowanie linii, walidacja Zod, emiter zdarzeń z kontrolą `seq`.
- `FakeEngine`: implementacja w TS tego samego protokołu (symulowany postęp, metadane, błędy na żądanie). Używana w testach usług i w trybie dev bez zbudowanego silnika (`ADRENALINE_FAKE_ENGINE=1`). Tryb fake nigdy nie jest włączony w zbudowanym instalatorze.
