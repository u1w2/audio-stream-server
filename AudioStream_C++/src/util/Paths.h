#pragma once

#include <filesystem>
#include <string>

namespace audiostream {

class Paths {
 public:
  static std::filesystem::path AppDataRoot();
  static std::filesystem::path ConfigFile();
  static std::filesystem::path SessionFile();
  static std::filesystem::path LogDirectory();

  static std::filesystem::path PublicAssetsDirectory();

  static bool EnsureAppDataLayout();
};

}  // namespace audiostream
