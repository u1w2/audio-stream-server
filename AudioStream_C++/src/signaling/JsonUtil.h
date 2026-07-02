#pragma once

#include <string>

namespace audiostream {

std::string JsonGetString(const std::string& json, const std::string& key);
std::string JsonEscape(const std::string& value);

}  // namespace audiostream
