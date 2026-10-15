#include "protocol.hpp"

#include <iostream>

namespace adr {

namespace {
constexpr std::size_t kCacheSize = 256;
}

std::optional<Request> parse_request(const std::string& line, std::string& id, std::string& error) {
  json j = json::parse(line, nullptr, false);
  if (j.is_discarded() || !j.is_object()) {
    error = "invalid JSON";
    return std::nullopt;
  }
  if (j.contains("id") && j["id"].is_string()) id = j["id"].get<std::string>();
  if (id.empty()) {
    error = "missing id";
    return std::nullopt;
  }
  if (!j.contains("v") || !j["v"].is_number_integer() || j["v"].get<int>() != kProtocolVersion) {
    error = "unsupported protocol version";
    return std::nullopt;
  }
  if (!j.contains("op") || !j["op"].is_string()) {
    error = "missing op";
    return std::nullopt;
  }
  Request r;
  r.id = id;
  r.op = j["op"].get<std::string>();
  if (j.contains("jobId") && j["jobId"].is_string()) r.jobId = j["jobId"].get<std::string>();
  if (j.contains("args")) {
    if (!j["args"].is_object()) {
      error = "args must be an object";
      return std::nullopt;
    }
    r.args = j["args"];
  }
  return r;
}

json ok_response(const std::string& id, json result) {
  return json{{"v", kProtocolVersion}, {"id", id}, {"ok", true}, {"result", std::move(result)}};
}

json error_response(const std::string& id, const std::string& code, const std::string& message) {
  return json{{"v", kProtocolVersion}, {"id", id}, {"ok", false}, {"error", {{"code", code}, {"message", message}}}};
}

void Output::write(const json& j) {
  // Invalid UTF-8 (e.g. a broken file name inside a torrent) is replaced instead of throwing.
  std::cout << j.dump(-1, ' ', false, json::error_handler_t::replace) << '\n';
  std::cout.flush();
}

void Output::respond(const std::string& id, json response) {
  pending_.erase(id);
  write(response);
  if (cache_.find(id) == cache_.end()) order_.push_back(id);
  cache_[id] = std::move(response);
  while (order_.size() > kCacheSize) {
    cache_.erase(order_.front());
    order_.pop_front();
  }
}

void Output::event(const std::string& name, json data) {
  write(json{{"v", kProtocolVersion}, {"event", name}, {"seq", ++seq_}, {"data", std::move(data)}});
}

const json* Output::cached(const std::string& id) const {
  auto it = cache_.find(id);
  return it == cache_.end() ? nullptr : &it->second;
}

}  // namespace adr
