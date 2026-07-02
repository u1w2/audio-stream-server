#pragma once

#include <functional>
#include <string>

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

  bool Start(int preferredPort, int maxConnections, const std::string& publicDir);
  void Stop();

  bool IsRunning() const;
  LanRoomInfo GetRoom() const;
  void SetSenderCallback(SenderCallback callback);

 private:
  LocalSignalingServerImpl* impl_;
};

}  // namespace audiostream
