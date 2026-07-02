#include "util/Logger.h"

#include "util/Paths.h"

#include <chrono>
#include <ctime>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <sstream>

namespace audiostream {
namespace {

std::mutex g_logMutex;
std::string g_logFilePath;
bool g_initialized = false;

std::string BuildPrefix(const char* level) {
  const auto now = std::chrono::system_clock::now();
  const std::time_t ts = std::chrono::system_clock::to_time_t(now);
  std::tm localTime{};
#ifdef _WIN32
  localtime_s(&localTime, &ts);
#else
  localtime_r(&ts, &localTime);
#endif
  std::ostringstream oss;
  oss << "[" << std::put_time(&localTime, "%Y-%m-%d %H:%M:%S") << "]"
      << "[" << level << "] ";
  return oss.str();
}

void WriteLine(const char* level, const std::string& message) {
  const std::string line = BuildPrefix(level) + message;
  std::ostream& out = (level[0] == 'E') ? static_cast<std::ostream&>(std::cerr)
                                        : static_cast<std::ostream&>(std::cout);
  out << line << std::endl;

  if (!g_logFilePath.empty()) {
    std::ofstream file(g_logFilePath, std::ios::app);
    if (file.is_open()) {
      file << line << '\n';
    }
  }
}

}  // namespace

void Logger::Initialize() {
  std::lock_guard<std::mutex> lock(g_logMutex);
  if (g_initialized) {
    return;
  }
  Paths::EnsureAppDataLayout();
  g_logFilePath = Paths::LogDirectory().string() + "/sender.log";
  g_initialized = true;

  std::ofstream file(g_logFilePath, std::ios::trunc);
  if (file.is_open()) {
    file << BuildPrefix("INFO") << "AudioStream sender log started\n";
  }
}

std::string Logger::LogFilePath() {
  return g_logFilePath;
}

void Logger::Info(const std::string& message) {
  std::lock_guard<std::mutex> lock(g_logMutex);
  WriteLine("INFO", message);
}

void Logger::Warn(const std::string& message) {
  std::lock_guard<std::mutex> lock(g_logMutex);
  WriteLine("WARN", message);
}

void Logger::Error(const std::string& message) {
  std::lock_guard<std::mutex> lock(g_logMutex);
  WriteLine("ERROR", message);
}

}  // namespace audiostream
