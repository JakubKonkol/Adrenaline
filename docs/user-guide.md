# Adrenaline — user guide

## First run

The setup wizard asks for a folder for your movies, a subtitle language and an optional fallback language. The fallback language is used only when there are no results in the main one.

In Settings → Accounts and keys, save your own TMDB v3 API key or API Read Access Token. Without it the catalog is unavailable; existing downloads keep working. You can get a TMDB account and key for free at themoviedb.org, in your account settings under API.

Subtitles are optional. To download them you need an OpenSubtitles.com API key plus the username and password of your account there. Save them, then click “Test OpenSubtitles” to see your remaining download limit. The test itself does not download any subtitles. “Log out and forget the password” removes the saved session and password. Account details stay on this computer and are encrypted with the Windows credential store; if encryption is not available, the app clearly says that they are kept only until it is closed.

## From a title to a download

Search for a title and check the year to tell a remake from the original. For a TV show, pick a season and a single episode. “Find releases” lists specific files from the sources you turned on. Compare resolution, video source, size and seeders; an unknown value does not mean zero. The seeder count comes from the last answer of the source and does not guarantee a transfer.

Choose a release, then the folder, whether you want subtitles, and the seeding rules. If the folder name is taken, choose another folder or the suggested numbered variant. A magnet link may need to fetch its file list first. If the files need confirming, pick the right one in the download details. Executables and samples are never selected automatically.

Only use sources and material you have the rights to. A title being in the TMDB catalog does not mean a release is available in the sources.

## Sources

Settings → Sources lets you turn on and test indexers, or add your own Torznab endpoint with an API key. Jackett ships with the installer and runs locally, without a separate .NET installation. One failing source does not hide the results of the others. If every source fails, the app shows a search error. Some sources may require their own account or be blocked on some networks.

## Downloads, pausing and seeding

The Downloads screen shows the progress of the selected files, the speed and the state of every download. “Pause” waits for the engine to confirm. “Resume” continues from the data already downloaded. After a restart the app restores your downloads; while the engine restarts, progress is marked as out of date. No peers means waiting, not a promised finish time.

Seeding means sharing the pieces you already have with other people. A movie can be ready while it is still seeding. In Settings, or when starting a download, set a limit on the ratio of uploaded to downloaded data, or on time. Uploading stops once a limit is reached.

“Open folder” shows the file in File Explorer. “Remove” takes the download off the list and keeps the files by default. The option to delete files covers the torrent files listed in the confirmation; separately saved subtitles stay in the folder. Adrenaline never runs downloaded executables.

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
