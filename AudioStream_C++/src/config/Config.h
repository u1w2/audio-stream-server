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

enum class LatencyMode {
  kStable,
  kTarget200ms,
};

struct AppConfig {
  Mode defaultMode = Mode::kLan;
  LatencyMode latencyMode = LatencyMode::kStable;
  std::string cloudServer;
  std::string lanIp;
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
