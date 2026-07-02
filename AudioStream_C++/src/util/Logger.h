#pragma once

#include <string>

namespace audiostream {

class Logger {
 public:
  static void Initialize();
  static void Info(const std::string& message);
  static void Warn(const std::string& message);
  static void Error(const std::string& message);
  static std::string LogFilePath();
};

}  // namespace audiostream
