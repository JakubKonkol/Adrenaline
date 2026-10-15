# Native components

The Electron distribution includes LICENSE and LICENSES.chromium.html in the installation directory, covering Electron, Chromium, Node.js and their dependencies.

The bundled Jackett distribution retains its license and third-party notices. Jackett v0.24.2856 is distributed as a separate executable under GPL-2.0; corresponding source is available at https://github.com/Jackett/Jackett/tree/v0.24.2856 and https://github.com/Jackett/Jackett/archive/refs/tags/v0.24.2856.tar.gz . The bundled .NET runtime is MIT licensed; runtime sources are at https://github.com/dotnet/runtime . The binary is unchanged from the upstream release, pinned by SHA-256 in scripts/jackett-sha256.txt.

The adrenaline-engine helper includes libtorrent-rasterbar 2.1.2 (BSD-3-Clause), Boost (BSL-1.0), OpenSSL (Apache-2.0), and nlohmann/json (MIT). The Windows build pins vcpkg baseline 20ceb8adbf0504d4b0d5e4058a32f9d4fc896391. The build copies the exact vcpkg dependency license texts into licenses/engine/ in the installer.

Sources:
- https://github.com/arvidn/libtorrent/tree/v2.1.2
- https://www.boost.org/
- https://github.com/openssl/openssl
- https://github.com/nlohmann/json

TMDB data: This product uses the TMDB API but is not endorsed or certified by TMDB.
Subtitle data is provided by OpenSubtitles.com.
