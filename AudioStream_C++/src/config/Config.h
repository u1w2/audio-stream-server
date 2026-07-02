#pragma once

#include <string>

namespace audiostream {

enum class Mode {
  kLan,
  kCloud,
};

enum class AppLocale {
  kZhCN,
  kEnUS,
};

struct AppConfig {
  Mode defaultMode = Mode::kLan;
  std::string cloudServer;
  int localPort = 0;
  int maxConnections = 5;
  bool autoLaunch = false;
  bool showWindowOnStart = true;
  int minBitrate = 16000;
  int maxBitrate = 750000;
  AppLocale locale = AppLocale::kZhCN;
};

class ConfigService {
 public:
  AppConfig LoadOrDefault() const;
  bool Save(const AppConfig& config) const;
};

}  // namespace audiostream
