#include "session.hpp"

#include <libtorrent/alert.hpp>
#include <libtorrent/address.hpp>
#include <libtorrent/fingerprint.hpp>
#include <libtorrent/ip_filter.hpp>
#include <libtorrent/session_params.hpp>

#include "resume.hpp"

namespace adr {

namespace {
std::filesystem::path state_path(const Options& o) { return o.dataDir / "session.state"; }

int version_part(int index) {
  // ADRENALINE_VERSION = "major.minor.patch[-pre]"
  std::string v = ADRENALINE_VERSION;
  int part = 0;
  std::size_t start = 0;
  for (int i = 0; i <= index; ++i) {
    std::size_t end = v.find_first_of(".-", start);
    std::string token = v.substr(start, end == std::string::npos ? std::string::npos : end - start);
    try {
      part = std::stoi(token);
    } catch (...) {
      part = 0;
    }
    if (end == std::string::npos) {
      if (i < index) return 0;
      break;
    }
    start = end + 1;
  }
  return part;
}
}  // namespace

lt::settings_pack make_settings(const Options& o) {
  lt::settings_pack p;
  p.set_int(lt::settings_pack::alert_mask, lt::alert_category::status | lt::alert_category::error |
                                              lt::alert_category::storage | lt::alert_category::file_progress);
  std::string port = std::to_string(o.listenPort);
  // Test mode listens on loopback only: one socket, so listen_port() is the port peers must use (with port 0
  // the IPv4 and IPv6 sockets get different random ports on Windows), and no firewall prompts.
  p.set_str(lt::settings_pack::listen_interfaces,
            o.testMode ? "127.0.0.1:" + port : "0.0.0.0:" + port + ",[::]:" + port);
  p.set_bool(lt::settings_pack::enable_dht, !o.noDht);
  p.set_bool(lt::settings_pack::enable_lsd, !o.noDht);
  p.set_bool(lt::settings_pack::enable_upnp, !o.noUpnp);
  p.set_bool(lt::settings_pack::enable_natpmp, !o.noUpnp);
  p.set_str(lt::settings_pack::user_agent, std::string("Adrenaline/") + ADRENALINE_VERSION);
  p.set_str(lt::settings_pack::peer_fingerprint,
            lt::generate_fingerprint("AD", version_part(0), version_part(1), version_part(2), 0));
  p.set_int(lt::settings_pack::stop_tracker_timeout, 1);
  // Default is 60 s: after a pause, or while a magnet waits for selectFiles (all priorities 0 = "finished",
  // connections to seeds are closed), small swarms would stall for a minute before peers are retried.
  p.set_int(lt::settings_pack::min_reconnect_time, 5);
  if (o.testMode) {
    p.set_bool(lt::settings_pack::allow_multiple_connections_per_ip, true);
    p.set_bool(lt::settings_pack::enable_outgoing_utp, false);
    p.set_bool(lt::settings_pack::enable_incoming_utp, false);
  }
  return p;
}

std::unique_ptr<lt::session> make_session(const Options& o) {
  lt::session_params params;
  if (!o.noDht) {
    if (auto buf = read_file(state_path(o))) {
      try {
        params = lt::read_session_params(*buf, lt::session_handle::save_dht_state);
      } catch (...) {
        params = lt::session_params();
      }
    }
  }
  params.settings = make_settings(o);
  auto ses = std::make_unique<lt::session>(std::move(params));
  if (o.testMode) {
    // Local peers ignore rate limits by default; the swarm test runs on 127.0.0.1 and needs setLimits to apply.
    lt::ip_filter classes;
    const auto global = 1u << static_cast<std::uint32_t>(lt::session::global_peer_class_id);
    classes.add_rule(lt::make_address("0.0.0.0"), lt::make_address("255.255.255.255"), global);
    classes.add_rule(lt::make_address("::"), lt::make_address("ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), global);
    ses->set_peer_class_filter(classes);
  }
  return ses;
}

void save_session_state(lt::session& ses, const Options& o) {
  if (o.noDht) return;
  std::vector<char> buf = lt::write_session_params_buf(ses.session_state(lt::session_handle::save_dht_state));
  std::string error;
  atomic_write(state_path(o), buf, error);
}

}  // namespace adr
