#pragma once

#include <string>
#include <vector>

namespace audiostream::protocol {

inline constexpr const char* kDefaultCloudServer = "wss://www.u1w2.com";
inline constexpr int kDefaultLocalPort = 3001;
inline constexpr int kLocalPortScanCount = 10;
inline constexpr int kHeartbeatIntervalMs = 300000;
inline constexpr int kSenderReconnectDelayMs = 3000;

struct IceServer {
  std::string urls;
  std::string username;
  std::string credential;
};

inline std::vector<IceServer> DefaultIceServers() {
  return {
      {"stun:stun.qq.com:3478", "", ""},
      {"stun:stun.aliyun.com:3478", "", ""},
      {"stun:stun.l.google.com:19302", "", ""},
      {"turn:39.101.174.208:3478", "u1w2", "Mua04xOwvE8uBD4X"},
      {"turn:39.101.174.208:3478?transport=tcp", "u1w2", "Mua04xOwvE8uBD4X"},
  };
}

}  // namespace audiostream::protocol
