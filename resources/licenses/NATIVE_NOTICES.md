# Native components

The Electron distribution includes LICENSE and LICENSES.chromium.html in the installation directory, covering Electron, Chromium, Node.js and their dependencies.

The bundled Jackett distribution retains its license and third-party notices. Jackett v0.24.2856 is distributed as a separate executable under GPL-2.0; corresponding source is available at https://github.com/Jackett/Jackett/tree/v0.24.2856 and https://github.com/Jackett/Jackett/archive/refs/tags/v0.24.2856.tar.gz . The bundled .NET runtime is MIT licensed; runtime sources are at https://github.com/dotnet/runtime . The binary is unchanged from the upstream release, pinned by SHA-256 in scripts/jackett-sha256.txt.

The adrenaline-engine helper includes libtorrent-rasterbar 2.1.2 (BSD-3-Clause), Boost (BSL-1.0), OpenSSL (Apache-2.0), and nlohmann/json (MIT). The Windows build pins vcpkg baseline 20ceb8adbf0504d4b0d5e4058a32f9d4fc896391. The build copies the exact vcpkg dependency license texts into licenses/engine/ in the installer.

Sources:
- https://github.com/arvidn/libtorrent/tree/v2.1.2
- https://www.boost.org/
- https://github.com/openssl/openssl
- https://github.com/nlohmann/json

FFmpeg 9.0.2 (Windows x64 "full_build-shared" by Gyan Doshi, https://www.gyan.dev/ffmpeg/builds/) is distributed as separate programs (ffmpeg.exe, ffprobe.exe and their libraries) under the GNU General Public License v3; Adrenaline runs them as separate processes to analyse and convert videos for TVs (D-85). The licence text, the build readme with the list of included libraries, and the links to the exact binaries and the corresponding source code (https://github.com/FFmpeg/FFmpeg/tree/n9.0.2) are installed in the ffmpeg/ folder (LICENSE, README.txt, SOURCE.txt). The binaries are unchanged from the upstream archive, pinned by SHA-256 in scripts/ffmpeg-sha256.txt.

The TV apps installed with Adrenaline (tv/ folder) contain: the Adrenaline TV web app with React and React DOM (MIT, see the npm notices above) and the Inter typeface (SIL Open Font License 1.1, https://github.com/rsms/inter); the Android app additionally contains AndroidX Media3, Activity, WebKit and the Kotlin standard library (Apache License 2.0, https://www.apache.org/licenses/LICENSE-2.0; sources: https://github.com/androidx/media, https://android.googlesource.com/platform/frameworks/support, https://github.com/JetBrains/kotlin).

TMDB data: This product uses the TMDB API but is not endorsed or certified by TMDB.
Subtitle data is provided by OpenSubtitles.com.
