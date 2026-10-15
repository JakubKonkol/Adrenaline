#include "resume.hpp"

#include <cstdio>
#include <fstream>
#include <iterator>
#include <system_error>

#ifdef _WIN32
#include <windows.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

namespace adr {

bool atomic_write(const std::filesystem::path& path, const std::vector<char>& data, std::string& error) {
  std::filesystem::path tmp = path;
  tmp += ".tmp";
#ifdef _WIN32
  HANDLE h = CreateFileW(tmp.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (h == INVALID_HANDLE_VALUE) {
    error = "cannot create temp file";
    return false;
  }
  DWORD written = 0;
  BOOL ok = WriteFile(h, data.data(), static_cast<DWORD>(data.size()), &written, nullptr);
  ok = ok && written == data.size() && FlushFileBuffers(h);
  CloseHandle(h);
  if (!ok) {
    error = "cannot write temp file";
    DeleteFileW(tmp.c_str());
    return false;
  }
  if (!MoveFileExW(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
    error = "cannot rename temp file";
    DeleteFileW(tmp.c_str());
    return false;
  }
  return true;
#else
  int fd = ::open(tmp.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd < 0) {
    error = "cannot create temp file";
    return false;
  }
  std::size_t off = 0;
  while (off < data.size()) {
    ssize_t n = ::write(fd, data.data() + off, data.size() - off);
    if (n <= 0) {
      ::close(fd);
      ::unlink(tmp.c_str());
      error = "cannot write temp file";
      return false;
    }
    off += static_cast<std::size_t>(n);
  }
  bool ok = ::fsync(fd) == 0;
  ::close(fd);
  if (!ok || std::rename(tmp.c_str(), path.c_str()) != 0) {
    ::unlink(tmp.c_str());
    error = "cannot rename temp file";
    return false;
  }
  return true;
#endif
}

std::optional<std::vector<char>> read_file(const std::filesystem::path& path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return std::nullopt;
  std::vector<char> data((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
  return data;
}

std::filesystem::path resume_path(const std::filesystem::path& dataDir, const std::string& jobId) {
  return dataDir / (jobId + ".resume");
}

std::filesystem::path torrent_path(const std::filesystem::path& dataDir, const std::string& jobId) {
  return dataDir / (jobId + ".torrent");
}

void remove_job_files(const std::filesystem::path& dataDir, const std::string& jobId) {
  std::error_code ec;
  std::filesystem::remove(resume_path(dataDir, jobId), ec);
  std::filesystem::remove(torrent_path(dataDir, jobId), ec);
  auto tmp = resume_path(dataDir, jobId);
  tmp += ".tmp";
  std::filesystem::remove(tmp, ec);
}

}  // namespace adr
