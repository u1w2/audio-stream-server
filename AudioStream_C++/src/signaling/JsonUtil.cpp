#include "signaling/JsonUtil.h"

namespace audiostream {

std::string JsonGetString(const std::string& json, const std::string& key) {
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

std::string JsonEscape(const std::string& value) {
  std::string escaped;
  escaped.reserve(value.size());
  for (const char ch : value) {
    switch (ch) {
      case '\\':
        escaped += "\\\\";
        break;
      case '"':
        escaped += "\\\"";
        break;
      default:
        escaped.push_back(ch);
        break;
    }
  }
  return escaped;
}

}  // namespace audiostream
