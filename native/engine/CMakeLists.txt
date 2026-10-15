cmake_minimum_required(VERSION 3.21)
project(adrenaline_engine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(ADRENALINE_VERSION "0.0.0" CACHE STRING "Engine version (from package.json)")

find_package(LibtorrentRasterbar CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)

add_executable(adrenaline-engine
  src/main.cpp
  src/protocol.cpp
  src/session.cpp
  src/jobs.cpp
  src/resume.cpp
  src/util.cpp
)

target_compile_definitions(adrenaline-engine PRIVATE ADRENALINE_VERSION="${ADRENALINE_VERSION}")
target_link_libraries(adrenaline-engine PRIVATE LibtorrentRasterbar::torrent-rasterbar nlohmann_json::nlohmann_json)

if(MSVC)
  set_property(TARGET adrenaline-engine PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded")
  target_compile_options(adrenaline-engine PRIVATE /W4 /utf-8 /permissive- /EHsc)
  target_compile_definitions(adrenaline-engine PRIVATE _WIN32_WINNT=0x0A00 NOMINMAX WIN32_LEAN_AND_MEAN UNICODE _UNICODE)
  target_link_libraries(adrenaline-engine PRIVATE shell32)
else()
  target_compile_options(adrenaline-engine PRIVATE -Wall -Wextra -Wpedantic)
  find_package(Threads REQUIRED)
  target_link_libraries(adrenaline-engine PRIVATE Threads::Threads)
endif()
