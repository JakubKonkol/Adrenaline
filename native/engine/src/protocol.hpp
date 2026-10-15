#pragma once

#include <cstdint>
#include <deque>
#include <optional>
#include <string>
#include <unordered_map>
#include <unordered_set>

#include <nlohmann/json.hpp>

namespace adr {

using json = nlohmann::json;

constexpr int kProtocolVersion = 1;

struct Request {
  std::string id;
  std::string op;
  std::string jobId;
  json args = json::object();
};

// Parses one JSON Lines request. On failure returns nullopt, fills `error` and, if it could be read, `id`.
std::optional<Request> parse_request(const std::string& line, std::string& id, std::string& error);

json ok_response(const std::string& id, json result);
json error_response(const std::string& id, const std::string& code, const std::string& message);

// Writes responses and events to stdout (one JSON object per line). Remembers the last 256 responses by id so a
// retried request (same id) gets the same answer instead of running twice (idempotency, 02-protokol-silnika.md).
class Output {
 public:
  void respond(const std::string& id, json response);
  void event(const std::string& name, json data);

  // Cached response for a retried id, or nullptr.
  const json* cached(const std::string& id) const;

  // Ids whose response is still pending (e.g. pause waiting for the alert); retries of those are ignored.
  void mark_pending(const std::string& id) { pending_.insert(id); }
  bool is_pending(const std::string& id) const { return pending_.count(id) > 0; }

  std::uint64_t seq() const { return seq_; }

 private:
  void write(const json& j);

  std::uint64_t seq_ = 0;
  std::deque<std::string> order_;
  std::unordered_map<std::string, json> cache_;
  std::unordered_set<std::string> pending_;
};

}  // namespace adr
