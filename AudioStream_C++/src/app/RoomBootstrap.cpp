#include "app/RoomBootstrap.h"

#include "util/NetUtil.h"

#include <random>
#include <sstream>

namespace audiostream {

std::string GenerateRoomCode() {
  static constexpr char kChars[] = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  static thread_local std::mt19937 rng{std::random_device{}()};
  std::uniform_int_distribution<int> dist(0, static_cast<int>(sizeof(kChars) - 2));

  std::string code;
  code.reserve(5);
  for (int i = 0; i < 5; ++i) {
    code.push_back(kChars[dist(rng)]);
  }
  return code;
}

RoomPreview CreateLanRoomPreview(const int port) {
  RoomPreview preview{};
  preview.localIp = PickBestLocalIPv4();
  preview.port = port;
  preview.code = GenerateRoomCode();
  std::ostringstream url;
  url << "http://" << preview.localIp << ':' << port << "/receiver?code=" << preview.code;
  preview.receiverUrl = url.str();
  return preview;
}

}  // namespace audiostream
