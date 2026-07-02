#include "util/NetUtil.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <iphlpapi.h>
#include <windows.h>

#include <algorithm>
#include <string>
#include <vector>

#pragma comment(lib, "iphlpapi.lib")

namespace audiostream {
namespace {

struct IpCandidate {
  std::string address;
  std::string name;
  int priority = 0;
};

bool IsVirtualAdapter(const std::string& name) {
  std::string lower = name;
  std::transform(lower.begin(), lower.end(), lower.begin(),
                 [](const unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return lower.find("vether") != std::string::npos || lower.find("wsl") != std::string::npos ||
         lower.find("docker") != std::string::npos || lower.find("vpn") != std::string::npos ||
         lower.find("oray") != std::string::npos || lower.find("zero") != std::string::npos ||
         lower.find("hyper-v") != std::string::npos || lower.find("m78") != std::string::npos;
}

int ScoreAddress(const IpCandidate& candidate) {
  int score = 0;
  if (IsVirtualAdapter(candidate.name)) {
    score += 100;
  }

  const auto dot1 = candidate.address.find('.');
  const auto dot2 = candidate.address.find('.', dot1 + 1);
  if (dot1 == std::string::npos || dot2 == std::string::npos) {
    return score + 99;
  }

  const int first = std::stoi(candidate.address.substr(0, dot1));
  const int second = std::stoi(candidate.address.substr(dot1 + 1, dot2 - dot1 - 1));

  if (first == 192 && second == 168) {
    score += 1;
  } else if (first == 10) {
    score += 2;
  } else if (first == 172 && second >= 16 && second <= 31) {
    score += 3;
  } else {
    score += 99;
  }
  return score;
}

}  // namespace

std::string PickBestLocalIPv4() {
  ULONG bufferSize = 0;
  if (GetAdaptersAddresses(AF_INET, GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER,
                           nullptr, nullptr, &bufferSize) != ERROR_BUFFER_OVERFLOW) {
    return "127.0.0.1";
  }

  std::vector<unsigned char> buffer(bufferSize);
  auto* addresses = reinterpret_cast<IP_ADAPTER_ADDRESSES*>(buffer.data());
  if (GetAdaptersAddresses(AF_INET, GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER,
                           nullptr, addresses, &bufferSize) != NO_ERROR) {
    return "127.0.0.1";
  }

  std::vector<IpCandidate> candidates;
  for (auto* adapter = addresses; adapter != nullptr; adapter = adapter->Next) {
    if (adapter->OperStatus != IfOperStatusUp) {
      continue;
    }
    for (auto* address = adapter->FirstUnicastAddress; address != nullptr; address = address->Next) {
      if (address->Address.lpSockaddr->sa_family != AF_INET) {
        continue;
      }
      const auto* sockaddr = reinterpret_cast<sockaddr_in*>(address->Address.lpSockaddr);
      char ip[INET_ADDRSTRLEN] = {};
      if (InetNtopA(AF_INET, &sockaddr->sin_addr, ip, sizeof(ip)) == nullptr) {
        continue;
      }
      const std::string ipText(ip);
      if (ipText == "127.0.0.1" || ipText.rfind("169.254.", 0) == 0) {
        continue;
      }
      std::wstring friendlyName = adapter->FriendlyName ? adapter->FriendlyName : L"";
      std::string name;
      if (!friendlyName.empty()) {
        const int length = WideCharToMultiByte(CP_UTF8, 0, friendlyName.c_str(), -1, nullptr, 0,
                                               nullptr, nullptr);
        if (length > 1) {
          name.resize(static_cast<size_t>(length - 1));
          WideCharToMultiByte(CP_UTF8, 0, friendlyName.c_str(), -1, name.data(), length, nullptr,
                              nullptr);
        }
      }
      candidates.push_back({ipText, name, 0});
    }
  }

  if (candidates.empty()) {
    return "127.0.0.1";
  }

  for (auto& candidate : candidates) {
    candidate.priority = ScoreAddress(candidate);
  }
  std::sort(candidates.begin(), candidates.end(),
            [](const IpCandidate& a, const IpCandidate& b) { return a.priority < b.priority; });
  return candidates.front().address;
}

}  // namespace audiostream
