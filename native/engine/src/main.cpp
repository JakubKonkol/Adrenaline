// adrenaline-engine: libtorrent helper process. JSON Lines on stdin/stdout (protocol v1, 02-protokol-silnika.md),
// plain-text logs on stderr.

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <fstream>
#include <iostream>
#include <iterator>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include <libtorrent/alert_types.hpp>
#include <libtorrent/bencode.hpp>
#include <libtorrent/create_torrent.hpp>
#include <libtorrent/load_torrent.hpp>
#include <libtorrent/magnet_uri.hpp>
#include <libtorrent/torrent_info.hpp>
#include <libtorrent/version.hpp>

#include "jobs.hpp"
#include "protocol.hpp"
#include "session.hpp"
#include "util.hpp"

namespace {

using adr::json;

// Lines read from stdin by a background thread; the main loop drains them between alert batches.
class LineQueue {
 public:
  void push(std::string line) {
    std::lock_guard<std::mutex> lock(m_);
    lines_.push_back(std::move(line));
  }
  void close() { eof_ = true; }
  bool eof() const { return eof_; }
  std::vector<std::string> drain() {
    std::lock_guard<std::mutex> lock(m_);
    std::vector<std::string> out(std::make_move_iterator(lines_.begin()), std::make_move_iterator(lines_.end()));
    lines_.clear();
    return out;
  }

 private:
  std::mutex m_;
  std::deque<std::string> lines_;
  std::atomic<bool> eof_{false};
};

void usage() {
  std::cerr << "usage: adrenaline-engine --data-dir <dir> [--listen-port <n>] [--no-dht] [--no-upnp] [--test-mode] [--resume-interval <s>]\n"
               "       adrenaline-engine --make-torrent <path> --out <file> [--hybrid]\n";
}

int make_torrent(const std::string& src, const std::string& outFile, bool hybrid) {
  try {
    lt::create_flags_t flags = hybrid ? lt::create_flags_t{} : lt::create_torrent::v1_only;
    auto srcPath = adr::u8path(src);
    std::string parent = adr::path_to_utf8(srcPath.parent_path());
#if LIBTORRENT_VERSION_NUM >= 20100
    lt::create_torrent t(lt::list_files(src, lt::create_flags_t{}), 0, flags);
#else
    lt::file_storage fs;
    lt::add_files(fs, src);
    lt::create_torrent t(fs, 0, flags);
#endif
    lt::set_piece_hashes(t, parent);
    std::vector<char> buf;
    lt::bencode(std::back_inserter(buf), t.generate());
    std::ofstream out(adr::u8path(outFile), std::ios::binary);
    out.write(buf.data(), static_cast<std::streamsize>(buf.size()));
    out.close();
    // load_torrent_buffer is shared by 2.0/2.1 and retains v2 piece layers in add_torrent_params.
    auto params = lt::load_torrent_buffer(buf);
    const auto& ti = *params.ti;
    json info{{"name", ti.name()},
              {"infoHashV1", adr::hex_v1(ti.info_hashes())},
              {"infoHashV2", adr::hex_v2(ti.info_hashes())},
              {"magnet", lt::make_magnet_uri(params)},
              {"totalSize", ti.total_size()},
              {"numFiles", ti.num_files()}};
    std::cout << info.dump() << '\n';
    return 0;
  } catch (const std::exception& e) {
    std::cerr << "make-torrent failed: " << e.what() << '\n';
    return 2;
  }
}

int run_engine(const adr::Options& opts) {
  std::error_code ec;
  std::filesystem::create_directories(opts.dataDir, ec);
  if (ec) {
    std::cerr << "cannot create data dir: " << ec.message() << '\n';
    return 2;
  }

  adr::Output out;
  auto ses = adr::make_session(opts);
  adr::JobManager jobs(*ses, opts, out);

  // Wait (briefly) for the listen socket so `ready` can report the real port.
  auto until = std::chrono::steady_clock::now() + std::chrono::seconds(3);
  bool listening = false;
  while (!listening && std::chrono::steady_clock::now() < until) {
    ses->wait_for_alert(std::chrono::milliseconds(100));
    std::vector<lt::alert*> alerts;
    ses->pop_alerts(&alerts);
    for (auto* a : alerts) {
      if (lt::alert_cast<lt::listen_succeeded_alert>(a)) listening = true;
      jobs.on_alert(a);
    }
  }
  out.event("ready", json{{"engineVersion", ADRENALINE_VERSION},
                          {"protocol", adr::kProtocolVersion},
                          {"libtorrent", lt::version()},
                          {"listenPort", ses->listen_port()}});

  LineQueue queue;
  std::thread reader([&queue] {
    std::string line;
    while (std::getline(std::cin, line)) {
      if (!line.empty() && line.back() == '\r') line.pop_back();
      if (!line.empty()) queue.push(std::move(line));
    }
    queue.close();
  });
  reader.detach();  // blocked in read until the process exits

  while (!jobs.done()) {
    ses->wait_for_alert(std::chrono::milliseconds(100));
    std::vector<lt::alert*> alerts;
    ses->pop_alerts(&alerts);
    for (auto* a : alerts) jobs.on_alert(a);

    for (const auto& line : queue.drain()) {
      std::string id, error;
      auto req = adr::parse_request(line, id, error);
      if (!req) {
        if (!id.empty()) out.respond(id, adr::error_response(id, "BAD_REQUEST", error));
        else std::cerr << "ignored invalid line: " << error << '\n';
        continue;
      }
      jobs.handle(*req);
    }
    // stdin closed (main died): shut down without a reply.
    if (queue.eof() && !jobs.shutting_down()) jobs.begin_shutdown("");
    jobs.tick();
  }
  // Session teardown without waiting long for trackers (stop_tracker_timeout = 1 s).
  auto proxy = ses->abort();
  ses.reset();
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  adr::set_binary_stdio();
  std::ios::sync_with_stdio(false);
  auto args = adr::utf8_args(argc, argv);

  adr::Options opts;
  std::string makeTorrent, outFile;
  bool hybrid = false;
  bool haveDataDir = false;
  for (std::size_t i = 1; i < args.size(); ++i) {
    const std::string& a = args[i];
    auto next = [&]() -> std::string {
      if (i + 1 >= args.size()) {
        usage();
        std::exit(2);
      }
      return args[++i];
    };
    if (a == "--data-dir") {
      opts.dataDir = adr::u8path(next());
      haveDataDir = true;
    } else if (a == "--listen-port") {
      opts.listenPort = std::stoi(next());
    } else if (a == "--no-dht") {
      opts.noDht = true;
    } else if (a == "--no-upnp") {
      opts.noUpnp = true;
    } else if (a == "--resume-interval") {
      opts.resumeIntervalSec = std::max(1, std::stoi(next()));
    } else if (a == "--test-mode") {
      opts.testMode = true;
    } else if (a == "--make-torrent") {
      makeTorrent = next();
    } else if (a == "--out") {
      outFile = next();
    } else if (a == "--hybrid") {
      hybrid = true;
    } else if (a == "--version") {
      std::cout << ADRENALINE_VERSION << " (libtorrent " << lt::version() << ")\n";
      return 0;
    } else {
      usage();
      return 2;
    }
  }
  if (!makeTorrent.empty()) {
    if (outFile.empty()) {
      usage();
      return 2;
    }
    return make_torrent(makeTorrent, outFile, hybrid);
  }
  if (!haveDataDir) {
    usage();
    return 2;
  }
  return run_engine(opts);
}
