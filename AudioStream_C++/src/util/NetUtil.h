#pragma once

#include <string>
#include <vector>

namespace audiostream {

struct NetworkInterfaceInfo {
  std::string name;
  std::string address;
};

std::vector<NetworkInterfaceInfo> ListLocalIPv4Interfaces();
std::string PickBestLocalIPv4(const std::string& preferredIp = "");
// Strict dotted-quad check ("a.b.c.d", each 0-255, no leading zeros beyond "0").
bool IsValidIPv4(const std::string& text);

}  // namespace audiostream
