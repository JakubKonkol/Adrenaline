#pragma once

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

#include <libtorrent/info_hash.hpp>

namespace adr {

// UTF-8 string -> filesystem path (on Windows std::filesystem::path(std::string) would use the ANSI code page).
std::filesystem::path u8path(const std::string& utf8);
std::string path_to_utf8(const std::filesystem::path& p);

std::optional<std::vector<char>> base64_decode(const std::string& in);

std::string hex_v1(const lt::info_hash_t& ih);  // "" when the torrent has no v1 hash
std::string hex_v2(const lt::info_hash_t& ih);  // "" when the torrent has no v2 hash

std::int64_t now_ms();

// Job ids come from main (UUIDs); they also name files in the data dir, so only [A-Za-z0-9-] is accepted.
bool valid_job_id(const std::string& id);

// Command-line arguments as UTF-8 (wide arguments on Windows).
std::vector<std::string> utf8_args(int argc, char** argv);

// stdin/stdout without newline translation on Windows.
void set_binary_stdio();

}  // namespace adr
