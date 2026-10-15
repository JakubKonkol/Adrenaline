#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace adr {

// Atomic write: <path>.tmp -> flush/fsync -> rename over <path> (MoveFileExW with WRITE_THROUGH on Windows).
bool atomic_write(const std::filesystem::path& path, const std::vector<char>& data, std::string& error);

std::optional<std::vector<char>> read_file(const std::filesystem::path& path);

// Files of one job in the data dir: <jobId>.resume and <jobId>.torrent.
std::filesystem::path resume_path(const std::filesystem::path& dataDir, const std::string& jobId);
std::filesystem::path torrent_path(const std::filesystem::path& dataDir, const std::string& jobId);
void remove_job_files(const std::filesystem::path& dataDir, const std::string& jobId);

}  // namespace adr
