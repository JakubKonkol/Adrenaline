# Adrenaline — user guide

## First run

The setup wizard asks for a folder for your movies, a subtitle language and an optional fallback language. The fallback language is used only when there are no results in the main one.

In Settings → Accounts and keys, save your own TMDB v3 API key or API Read Access Token. Without it the catalog is unavailable; existing downloads keep working. You can get a TMDB account and key for free at themoviedb.org, in your account settings under API.

Subtitles are optional. To download them you need an OpenSubtitles.com API key plus the username and password of your account there. Save them, then click “Test OpenSubtitles” to see your remaining download limit. The test itself does not download any subtitles. “Log out and forget the password” removes the saved session and password. Account details stay on this computer and are encrypted with the Windows credential store; if encryption is not available, the app clearly says that they are kept only until it is closed.

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

First, in the TV tab turn on “Let TVs connect to this PC”. The tab shows the address of this PC for the TV, e.g. 192.168.1.20:18790. Windows may ask about the firewall: allow access on private networks. Keep the PC on with Adrenaline running (the tray is enough) while you use the TV.

Then install the TV app with “Install on a TV”. For Android TV: turn on developer options and network (or wireless) debugging on the TV, install Android platform-tools on the PC (the tab links to the official download), enter the TV’s IP address and click “Install on the TV”, then accept the debugging prompt on the TV. With Android 11+ wireless debugging, also enter the pairing port and code shown on the TV. For a Samsung TV: turn on Developer mode on the TV (Apps, then 1-2-3-4-5 on the remote) with this PC’s IP address, install Tizen Studio with the TV extensions, and create a Samsung certificate profile in its Certificate Manager; it needs the DUID of the TV, which the TV tab shows after the first connection. Then enter the TV’s IP address, choose the profile and install. The tools of Google and Samsung do the installation; Adrenaline never uninstalls anything.

When the TV app opens, it shows a 6-digit code and the PC shows “A TV wants to connect” with the same code. Approve it only if the codes match. “Paired TVs → Remove” cuts a TV off at once.

On the TV, Discover shows trending movies and shows and a search field. A title opens its details, seasons and episodes; “Download to PC” lists the releases and starts the download on this PC. Library shows what you were watching, what is downloading on the PC and everything already downloaded. Back on the remote goes back. In the player, left and right seek, OK pauses, and up opens subtitles and audio.

Adrenaline checks every file (with FFmpeg, installed with the app) and what the TV can play, and picks the cheapest way: the file as it is; repackaged without quality loss; only the audio converted (TrueHD or DTS for a TV without them; Dolby Atmos is kept only when the sound goes to the receiver unchanged); or the video converted with the graphics card (NVIDIA, Intel or AMD, otherwise the processor), including HDR or Dolby Vision converted to SDR for a TV without HDR. Image subtitles (PGS) are drawn into the picture when needed. “TV → Playback on TVs” shows what was chosen and why, and sets the encoder, the highest resolution and bitrate and the disk space for temporary files.

The connection between the PC and the TV works only in your home network and is not encrypted (HTTP), so approve only TVs you know.

## Subtitles

When you start a download you decide whether you want subtitles. “Download subtitles” is pre-selected only when an OpenSubtitles account is set up and “Download subtitles by default” is on in Settings. Your choice is never final: “Skip subtitles” on the download list or in the download details turns them off at any time (also while they are being searched for), and “Get subtitles” in the details fetches them later for a download that has none.

Subtitles are searched for only after the video file is complete. A file hash match gives the highest confidence; a strong release match may also allow an automatic choice. When the result is uncertain or several results are equally good, choose one in the download details. SDH marks subtitles for the deaf and hard of hearing, and “Foreign parts only” means partial subtitles.

Subtitles are saved next to the video, e.g. Movie.en.srt. An existing file is never replaced; the next one is called Movie.en.2.srt. The video file name and content never change. Subtitles are saved as UTF-8.

“Movie ready — subtitles need attention” means you can already watch the video, but the subtitles are missing, failed or need a choice. “Search again” does not download the movie again. You can change the language for this download only, or skip the subtitles. When the limit is used up, wait until the reset date shown. A download timeout may still count against the provider limit, so the app never retries it on its own.

## Errors and data

When the disk is full, free up space and resume the download. If a disk was disconnected, reconnect it under the same path. If a file was deleted outside Adrenaline, check the files in the download details; the engine can download the missing pieces again. Every error comes with a description and a suggested action.

Settings, the download database, resume data and logs are in the Windows app profile, usually %APPDATA%\adrenaline. Movies and subtitles are in the download folder you chose. “About → Open logs folder” takes you to the logs. “Copy diagnostics” copies versions, process states, download counts and error codes; it leaves out titles, paths, source addresses and secrets.

## Closing, updates and uninstalling

By default, closing the window keeps the app in the tray. “Quit” in the tray menu saves the state and stops all processes. You can change this in Settings.

Updates download in the background. Click the restart banner to install them; your downloads are kept. The update status and a manual check are in “About”.

Uninstalling removes the app but keeps your movies, subtitles and profile. If you also want to remove the profile, delete it by hand after closing Adrenaline, keeping any data you still need.
