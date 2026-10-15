#include "util.hpp"

#include <chrono>
#include <sstream>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <shellapi.h>
#include <windows.h>
#endif

namespace adr {

std::filesystem::path u8path(const std::string& utf8) {
#if defined(__cpp_char8_t)
  return std::filesystem::path(std::u8string(utf8.begin(), utf8.end()));
#else
  return std::filesystem::u8path(utf8);
#endif
}

std::string path_to_utf8(const std::filesystem::path& p) {
  auto s = p.u8string();
  return std::string(s.begin(), s.end());
}

std::optional<std::vector<char>> base64_decode(const std::string& in) {
  auto value = [](char c) -> int {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+' || c == '-') return 62;
    if (c == '/' || c == '_') return 63;
    return -1;
  };
  std::vector<char> out;
  out.reserve(in.size() * 3 / 4);
  std::uint32_t buf = 0;
  int bits = 0;
  for (char c : in) {
    if (c == '=' || c == '\n' || c == '\r' || c == ' ') continue;
    int v = value(c);
    if (v < 0) return std::nullopt;
    buf = (buf << 6) | static_cast<std::uint32_t>(v);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push_back(static_cast<char>((buf >> bits) & 0xff));
    }
  }
  return out;
}

namespace {
template <typename Hash>
std::string to_hex(const Hash& h) {
  std::ostringstream os;
  os << h;
  return os.str();
}
}  // namespace

std::string hex_v1(const lt::info_hash_t& ih) { return ih.has_v1() ? to_hex(ih.v1) : std::string(); }
std::string hex_v2(const lt::info_hash_t& ih) { return ih.has_v2() ? to_hex(ih.v2) : std::string(); }

std::int64_t now_ms() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

bool valid_job_id(const std::string& id) {
  if (id.empty() || id.size() > 64) return false;
  for (char c : id) {
    bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-';
    if (!ok) return false;
  }
  return true;
}

std::vector<std::string> utf8_args(int argc, char** argv) {
  std::vector<std::string> args;
#ifdef _WIN32
  (void)argv;
  int n = 0;
  LPWSTR* wargv = CommandLineToArgvW(GetCommandLineW(), &n);
  for (int i = 0; i < n; ++i) {
    int len = WideCharToMultiByte(CP_UTF8, 0, wargv[i], -1, nullptr, 0, nullptr, nullptr);
    std::string s(static_cast<size_t>(len > 0 ? len - 1 : 0), '\0');
    if (len > 1) WideCharToMultiByte(CP_UTF8, 0, wargv[i], -1, s.data(), len, nullptr, nullptr);
    args.push_back(std::move(s));
  }
  LocalFree(wargv);
  (void)argc;
#else
  for (int i = 0; i < argc; ++i) args.emplace_back(argv[i]);
#endif
  return args;
}

void set_binary_stdio() {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif
}

}  // namespace adr
