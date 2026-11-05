#include "config/Config.h"

#include "protocol/Protocol.h"
#include "util/NetUtil.h"
#include "util/Paths.h"

#include <fstream>
#include <sstream>

namespace audiostream {
namespace {

std::string ModeToJsonValue(const Mode mode) {
  return mode == Mode::kCloud ? "cloud" : "lan";
}

Mode ModeFromJsonValue(const std::string& value) {
  return value == "cloud" ? Mode::kCloud : Mode::kLan;
}

std::string LatencyModeToJsonValue(const LatencyMode mode) {
  return mode == LatencyMode::kTarget200ms ? "200ms" : "stable";
}

LatencyMode LatencyModeFromJsonValue(const std::string& value) {
  if (value == "200ms" || value == "low200" || value == "target200ms") {
    return LatencyMode::kTarget200ms;
  }
  return LatencyMode::kStable;
}

std::string ExtractJsonString(const std::string& json, const std::string& key) {
  const std::string pattern = "\"" + key + "\"";
  const size_t keyPos = json.find(pattern);
  if (keyPos == std::string::npos) {
    return "";
  }
  const size_t colonPos = json.find(':', keyPos + pattern.size());
  if (colonPos == std::string::npos) {
    return "";
  }
  const size_t firstQuote = json.find('"', colonPos + 1);
  if (firstQuote == std::string::npos) {
    return "";
  }
  const size_t secondQuote = json.find('"', firstQuote + 1);
  if (secondQuote == std::string::npos) {
    return "";
  }
  return json.substr(firstQuote + 1, secondQuote - firstQuote - 1);
}

int ExtractJsonInt(const std::string& json, const std::string& key, const int fallback) {
  const std::string pattern = "\"" + key + "\"";
  const size_t keyPos = json.find(pattern);
  if (keyPos == std::string::npos) {
    return fallback;
  }
  const size_t colonPos = json.find(':', keyPos + pattern.size());
  if (colonPos == std::string::npos) {
    return fallback;
  }
  const size_t valueStart = json.find_first_not_of(" \t\r\n", colonPos + 1);
  if (valueStart == std::string::npos) {
    return fallback;
  }
  try {
    return std::stoi(json.substr(valueStart));
  } catch (...) {
    return fallback;
  }
}

bool ExtractJsonBool(const std::string& json, const std::string& key, const bool fallback) {
  const std::string pattern = "\"" + key + "\"";
  const size_t keyPos = json.find(pattern);
  if (keyPos == std::string::npos) {
    return fallback;
  }
  const size_t colonPos = json.find(':', keyPos + pattern.size());
  if (colonPos == std::string::npos) {
    return fallback;
  }
  const size_t valueStart = json.find_first_not_of(" \t\r\n", colonPos + 1);
  if (valueStart == std::string::npos) {
    return fallback;
  }
  if (json.compare(valueStart, 4, "true") == 0) {
    return true;
  }
  if (json.compare(valueStart, 5, "false") == 0) {
    return false;
  }
  return fallback;
}

AppConfig DefaultConfig() {
  AppConfig config{};
  config.defaultMode = Mode::kLan;
  config.latencyMode = LatencyMode::kStable;
  config.cloudServer = protocol::kDefaultCloudServer;
  config.lanIp = "";
  config.localPort = protocol::kDefaultLocalPort;
  config.maxConnections = 5;
  config.autoLaunch = false;
  config.showWindowOnStart = true;
  config.minBitrate = 16000;
  config.maxBitrate = 750000;
  config.locale = AppLocale::kZhCN;
  return config;
}

std::string SerializeConfig(const AppConfig& config) {
  std::ostringstream oss;
  oss << "{\n"
      << "  \"defaultMode\": \"" << ModeToJsonValue(config.defaultMode) << "\",\n"
      << "  \"latencyMode\": \"" << LatencyModeToJsonValue(config.latencyMode) << "\",\n"
      << "  \"cloudServer\": \"" << config.cloudServer << "\",\n"
      << "  \"lanIp\": \"" << config.lanIp << "\",\n"
      << "  \"localPort\": " << config.localPort << ",\n"
      << "  \"maxConnections\": " << config.maxConnections << ",\n"
      << "  \"autoLaunch\": " << (config.autoLaunch ? "true" : "false") << ",\n"
      << "  \"showWindowOnStart\": " << (config.showWindowOnStart ? "true" : "false") << ",\n"
      << "  \"minBitrate\": " << config.minBitrate << ",\n"
      << "  \"maxBitrate\": " << config.maxBitrate << ",\n"
      << "  \"locale\": \"" << (config.locale == AppLocale::kEnUS ? "en-US" : "zh-CN") << "\"\n"
      << "}\n";
  return oss.str();
}

AppConfig DeserializeConfig(const std::string& json) {
  AppConfig config = DefaultConfig();
  const std::string mode = ExtractJsonString(json, "defaultMode");
  if (!mode.empty()) {
    config.defaultMode = ModeFromJsonValue(mode);
  }
  const std::string latencyMode = ExtractJsonString(json, "latencyMode");
  if (!latencyMode.empty()) {
    config.latencyMode = LatencyModeFromJsonValue(latencyMode);
  }
  const std::string cloudServer = ExtractJsonString(json, "cloudServer");
  if (!cloudServer.empty()) {
    config.cloudServer = cloudServer;
  }
  config.lanIp = ExtractJsonString(json, "lanIp");
  if (!config.lanIp.empty() && !IsValidIPv4(config.lanIp)) {
    config.lanIp.clear();  // never round-trip garbage into the JSON file
  }
  config.localPort = ExtractJsonInt(json, "localPort", config.localPort);
  config.maxConnections = ExtractJsonInt(json, "maxConnections", config.maxConnections);
  config.autoLaunch = ExtractJsonBool(json, "autoLaunch", config.autoLaunch);
  config.showWindowOnStart = ExtractJsonBool(json, "showWindowOnStart", config.showWindowOnStart);
  config.minBitrate = ExtractJsonInt(json, "minBitrate", config.minBitrate);
  config.maxBitrate = ExtractJsonInt(json, "maxBitrate", config.maxBitrate);
  const std::string locale = ExtractJsonString(json, "locale");
  if (locale == "en-US") {
    config.locale = AppLocale::kEnUS;
  } else {
    config.locale = AppLocale::kZhCN;
  }
  return config;
}

}  // namespace

AppConfig ConfigService::LoadOrDefault() const {
  Paths::EnsureAppDataLayout();
  const auto configPath = Paths::ConfigFile();
  std::ifstream input(configPath);
  if (!input.is_open()) {
    return DefaultConfig();
  }
  std::ostringstream buffer;
  buffer << input.rdbuf();
  return DeserializeConfig(buffer.str());
}

bool ConfigService::Save(const AppConfig& config) const {
  if (!Paths::EnsureAppDataLayout()) {
    return false;
  }
  std::ofstream output(Paths::ConfigFile(), std::ios::trunc);
  if (!output.is_open()) {
    return false;
  }
  output << SerializeConfig(config);
  return true;
}

}  // namespace audiostream
