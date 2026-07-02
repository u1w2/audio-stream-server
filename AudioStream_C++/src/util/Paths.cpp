#include "util/Paths.h"

#include <cstdlib>
#include <system_error>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

namespace audiostream {

namespace {

std::filesystem::path GetAppDataFromEnv() {
  const char* appData = std::getenv("APPDATA");
  if (appData != nullptr && appData[0] != '\0') {
    return std::filesystem::path(appData) / "AudioStream";
  }
  return std::filesystem::temp_directory_path() / "AudioStream";
}

}  // namespace

std::filesystem::path Paths::AppDataRoot() {
  return GetAppDataFromEnv();
}

std::filesystem::path Paths::ConfigFile() {
  return AppDataRoot() / "config.json";
}

std::filesystem::path Paths::SessionFile() {
  return AppDataRoot() / "session.json";
}

std::filesystem::path Paths::LogDirectory() {
  return AppDataRoot() / "logs";
}

bool Paths::EnsureAppDataLayout() {
  std::error_code ec;
  const auto root = AppDataRoot();
  if (!std::filesystem::exists(root, ec)) {
    if (!std::filesystem::create_directories(root, ec)) {
      return false;
    }
  }
  if (!std::filesystem::exists(LogDirectory(), ec)) {
    if (!std::filesystem::create_directories(LogDirectory(), ec)) {
      return false;
    }
  }
  return true;
}

std::filesystem::path Paths::PublicAssetsDirectory() {
  wchar_t exePath[MAX_PATH]{};
  if (GetModuleFileNameW(nullptr, exePath, MAX_PATH) != 0) {
    const auto publicDir = std::filesystem::path(exePath).parent_path() / "public";
    if (std::filesystem::exists(publicDir)) {
      return publicDir;
    }
  }
  return std::filesystem::path("E:/u1w2/audio_stream_server/AudioStream_C++/resources/public");
}

}  // namespace audiostream
