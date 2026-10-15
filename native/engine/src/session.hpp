#pragma once

#include <filesystem>
#include <memory>
#include <string>

#include <libtorrent/session.hpp>
#include <libtorrent/settings_pack.hpp>

namespace adr {

struct Options {
  std::filesystem::path dataDir;
  int listenPort = 0;
  bool noDht = false;
  bool noUpnp = false;
  bool testMode = false;
  int resumeIntervalSec = 60;
  // Hard working-set limit on Windows (memory-mapped file pages above it are trimmed); 0 = none.
  int maxMemoryMiB = 512;
};

lt::settings_pack make_settings(const Options& o);

// Creates the session, restoring DHT state from <dataDir>/session.state when present.
std::unique_ptr<lt::session> make_session(const Options& o);

void save_session_state(lt::session& ses, const Options& o);

}  // namespace adr
