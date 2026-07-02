#pragma once

#include <string>

namespace audiostream {

struct RoomPreview {
  std::string code;
  std::string receiverUrl;
  std::string localIp;
  int port = 0;
};

std::string GenerateRoomCode();

RoomPreview CreateLanRoomPreview(int port);

}  // namespace audiostream
