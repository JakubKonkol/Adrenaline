#include "jobs.hpp"

#include <algorithm>
#include <memory>

#include <boost/system/error_code.hpp>
#include <libtorrent/add_torrent_params.hpp>
#include <libtorrent/address.hpp>
#include <libtorrent/alert_types.hpp>
#include <libtorrent/download_priority.hpp>
#include <libtorrent/error_code.hpp>
#include <libtorrent/load_torrent.hpp>
#include <libtorrent/magnet_uri.hpp>
#include <libtorrent/read_resume_data.hpp>
#include <libtorrent/settings_pack.hpp>
#include <libtorrent/torrent_info.hpp>
#include <libtorrent/version.hpp>
#include <libtorrent/write_resume_data.hpp>

#include "resume.hpp"
#include "util.hpp"

namespace adr {

namespace {

constexpr auto kProgressInterval = std::chrono::milliseconds(500);
constexpr auto kSeedCheckInterval = std::chrono::seconds(1);
constexpr auto kPauseReplyTimeout = std::chrono::seconds(5);
constexpr auto kRemoveReplyTimeout = std::chrono::seconds(10);
constexpr auto kShutdownTimeout = std::chrono::seconds(10);
constexpr auto kEtaWindow = std::chrono::seconds(10);

std::string str_arg(const json& args, const char* key) {
  auto it = args.find(key);
  return it != args.end() && it->is_string() ? it->get<std::string>() : std::string();
}

bool bool_arg(const json& args, const char* key, bool def) {
  auto it = args.find(key);
  return it != args.end() && it->is_boolean() ? it->get<bool>() : def;
}

bool same_torrent(const lt::info_hash_t& a, const lt::info_hash_t& b) {
  if (a.has_v1() && b.has_v1()) return a.v1 == b.v1;
  if (a.has_v2() && b.has_v2()) return a.v2 == b.v2;
  return false;
}

bool is_paused(const lt::torrent_status& st) { return static_cast<bool>(st.flags & lt::torrent_flags::paused); }

// Maps a storage error to a pause reason: disk_full, disk_missing or "" (other disk error).
std::string classify_file_error(const lt::error_code& ec) {
  namespace errc = boost::system::errc;
  if (ec == errc::no_space_on_device) return "disk_full";
#ifdef _WIN32
  if (ec.category() == boost::system::system_category()) {
    switch (ec.value()) {
      case 39:   // ERROR_HANDLE_DISK_FULL
      case 112:  // ERROR_DISK_FULL
        return "disk_full";
      case 2:     // ERROR_FILE_NOT_FOUND
      case 3:     // ERROR_PATH_NOT_FOUND
      case 15:    // ERROR_INVALID_DRIVE
      case 21:    // ERROR_NOT_READY
      case 55:    // ERROR_DEV_NOT_EXIST
      case 1167:  // ERROR_DEVICE_NOT_CONNECTED
        return "disk_missing";
      default:
        break;
    }
  }
#endif
  if (ec == errc::no_such_file_or_directory || ec == errc::no_such_device || ec == errc::no_such_device_or_address)
    return "disk_missing";
  return "";
}

std::vector<lt::download_priority_t> all_dont_download(const lt::torrent_info& ti) {
  return std::vector<lt::download_priority_t>(static_cast<std::size_t>(ti.num_files()), lt::dont_download);
}

const lt::file_storage& file_layout(const lt::torrent_info& ti) {
#if LIBTORRENT_VERSION_NUM >= 20100
  return ti.layout();
#else
  return ti.files();
#endif
}

}  // namespace

JobManager::JobManager(lt::session& ses, const Options& opts, Output& out) : ses_(ses), opts_(opts), out_(out) {
  auto now = Clock::now();
  lastProgress_ = lastSeedCheck_ = lastResumeSave_ = now;
}

Job* JobManager::find(const std::string& jobId) {
  auto it = jobs_.find(jobId);
  return it == jobs_.end() ? nullptr : &it->second;
}

Job* JobManager::find(const lt::torrent_handle& h) {
  for (auto& [id, j] : jobs_)
    if (j.handle == h) return &j;
  return nullptr;
}

Job& JobManager::require(const std::string& jobId) {
  Job* j = find(jobId);
  if (!j) throw EngineError("JOB_NOT_FOUND", "unknown job");
  return *j;
}

void JobManager::handle(const Request& r) {
  if (const json* cached = out_.cached(r.id)) {
    out_.respond(r.id, *cached);
    return;
  }
  if (out_.is_pending(r.id)) return;
  json response;
  bool deferred = false;
  try {
    if (shuttingDown_ && r.op != "ping") throw EngineError("INTERNAL", "engine is shutting down");
    json result = dispatch(r, deferred);
    if (deferred) return;
    response = ok_response(r.id, std::move(result));
  } catch (const EngineError& e) {
    response = error_response(r.id, e.code(), e.what());
  } catch (const std::exception& e) {
    response = error_response(r.id, "INTERNAL", e.what());
  }
  out_.respond(r.id, std::move(response));
}

json JobManager::dispatch(const Request& r, bool& deferred) {
  const std::string& op = r.op;
  if (op == "hello") {
    return json{{"protocol", kProtocolVersion},
                {"engineVersion", ADRENALINE_VERSION},
                {"libtorrent", lt::version()},
                {"features", json::array({"v2", "resume", "selectFiles", "seedLimits"})},
                {"listenPort", ses_.listen_port()}};
  }
  if (op == "ping") return json{{"now", now_ms()}};
  if (op == "add") return op_add(r, deferred);
  if (op == "setLimits") return op_set_limits(r.args);
  if (op == "snapshot") {
    json jobs = json::array();
    for (auto& [id, j] : jobs_) jobs.push_back(status_json(j, j.handle.status()));
    return json{{"jobs", jobs}, {"seq", out_.seq()}};
  }
  if (op == "shutdown") {
    begin_shutdown(r.id);
    deferred = true;
    return json();
  }
  if (op == "selectFiles") return op_select_files(require(r.jobId), r.args);
  if (op == "files") {
    Job& j = require(r.jobId);
    return json{{"files", files_json(j)}};
  }
  if (op == "pause") return op_pause(r, require(r.jobId), deferred);
  if (op == "resume") return op_resume(require(r.jobId));
  if (op == "remove") return op_remove(r, require(r.jobId), deferred);
  if (op == "recheck") {
    Job& j = require(r.jobId);
    j.error.reset();
    j.handle.clear_error();
    j.handle.force_recheck();
    return json{{"ok", true}};
  }
  if (op == "setSeedPolicy") return op_set_seed_policy(require(r.jobId), r.args);
  throw EngineError("UNKNOWN_OP", "unknown op: " + op);
}

json JobManager::op_add(const Request& r, bool& deferred) {
  if (!valid_job_id(r.jobId)) throw EngineError("BAD_REQUEST", "invalid jobId");
  const std::string savePath = str_arg(r.args, "savePath");
  if (savePath.empty()) throw EngineError("BAD_REQUEST", "savePath required");

  lt::add_torrent_params atp;
  lt::error_code ec;
  const std::string magnet = str_arg(r.args, "magnet");
  const std::string torrentB64 = str_arg(r.args, "torrentBase64");
  lt::info_hash_t requested;
  if (!magnet.empty()) {
    atp = lt::parse_magnet_uri(magnet, ec);
    if (ec) throw EngineError("INVALID_MAGNET", ec.message());
    requested = atp.info_hashes;
  } else if (!torrentB64.empty()) {
    auto bytes = base64_decode(torrentB64);
    if (!bytes) throw EngineError("INVALID_TORRENT", "invalid base64");
    try {
      atp = lt::load_torrent_buffer(*bytes);
    } catch (const std::exception& error) {
      throw EngineError("INVALID_TORRENT", error.what());
    }
    requested = atp.ti->info_hashes();
  } else {
    throw EngineError("BAD_REQUEST", "magnet or torrentBase64 required");
  }

  if (Job* existing = find(r.jobId)) {
    if (!same_torrent(existing->infoHashes, requested))
      throw EngineError("JOB_EXISTS_DIFFERENT_HASH", "job exists with a different torrent");
    auto st = existing->handle.status();
    return json{{"jobId", existing->id},
                {"infoHashV1", hex_v1(existing->infoHashes)},
                {"infoHashV2", hex_v2(existing->infoHashes)},
                {"hasMetadata", st.has_metadata}};
  }

  // Resume data (written by this engine earlier) restores progress and file priorities without a full recheck.
  bool fromResume = false;
  if (auto buf = read_file(resume_path(opts_.dataDir, r.jobId))) {
    lt::error_code rec;
    lt::add_torrent_params resumed = lt::read_resume_data(*buf, rec);
    if (!rec && same_torrent(resumed.info_hashes, requested)) {
      const auto restore_metadata = [&resumed](const lt::add_torrent_params& metadata) {
        resumed.ti = metadata.ti;
        if (resumed.merkle_trees.empty()) {
          resumed.merkle_trees = metadata.merkle_trees;
          resumed.merkle_tree_mask = metadata.merkle_tree_mask;
          resumed.verified_leaf_hashes = metadata.verified_leaf_hashes;
        }
      };
      if (!resumed.ti && atp.ti) restore_metadata(atp);
      if (!resumed.ti) {
        // Metadata may only be in the .torrent file saved after the metadata arrived.
        if (auto tbuf = read_file(torrent_path(opts_.dataDir, r.jobId))) {
          try {
            auto metadata = lt::load_torrent_buffer(*tbuf);
            if (same_torrent(metadata.ti->info_hashes(), requested)) restore_metadata(metadata);
          } catch (const std::exception&) {
            // An unreadable cached .torrent is recoverable: peers can supply metadata again.
          }
        }
      }
      resumed.trackers.insert(resumed.trackers.end(), atp.trackers.begin(), atp.trackers.end());
      atp = std::move(resumed);
      fromResume = true;
    }
  }

  const bool paused = bool_arg(r.args, "paused", false);
  atp.save_path = savePath;
  atp.flags &= ~lt::torrent_flags::auto_managed;  // D-43: main runs the queue
  atp.flags &= ~lt::torrent_flags::duplicate_is_error;
  if (paused)
    atp.flags |= lt::torrent_flags::paused;
  else
    atp.flags &= ~lt::torrent_flags::paused;
  if (!fromResume && atp.ti) atp.file_priorities = all_dont_download(*atp.ti);

  lt::torrent_handle h = ses_.add_torrent(std::move(atp), ec);
  if (ec) throw EngineError("INVALID_TORRENT", ec.message());
  if (find(h)) throw EngineError("BAD_REQUEST", "torrent already added under another jobId");

  Job j;
  j.id = r.jobId;
  j.handle = h;
  j.infoHashes = h.info_hashes();
  if (paused) j.pauseReason = "user";
  if (opts_.testMode) {
    auto it = r.args.find("peers");
    if (it != r.args.end() && it->is_array()) {
      for (const auto& p : *it) {
        if (!p.is_string()) continue;
        std::string s = p.get<std::string>();
        auto colon = s.rfind(':');
        if (colon == std::string::npos) continue;
        j.testPeers.emplace_back(s.substr(0, colon), std::stoi(s.substr(colon + 1)));
      }
    }
  }
  auto [it, inserted] = jobs_.emplace(j.id, std::move(j));
  Job& job = it->second;
  connect_test_peers(job, true);

  auto st = h.status();
  json result{{"jobId", job.id},
              {"infoHashV1", hex_v1(job.infoHashes)},
              {"infoHashV2", hex_v2(job.infoHashes)},
              {"hasMetadata", st.has_metadata}};
  if (st.has_metadata) {
    // Reply first, then the metadata event (main may use either).
    out_.respond(r.id, ok_response(r.id, result));
    send_metadata(job);
    update_state(job, st);
    deferred = true;
    return json();
  }
  update_state(job, st);
  return result;
}

json JobManager::op_select_files(Job& j, const json& args) {
  auto ti = j.handle.torrent_file();
  if (!ti) throw EngineError("BAD_REQUEST", "metadata not available yet");
  auto prios = all_dont_download(*ti);
  auto it = args.find("files");
  if (it == args.end() || !it->is_array()) throw EngineError("BAD_REQUEST", "files required");
  for (const auto& f : *it) {
    if (!f.is_object() || !f.contains("index") || !f["index"].is_number_integer())
      throw EngineError("BAD_REQUEST", "files[].index required");
    int index = f["index"].get<int>();
    int priority = f.contains("priority") && f["priority"].is_number_integer() ? f["priority"].get<int>() : 4;
    if (index < 0 || index >= ti->num_files()) throw EngineError("BAD_REQUEST", "file index out of range");
    priority = std::clamp(priority, 0, 7);
    prios[static_cast<std::size_t>(index)] = lt::download_priority_t(static_cast<std::uint8_t>(priority));
  }
  j.handle.prioritize_files(prios);
  j.hasSelection = true;
  j.selectedFiles.clear();
  for (std::size_t i = 0; i < prios.size(); ++i)
    if (prios[i] != lt::dont_download) j.selectedFiles.push_back(static_cast<int>(i));
  j.doneFlushed = false;
  save_resume(j, lt::torrent_handle::save_info_dict);
  update_state(j);
  return json{{"ok", true}};
}

json JobManager::op_pause(const Request& r, Job& j, bool& deferred) {
  j.pauseReason = "user";
  j.stopped = false;
  j.handle.unset_flags(lt::torrent_flags::auto_managed);
  auto st = j.handle.status();
  if (is_paused(st)) {
    update_state(j, st);
    return json{{"state", "paused"}};
  }
  j.handle.pause();
  // Resume data is saved after the pause so it reflects the stopped torrent.
  save_resume(j, lt::torrent_handle::save_info_dict | lt::torrent_handle::flush_disk_cache);
  pendingPauses_.push_back({r.id, j.id, Clock::now() + kPauseReplyTimeout});
  out_.mark_pending(r.id);
  deferred = true;
  return json();
}

json JobManager::op_resume(Job& j) {
  j.pauseReason.clear();
  j.stopped = false;
  j.error.reset();
  j.handle.clear_error();
  j.handle.unset_flags(lt::torrent_flags::auto_managed);
  j.handle.resume();
  connect_test_peers(j, true);
  auto st = j.handle.status();
  return json{{"state", compute_state(j, st, true).first}};
}

json JobManager::op_remove(const Request& r, Job& j, bool& deferred) {
  const bool deleteFiles = bool_arg(r.args, "deleteFiles", false);
  lt::info_hash_t ih = j.infoHashes;
  ses_.remove_torrent(j.handle, deleteFiles ? lt::session_handle::delete_files : lt::remove_flags_t{});
  remove_job_files(opts_.dataDir, j.id);
  pendingPauses_.erase(std::remove_if(pendingPauses_.begin(), pendingPauses_.end(),
                                      [&](const PendingPause& p) {
                                        if (p.jobId != j.id) return false;
                                        out_.respond(p.requestId, ok_response(p.requestId, json{{"state", "paused"}}));
                                        return true;
                                      }),
                       pendingPauses_.end());
  jobs_.erase(j.id);
  if (deleteFiles) {
    pendingRemoves_.push_back({r.id, ih, Clock::now() + kRemoveReplyTimeout});
    out_.mark_pending(r.id);
    deferred = true;
    return json();
  }
  return json{{"ok", true}};
}

json JobManager::op_set_limits(const json& args) {
  lt::settings_pack p;
  auto num = [&](const char* key) -> std::optional<int> {
    auto it = args.find(key);
    if (it == args.end() || !it->is_number()) return std::nullopt;
    double v = it->get<double>();
    return static_cast<int>(std::clamp(v, 0.0, 2147483647.0));
  };
  if (auto v = num("downloadBps")) p.set_int(lt::settings_pack::download_rate_limit, *v);
  if (auto v = num("uploadBps")) p.set_int(lt::settings_pack::upload_rate_limit, *v);
  if (auto v = num("maxConnections")) p.set_int(lt::settings_pack::connections_limit, *v == 0 ? 200 : *v);
  ses_.apply_settings(std::move(p));
  return json{{"ok", true}};
}

json JobManager::op_set_seed_policy(Job& j, const json& args) {
  auto ratio = args.find("ratio");
  auto minutes = args.find("minutes");
  j.seedRatio = ratio != args.end() && ratio->is_number() ? std::optional<double>(ratio->get<double>()) : std::nullopt;
  j.seedMinutes =
      minutes != args.end() && minutes->is_number() ? std::optional<int>(minutes->get<int>()) : std::nullopt;
  return json{{"ok", true}};
}

json JobManager::files_json(const Job& j) const {
  json files = json::array();
  auto ti = j.handle.torrent_file();
  if (!ti) return files;
  const auto& fs = file_layout(*ti);
  for (auto i : fs.file_range()) {
    std::string path = fs.file_path(i);
    std::replace(path.begin(), path.end(), '\\', '/');
    files.push_back(json{{"index", static_cast<int>(i)},
                         {"path", path},
                         {"size", fs.file_size(i)},
                         {"pad", fs.pad_file_at(i)}});
  }
  return files;
}

void JobManager::send_metadata(Job& j) {
  auto ti = j.handle.torrent_file();
  if (!ti || j.metadataSent) return;
  j.metadataSent = true;
  j.infoHashes = j.handle.info_hashes();
  out_.event("metadata", json{{"jobId", j.id},
                              {"name", ti->name()},
                              {"files", files_json(j)},
                              {"totalSize", ti->total_size()},
                              {"infoHashV1", hex_v1(j.infoHashes)},
                              {"infoHashV2", hex_v2(j.infoHashes)}});
}

std::pair<std::string, std::string> JobManager::compute_state(const Job& j, const lt::torrent_status& st,
                                                              bool ignorePaused) const {
  if (!ignorePaused && (j.pauseReason == "disk_full" || j.pauseReason == "disk_missing" || j.pauseReason == "disk_error"))
    return {"paused", j.pauseReason};
  if (st.errc && !ignorePaused) return {"error", ""};
  if (is_paused(st) && !ignorePaused) {
    if (j.stopped) return {"stopped", "seed_limit"};
    return {"paused", j.pauseReason.empty() ? "user" : j.pauseReason};
  }
  switch (st.state) {
    case lt::torrent_status::checking_files:
    case lt::torrent_status::checking_resume_data:
      return {"checking", ""};
    case lt::torrent_status::downloading_metadata:
      return {"fetching_metadata", ""};
    case lt::torrent_status::finished:
    case lt::torrent_status::seeding:
      return {j.hasSelection && j.doneFlushed ? "seeding" : "downloading", ""};
    case lt::torrent_status::downloading:
    default:
      return {"downloading", ""};
  }
}

void JobManager::update_state(Job& j) { update_state(j, j.handle.status()); }

void JobManager::update_state(Job& j, const lt::torrent_status& st) {
  const bool complete =
      (st.state == lt::torrent_status::finished || st.state == lt::torrent_status::seeding) && selected_complete(j);
  if (!complete) {
    j.doneFlushed = false;
  } else if (j.hasSelection && !j.doneFlushed && !j.flushForDone) {
    j.flushForDone = true;
    save_resume(j, lt::torrent_handle::save_info_dict);
  }
  auto [state, reason] = compute_state(j, st, false);
  if (state == j.lastState && reason == j.lastReason) return;
  if (state == "seeding" && j.lastState != "seeding" && j.lastState != "downloaded") {
    out_.event("state", json{{"jobId", j.id}, {"state", "downloaded"}});
  }
  json data{{"jobId", j.id}, {"state", state}};
  if (!reason.empty()) data["reason"] = reason;
  if (j.error) data["error"] = *j.error;
  else if (st.errc) data["error"] = json{{"code", "INTERNAL"}, {"message", st.errc.message()}};
  out_.event("state", std::move(data));
  j.lastState = state;
  j.lastReason = reason;
}

json JobManager::status_json(Job& j, const lt::torrent_status& st) {
  std::int64_t selected = 0;
  std::int64_t done = 0;
  json files = json::array();
  auto ti = j.handle.torrent_file();
  if (ti && j.hasSelection) {
    auto prios = j.handle.get_file_priorities();
    std::vector<std::int64_t> progress;
    j.handle.file_progress(progress);
    const auto& fs = file_layout(*ti);
    for (auto i : fs.file_range()) {
      auto idx = static_cast<std::size_t>(static_cast<int>(i));
      if (fs.pad_file_at(i) || idx >= prios.size() || prios[idx] == lt::dont_download) continue;
      std::int64_t fileDone = idx < progress.size() ? progress[idx] : 0;
      selected += fs.file_size(i);
      done += fileDone;
      files.push_back(json{{"index", static_cast<int>(idx)}, {"doneBytes", fileDone}});
    }
  }

  // ETA from the average over the last 10 s; null when unknown or slower than 1 KiB/s (BR08).
  auto now = Clock::now();
  j.samples.emplace_back(now, done);
  while (j.samples.size() > 2 && j.samples[1].first <= now - kEtaWindow) j.samples.pop_front();
  json eta = nullptr;
  if (selected > 0 && done >= selected) {
    eta = 0;
  } else if (j.samples.size() >= 2) {
    double secs = std::chrono::duration<double>(now - j.samples.front().first).count();
    if (secs >= 2.0) {
      double rate = static_cast<double>(done - j.samples.front().second) / secs;
      if (rate >= 1024.0) eta = static_cast<std::int64_t>(static_cast<double>(selected - done) / rate);
    }
  }

  auto [state, reason] = compute_state(j, st, false);
  json s{{"jobId", j.id},
         {"state", state},
         {"hasMetadata", st.has_metadata},
         {"selectedBytes", selected},
         {"selectedDoneBytes", done},
         {"files", files},
         {"downloadRate", st.download_payload_rate},
         {"uploadRate", st.upload_payload_rate},
         {"peers", st.num_peers},
         {"seeds", st.num_seeds},
         {"ratio", selected > 0 ? static_cast<double>(st.all_time_upload) / static_cast<double>(selected) : 0.0},
         {"seedingSeconds", (state == "seeding" || state == "stopped") ? st.finished_duration.count() : 0},
         {"etaSeconds", eta}};
  if (!reason.empty()) s["reason"] = reason;
  return s;
}

void JobManager::save_resume(Job& j, lt::resume_data_flags_t flags) {
  if (!j.handle.is_valid()) return;
  // Always flush: resume data must never claim pieces that are still only in the write cache (a crash would
  // then leave a corrupted file that is trusted on restart).
  ++j.saveOutstanding;
  j.handle.save_resume_data(flags | lt::torrent_handle::flush_disk_cache);
}

bool JobManager::selected_complete(const Job& j) const {
  if (!j.hasSelection || j.selectedFiles.empty()) return false;
  auto ti = j.handle.torrent_file();
  if (!ti) return false;
  std::vector<std::int64_t> progress;
  j.handle.file_progress(progress);
  const auto& fs = file_layout(*ti);
  for (int index : j.selectedFiles) {
    auto idx = static_cast<std::size_t>(index);
    if (idx >= progress.size() || progress[idx] < fs.file_size(lt::file_index_t{index})) return false;
  }
  return true;
}

void JobManager::on_save_finished(Job& j) {
  if (j.saveOutstanding > 0) --j.saveOutstanding;
  if (j.saveOutstanding > 0) return;
  for (int index : j.pendingFiles) out_.event("fileCompleted", json{{"jobId", j.id}, {"index", index}});
  j.pendingFiles.clear();
  if (j.flushForDone) {
    j.flushForDone = false;
    auto st = j.handle.status();
    j.doneFlushed =
        (st.state == lt::torrent_status::finished || st.state == lt::torrent_status::seeding) && selected_complete(j);
    update_state(j, st);
  }
}

void JobManager::connect_test_peers(Job& j, bool force) {
  if (!opts_.testMode || j.testPeers.empty()) return;
  auto now = Clock::now();
  if (!force && now - j.lastPeerConnect < std::chrono::seconds(2)) return;
  j.lastPeerConnect = now;
  for (const auto& [host, port] : j.testPeers) {
    lt::error_code ec;
    auto addr = lt::make_address(host, ec);
    if (!ec) j.handle.connect_peer(lt::tcp::endpoint(addr, static_cast<std::uint16_t>(port)));
  }
}

void JobManager::check_seed_policy() {
  for (auto& [id, j] : jobs_) {
    if (!j.hasSelection || j.stopped || (!j.seedRatio && !j.seedMinutes)) continue;
    auto st = j.handle.status();
    if (is_paused(st)) continue;
    if (st.state != lt::torrent_status::finished && st.state != lt::torrent_status::seeding) continue;
    json s = status_json(j, st);
    double ratio = s["ratio"].get<double>();
    bool limit = (j.seedRatio && ratio >= *j.seedRatio) ||
                 (j.seedMinutes && st.finished_duration.count() >= static_cast<std::int64_t>(*j.seedMinutes) * 60);
    if (limit) {
      j.stopped = true;
      j.pauseReason = "seed_limit";
      j.handle.pause();
      save_resume(j, lt::torrent_handle::save_info_dict);
    }
  }
}

void JobManager::on_alert(lt::alert* a) {
  if (auto* sr = lt::alert_cast<lt::save_resume_data_alert>(a)) {
    if (Job* j = find(sr->handle)) {
      std::string error;
      atomic_write(resume_path(opts_.dataDir, j->id), lt::write_resume_data_buf(sr->params), error);
      auto tpath = torrent_path(opts_.dataDir, j->id);
      std::error_code fec;
      if (sr->params.ti && !std::filesystem::exists(tpath, fec)) {
        atomic_write(tpath, lt::write_torrent_file_buf(sr->params, {}), error);
      }
      out_.event("resumeSaved", json{{"jobId", j->id}});
      on_save_finished(*j);
    }
    if (shuttingDown_ && outstandingResume_ > 0) --outstandingResume_;
    return;
  }
  if (auto* sf = lt::alert_cast<lt::save_resume_data_failed_alert>(a)) {
    if (Job* j = find(sf->handle)) on_save_finished(*j);
    if (shuttingDown_ && outstandingResume_ > 0) --outstandingResume_;
    return;
  }
  if (auto* m = lt::alert_cast<lt::metadata_received_alert>(a)) {
    if (Job* j = find(m->handle)) {
      if (!j->hasSelection) {
        if (auto ti = j->handle.torrent_file()) j->handle.prioritize_files(all_dont_download(*ti));
      }
      send_metadata(*j);
      save_resume(*j, lt::torrent_handle::save_info_dict);
      update_state(*j);
    }
    return;
  }
  if (auto* p = lt::alert_cast<lt::torrent_paused_alert>(a)) {
    if (Job* j = find(p->handle)) {
      auto st = j->handle.status();
      update_state(*j, st);
      std::string state = compute_state(*j, st, false).first;
      pendingPauses_.erase(
          std::remove_if(pendingPauses_.begin(), pendingPauses_.end(),
                         [&](const PendingPause& pp) {
                           if (pp.jobId != j->id) return false;
                           out_.respond(pp.requestId, ok_response(pp.requestId, json{{"state", state}}));
                           return true;
                         }),
          pendingPauses_.end());
    }
    return;
  }
  if (auto* fc = lt::alert_cast<lt::file_completed_alert>(a)) {
    if (Job* j = find(fc->handle)) {
      if (j->hasSelection) {
        j->pendingFiles.push_back(static_cast<int>(fc->index));
        save_resume(*j, lt::torrent_handle::save_info_dict);
      }
    }
    return;
  }
  if (auto* fe = lt::alert_cast<lt::file_error_alert>(a)) {
    if (Job* j = find(fe->handle)) {
      std::string reason = classify_file_error(fe->error);
      std::string code = reason == "disk_full" ? "DISK_FULL" : "DISK_ERROR";
      j->pauseReason = reason.empty() ? "disk_error" : reason;
      j->error = json{{"code", code}, {"message", fe->error.message()}};
      j->handle.pause();
      update_state(*j);
      out_.event("log", json{{"level", "warn"}, {"message", "file error: " + fe->error.message()}});
    }
    return;
  }
  if (auto* te = lt::alert_cast<lt::torrent_error_alert>(a)) {
    if (Job* j = find(te->handle)) {
      if (!j->error) j->error = json{{"code", "INTERNAL"}, {"message", te->error.message()}};
      update_state(*j);
    }
    return;
  }
  if (auto* su = lt::alert_cast<lt::state_update_alert>(a)) {
    json jobs = json::array();
    for (const auto& st : su->status) {
      if (Job* j = find(st.handle)) {
        update_state(*j, st);
        jobs.push_back(status_json(*j, st));
      }
    }
    if (!jobs.empty() && !shuttingDown_) out_.event("progress", json{{"jobs", jobs}});
    return;
  }
  if (auto* td = lt::alert_cast<lt::torrent_deleted_alert>(a)) {
    for (auto it = pendingRemoves_.begin(); it != pendingRemoves_.end();) {
      if (same_torrent(it->infoHashes, td->info_hashes)) {
        out_.respond(it->requestId, ok_response(it->requestId, json{{"ok", true}}));
        it = pendingRemoves_.erase(it);
      } else {
        ++it;
      }
    }
    return;
  }
  if (auto* tdf = lt::alert_cast<lt::torrent_delete_failed_alert>(a)) {
    for (auto it = pendingRemoves_.begin(); it != pendingRemoves_.end();) {
      if (same_torrent(it->infoHashes, tdf->info_hashes)) {
        out_.respond(it->requestId, error_response(it->requestId, "DISK_ERROR", tdf->error.message()));
        it = pendingRemoves_.erase(it);
      } else {
        ++it;
      }
    }
    return;
  }
  lt::torrent_handle changed;
  if (auto* x = lt::alert_cast<lt::state_changed_alert>(a)) changed = x->handle;
  else if (auto* y = lt::alert_cast<lt::torrent_resumed_alert>(a)) changed = y->handle;
  else if (auto* z = lt::alert_cast<lt::torrent_finished_alert>(a)) changed = z->handle;
  else if (auto* w = lt::alert_cast<lt::torrent_checked_alert>(a)) changed = w->handle;
  if (changed.is_valid()) {
    if (Job* j = find(changed)) update_state(*j);
    return;
  }
  if (auto* lf = lt::alert_cast<lt::listen_failed_alert>(a)) {
    out_.event("log", json{{"level", "warn"}, {"message", "listen failed: " + lf->error.message()}});
  }
}

void JobManager::tick() {
  auto now = Clock::now();
  if (now - lastProgress_ >= kProgressInterval) {
    lastProgress_ = now;
    ses_.post_torrent_updates();
    for (auto& [id, j] : jobs_) {
      if (opts_.testMode && !j.testPeers.empty()) {
        auto st = j.handle.status();
        if (st.num_peers == 0 && !is_paused(st)) connect_test_peers(j, false);
      }
    }
  }
  if (now - lastSeedCheck_ >= kSeedCheckInterval) {
    lastSeedCheck_ = now;
    if (!shuttingDown_) check_seed_policy();
  }
  if (now - lastResumeSave_ >= std::chrono::seconds(opts_.resumeIntervalSec)) {
    lastResumeSave_ = now;
    for (auto& [id, j] : jobs_)
      if (j.handle.need_save_resume_data()) save_resume(j, lt::torrent_handle::save_info_dict | lt::torrent_handle::only_if_modified);
  }
  for (auto it = pendingPauses_.begin(); it != pendingPauses_.end();) {
    if (now >= it->deadline) {
      out_.respond(it->requestId, ok_response(it->requestId, json{{"state", "paused"}, {"pending", true}}));
      it = pendingPauses_.erase(it);
    } else {
      ++it;
    }
  }
  for (auto it = pendingRemoves_.begin(); it != pendingRemoves_.end();) {
    if (now >= it->deadline) {
      out_.respond(it->requestId, ok_response(it->requestId, json{{"ok", true}, {"pending", true}}));
      it = pendingRemoves_.erase(it);
    } else {
      ++it;
    }
  }
  if (shuttingDown_ && !shutdownDone_ && (outstandingResume_ <= 0 || now >= shutdownDeadline_)) {
    save_session_state(ses_, opts_);
    if (!shutdownRequestId_.empty())
      out_.respond(shutdownRequestId_, ok_response(shutdownRequestId_, json{{"ok", true}}));
    shutdownDone_ = true;
  }
}

void JobManager::begin_shutdown(const std::string& requestId) {
  if (!requestId.empty()) {
    shutdownRequestId_ = requestId;
    out_.mark_pending(requestId);
  }
  if (shuttingDown_) return;
  shuttingDown_ = true;
  shutdownDeadline_ = Clock::now() + kShutdownTimeout;
  ses_.pause();
  for (auto& [id, j] : jobs_) {
    if (!j.handle.is_valid()) continue;
    save_resume(j, lt::torrent_handle::save_info_dict);
    ++outstandingResume_;
  }
}

}  // namespace adr
