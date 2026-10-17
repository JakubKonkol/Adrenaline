# Adrenaline — user guide

## First run

The setup wizard asks for a folder for your movies, a subtitle language and an optional fallback language. The fallback language is used only when there are no results in the main one.

In Settings → Accounts and keys, save your own TMDB v3 API key or API Read Access Token. Without it the catalog is unavailable; existing downloads keep working. You can get a TMDB account and key for free at themoviedb.org, in your account settings under API.

Subtitles are optional. In Settings, enable the providers you want. NapiProjekt works without credentials for Polish subtitles. OpenSubtitles.com needs an API key plus your account username and password; save them, then click “Test OpenSubtitles” to see your remaining download limit. The test itself does not download any subtitles. “Log out and forget the password” removes that provider's saved session and password. Napisy24 needs the API user agent and API password issued by that service, saved under Accounts and keys. Account details stay on this computer and are encrypted with the Windows credential store; if encryption is not available, the app clearly says that they are kept only until it is closed.

## From a title to a download

Search for a title and check the year to tell a remake from the original. For a TV show, pick a season and a single episode. “Find releases” lists specific files from the sources you turned on. Compare resolution, video source, size and seeders; an unknown value does not mean zero. The seeder count comes from the last answer of the source and does not guarantee a transfer.

Choose a release, then the folder and whether you want subtitles. If the folder name is taken, choose another folder or the suggested numbered variant. A magnet link may need to fetch its file list first. If the files need confirming, pick the right one in the download details. Executables and samples are never selected automatically.

Only use sources and material you have the rights to. A title being in the TMDB catalog does not mean a release is available in the sources.

## Sources

Settings → Sources lets you turn on and test indexers, or add your own Torznab endpoint with an API key. Jackett ships with the installer and runs locally, without a separate .NET installation. One failing source does not hide the results of the others. If every source fails, the app shows a search error. Some sources may require their own account or be blocked on some networks.

## Downloads and pausing

The Downloads screen shows the progress of the selected files, the speed and the state of every download. “Pause” waits for the engine to confirm. “Resume” continues from the data already downloaded. After a restart the app restores your downloads; while the engine restarts, progress is marked as out of date. No peers means waiting, not a promised finish time.

When a download finishes, Adrenaline stops sharing it right away: the torrent is closed, nothing keeps uploading in the background, and the files stay in the folder. The finished movie or episode appears in the **Library**. Quitting Adrenaline stops the download engine and the source service; if the app ever crashed, it stops their leftovers on the next start.

“Open folder” shows the file in File Explorer. “Remove” takes the download off the list and keeps the files by default. The option to delete files covers the torrent files listed in the confirmation; separately saved subtitles stay in the folder. Adrenaline never runs downloaded executables.

## Library

The Library lists every finished movie and episode, with posters, shows grouped by season and episode. “Play” opens the file in your default video player, the folder icon shows it in File Explorer. A file moved or deleted outside Adrenaline is marked “File missing”. “Remove from library” takes the download off the list and keeps the files unless you tick “Also delete the files from disk”.

## Watching on a TV

Adrenaline has a TV app for Android TV / Google TV and for Samsung TVs (Tizen). On the TV you browse and search movies and shows, start downloads and watch your Library; the downloading and the files stay on this PC.

First, in the TV tab turn on “Let TVs connect to this PC”. The tab shows the address of this PC for the TV, e.g. 192.168.1.20:18790. The first time you enable the server, Windows may ask to allow Adrenaline through the firewall: allow access on private networks for your trusted home LAN. Keep the PC on with Adrenaline running (the tray is enough) while you use the TV.

Then install the TV app with “Install on a TV”. For Android TV: turn on developer options and network (or wireless) debugging on the TV, enter the TV’s IP address and click “Install on the TV”, then accept the debugging prompt on the TV. Adrenaline downloads and verifies the official Android platform-tools automatically on first use; you do not need Android SDK. Further installations use the local cache. Advanced lets you choose your own adb. With Android 11+ wireless debugging, also enter the pairing port and code shown on the TV.

For Samsung, enable Developer Mode in Apps (1-2-3-4-5 on the remote), allow this PC’s LAN IP and restart the TV if requested. Enter the TV’s IP in Adrenaline and leave the certificate option on Automatic. The first installation needs internet access to download about 6 MB of official Tizen tools; subsequent attempts reuse a verified local cache. Tizen Studio is not required for Automatic. Approve pairing on the PC after the TV app opens; if remote launch fails, open Adrenaline from the TV’s app list. Installation, update, launch and playback of the twelve test formats were checked on QE65Q77BATXXH (Tizen 6.5). That firmware rejected the newer SDK certificate chain and accepted the legacy SDK distributor, whose certificate formally expired in 2022. Automatic retries once with that legacy distributor only after an invalid-chain error, retaining the same author. Other firmware may require Advanced signing.

If the TV cannot reach a running server, check Windows Firewall for the network profile actually used by your LAN. A rule for Public networks does not allow an app on a Private network. Allow Adrenaline and its selected TV port only on the trusted LAN; do not disable the firewall.

If the TV rejects the certificate, use Advanced with a named Samsung certificate profile from Tizen Studio and Certificate Manager, including the TV’s DUID. Adrenaline displays the DUID after connecting. It never uninstalls an existing TV app automatically. Switching signing identities can prevent an update, so keep the original author identity.

Back up `%APPDATA%\adrenaline\tv-deploy\author.json` securely before moving or resetting this PC’s profile. It contains the private author key used for updates; do not share it or delete it to resolve a certificate error. The pinned automatic author chain expires on 1 January 2027. Renewal with the same identity is not yet implemented: an app/tool update and a tested renewal procedure are required before that date. An expired or invalid saved identity is rejected without replacing the file.

After installation, the TV app opens and starts pairing with this PC automatically. It shows a 6-digit code and the PC shows “A TV wants to connect” with the same code. Approve it only if the codes match; no remote input is needed. The connection is saved on the TV, including if you close the app immediately afterwards. “Paired TVs → Remove” cuts a TV off at once and returns it to pairing.

On the TV, Discover shows trending titles, top-rated films and shows, cinema releases, upcoming films, shows currently on air, and action, comedy and science-fiction collections, plus a search field. A title opens its details, seasons and episodes. “Download to PC” lists releases with quality, source and codec filters and match/seeder/size sorting. After choosing a torrent, decide whether to get subtitles and choose a file or deferred hash matching. Library shows what you were watching, what is downloading on the PC and everything already downloaded. Back on the remote goes back.

On Samsung, OK shows the playback controls. Use the timeline to preview a position, then OK or a short pause in remote input to seek. The buttons rewind 10 seconds, pause/play and skip 30 seconds. The display shows time remaining and when the film ends. Subtitles and Audio choose tracks; Settings adjusts subtitle size, background, height and timing (in 0.25-second steps), picture fit and playback information. Subtitle appearance and language are remembered. In Subtitle settings → Sync, left moves subtitles earlier, right moves them later, and OK resets the offset. On Android, playback uses the native Media3 controls; MENU → Audio & subtitles → Subtitle sync adjusts the offset in 0.25-second steps with a reset option. Image subtitles require conversion on the PC; subtitles already burned into the picture cannot be shifted independently.

After an episode ends, “Up next” offers the next available episode of the same show in your Library and starts it after 10 seconds. Choose “Play now” to skip the countdown or Back to cancel. Samsung also has a “Next episode” button during playback. Missing episodes are skipped; Adrenaline does not download them automatically.

Adrenaline checks every file (with FFmpeg, installed with the app) and what the TV can play, and picks the cheapest way: the file as it is; repackaged without quality loss; only the audio converted (TrueHD or DTS for a TV without them; Dolby Atmos is kept only when the sound goes to the receiver unchanged); or the video converted with the graphics card (NVIDIA, Intel or AMD, otherwise the processor), including HDR or Dolby Vision converted to SDR for a TV without HDR. Image subtitles (PGS) are drawn into the picture when needed. “TV → Playback on TVs” shows what was chosen and why, and sets the encoder, the highest resolution and bitrate and the disk space for temporary files.

The connection between the PC and the TV works only in your home network and is not encrypted (HTTP), so approve only TVs you know.

## Subtitles

When you start a download you decide whether you want subtitles. “Download subtitles” is pre-selected when an enabled provider supports the languages set on the PC and “Download subtitles by default” is on in Settings. NapiProjekt provides Polish subtitles without an account; OpenSubtitles uses its API key and account; Napisy24 uses its own API user agent and password. Your choice is never final: “Skip subtitles” on the download list or in the download details turns them off at any time (also while they are being searched for), and “Get subtitles” in the details fetches them later for a download that has none.

On the PC, subtitles are searched for after the video file is complete. On the TV, choose a torrent, answer whether to get subtitles, then select an available OpenSubtitles file or opt for matching after download. NapiProjekt and Napisy24 need the downloaded video to compute its hash. A file hash match gives the highest confidence; a strong release match may also allow an automatic choice. When the result is uncertain or several results are equally good, choose one in the download details on the PC. SDH marks subtitles for the deaf and hard of hearing, and “Foreign parts only” means partial subtitles. Subtitle failures and missing accounts never prevent a finished movie from reaching 100% or appearing in Library.

Subtitles are saved next to the video, e.g. Movie.en.srt. An existing file is never replaced; the next one is called Movie.en.2.srt. The video file name and content never change. Subtitles are saved as UTF-8.

“Movie ready — subtitles need attention” means you can already watch the video, but the subtitles are missing, failed or need a choice. “Search again” does not download the movie again. You can change the language for this download only, or skip the subtitles. When the limit is used up, wait until the reset date shown. A download timeout may still count against the provider limit, so the app never retries it on its own.

## Errors and data

When the disk is full, free up space and resume the download. If a disk was disconnected, reconnect it under the same path. If a file was deleted outside Adrenaline, check the files in the download details; the engine can download the missing pieces again. Every error comes with a description and a suggested action.

Settings, the download database, resume data and logs are in the Windows app profile, usually %APPDATA%\adrenaline. Movies and subtitles are in the download folder you chose. “About → Open logs folder” takes you to the logs. “Copy diagnostics” copies versions, process states, download counts and error codes; it leaves out titles, paths, source addresses and secrets.

## Closing, updates and uninstalling

By default, closing the window keeps the app in the tray. “Quit” in the tray menu saves the state and stops all processes. You can change this in Settings.

Updates download in the background. Click the restart banner to install them; your downloads are kept. The update status and a manual check are in “About”.

Uninstalling removes the app but keeps your movies, subtitles and profile. If you also want to remove the profile, delete it by hand after closing Adrenaline, keeping any data you still need.
