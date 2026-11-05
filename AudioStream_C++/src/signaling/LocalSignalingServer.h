#pragma once

#include <functional>
#include <string>
#include <vector>

#include "util/NetUtil.h"

namespace audiostream {

struct LocalSignalingServerImpl;

struct LanRoomInfo {
  std::string code;
  std::string senderToken;
  std::string receiverUrl;
  std::string localIp;
  int preferredPort = 0;
  int port = 0;
  int maxConnections = 5;
};

class LocalSignalingServer {
 public:
  using SenderCallback = std::function<void(const std::string& messageJson)>;

  LocalSignalingServer();
  ~LocalSignalingServer();

  LocalSignalingServer(const LocalSignalingServer&) = delete;
  LocalSignalingServer& operator=(const LocalSignalingServer&) = delete;

  bool Start(int preferredPort, int maxConnections, const std::string& publicDir,
             const std::string& preferredLanIp = "");
  void Stop();

  bool IsRunning() const;
  LanRoomInfo GetRoom() const;
  std::vector<NetworkInterfaceInfo> GetNetworkInterfaces() const;
  // Updates the advertised LAN IP (receiver URL / QR) without restarting. The listener
  // binds 0.0.0.0, so existing connections and the room code are kept.
  bool SetLocalIp(const std::string& ip);
  void SetSenderCallback(SenderCallback callback);

 private:
  LocalSignalingServerImpl* impl_;
};

}  // namespace audiostream
