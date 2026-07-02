#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <shellapi.h>

namespace audiostream::ui {

class TrayIcon {
 public:
  TrayIcon();
  ~TrayIcon();

  TrayIcon(const TrayIcon&) = delete;
  TrayIcon& operator=(const TrayIcon&) = delete;

  static constexpr UINT kCmdShow = 1001;
  static constexpr UINT kCmdExit = 1002;

  bool Create(HWND ownerWindow, HINSTANCE instance, UINT callbackMessage);
  void Destroy();
  void ShowBalloon(const wchar_t* title, const wchar_t* message);
  void OnTrayEvent(LPARAM lparam);

 private:
  void ShowContextMenu();

  HWND ownerWindow_;
  HINSTANCE instance_;
  UINT callbackMessage_;
  NOTIFYICONDATAW iconData_;
  bool created_;
};

}  // namespace audiostream::ui
