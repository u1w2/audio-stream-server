#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include "config/Config.h"

#include <mutex>
#include <string>
#include <unordered_map>

namespace audiostream {

class LocalSignalingServer;
class WebRtcEngine;

class Application {
 public:
  explicit Application(HINSTANCE instance);
  int Run(int commandShow);

 private:
  bool Initialize();
  void Shutdown();
  void ApplyLocaleFromConfig();
  void WireWindowHandlers();
  bool HandleWindowMessage(UINT msg, WPARAM wparam, LPARAM lparam);
  void ShowMainWindow();
  void ExitApplication();
  void UpdateRoomDisplay();
  void UpdateReceiverDisplay();
  void OnSignalingMessage(const std::string& messageJson);

  HINSTANCE instance_;
  AppConfig config_;
  LocalSignalingServer* localSignaling_;
  WebRtcEngine* webrtcEngine_;
  class MainWindowHolder;
  class TrayHolder;
  MainWindowHolder* mainWindow_;
  TrayHolder* tray_;
  UINT trayCallbackMessage_;
  bool running_;
  bool audioCaptured_ = false;
  bool audioStreaming_ = false;
  std::mutex receiversMutex_;
  std::unordered_map<std::string, std::string> receivers_;
};

}  // namespace audiostream
