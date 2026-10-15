#pragma once

#include <chrono>
#include <deque>
#include <map>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include <libtorrent/alert.hpp>
#include <libtorrent/session.hpp>
#include <libtorrent/torrent_handle.hpp>
#include <libtorrent/torrent_status.hpp>

#include "protocol.hpp"
#include "session.hpp"

namespace adr {

using Clock = std::chrono::steady_clock;

struct Job {
  std::string id;
  lt::torrent_handle handle;
  lt::info_hash_t infoHashes;
  // Until main sends selectFiles every file has priority 0 and "finished" is not reported as done.
  bool hasSelection = false;
  bool stopped = false;     // seed limit reached
  std::string pauseReason;  // user | seed_limit | disk_full | disk_missing | disk_error
  std::optional<json> error;
  std::optional<double> seedRatio;
  std::optional<int> seedMinutes;
  bool metadataSent = false;
  std::string lastState;
  std::string lastReason;
  std::deque<std::pair<Clock::time_point, std::int64_t>> samples;  // selected done bytes, for ETA
  std::vector<std::pair<std::string, int>> testPeers;
  Clock::time_point lastPeerConnect{};
};

// Owns the jobs (jobId -> torrent) and implements the operations and events of protocol v1.
class JobManager {
 public:
  JobManager(lt::session& ses, const Options& opts, Output& out);

  void handle(const Request& r);
  void on_alert(lt::alert* a);
  // Timers: progress (500 ms), seed policy (1 s), resume data (60 s), pending replies, shutdown completion.
  void tick();
  // requestId empty = stdin closed (no reply).
  void begin_shutdown(const std::string& requestId);
  bool shutting_down() const { return shuttingDown_; }
  bool done() const { return shutdownDone_; }

 private:
  struct PendingPause {
    std::string requestId;
    std::string jobId;
    Clock::time_point deadline;
  };
  struct PendingRemove {
    std::string requestId;
    lt::info_hash_t infoHashes;
    Clock::time_point deadline;
  };

  json dispatch(const Request& r, bool& deferred);
  json op_add(const Request& r, bool& deferred);
  json op_select_files(Job& j, const json& args);
  json op_pause(const Request& r, Job& j, bool& deferred);
  json op_resume(Job& j);
  json op_remove(const Request& r, Job& j, bool& deferred);
  json op_set_limits(const json& args);
  json op_set_seed_policy(Job& j, const json& args);

  Job* find(const std::string& jobId);
  Job* find(const lt::torrent_handle& h);
  Job& require(const std::string& jobId);

  json files_json(const Job& j) const;
  void send_metadata(Job& j);
  json status_json(Job& j, const lt::torrent_status& st);
  std::pair<std::string, std::string> compute_state(const Job& j, const lt::torrent_status& st,
                                                    bool ignorePaused) const;
  void update_state(Job& j, const lt::torrent_status& st);
  void update_state(Job& j);
  void save_resume(Job& j, lt::resume_data_flags_t flags);
  void check_seed_policy();
  void connect_test_peers(Job& j, bool force);

  lt::session& ses_;
  Options opts_;
  Output& out_;
  std::map<std::string, Job> jobs_;
  std::vector<PendingPause> pendingPauses_;
  std::vector<PendingRemove> pendingRemoves_;

  Clock::time_point lastProgress_{};
  Clock::time_point lastSeedCheck_{};
  Clock::time_point lastResumeSave_{};

  bool shuttingDown_ = false;
  bool shutdownDone_ = false;
  std::string shutdownRequestId_;
  int outstandingResume_ = 0;
  Clock::time_point shutdownDeadline_{};
};

class EngineError : public std::runtime_error {
 public:
  EngineError(std::string code, const std::string& message) : std::runtime_error(message), code_(std::move(code)) {}
  const std::string& code() const { return code_; }

 private:
  std::string code_;
};

}  // namespace adr
