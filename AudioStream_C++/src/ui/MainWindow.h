#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <functional>
#include <string>
#include <vector>

namespace audiostream::ui {

class MainWindow {
 public:
  static constexpr int kControlLanApplyButton = 1101;
  static constexpr int kControlLanCombo = 1102;
  static constexpr int kControlLatencyApplyButton = 1103;
  static constexpr int kControlLatencyCombo = 1104;

  MainWindow();
  ~MainWindow();

  MainWindow(const MainWindow&) = delete;
  MainWindow& operator=(const MainWindow&) = delete;

  bool Create(HINSTANCE instance);
  void Show(int commandShow);
  HWND Handle() const;

  void SetStatusText(const std::wstring& text);
  void SetRoomCode(const std::wstring& code);
  void SetReceiverUrl(const std::wstring& url);
  void SetQrBitmap(HBITMAP bitmap);
  void SetAudioStatusText(const std::wstring& text);
  void SetLatencyEstimateText(const std::wstring& text);
  void SetReceiverList(const std::vector<std::wstring>& receivers);
  void SetLanInterfaceList(const std::vector<std::wstring>& interfaces,
                           const std::wstring& selectedIp);
  std::wstring GetSelectedLanIp() const;
  void SetLatencyModeSelection(bool target200ms);
  bool IsLatencyMode200msSelected() const;

  using MessageHandler = std::function<bool(UINT, WPARAM, LPARAM)>;
  void SetMessageHandler(MessageHandler handler);

 private:
  static LRESULT CALLBACK WindowProc(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam);
  LRESULT HandleMessage(UINT msg, WPARAM wparam, LPARAM lparam);

  void OnCreate();
  void OnDestroy();
  void OnSize(int width, int height);

  HINSTANCE instance_;
  HWND hwnd_;
  HWND labelRoomCode_;
  HWND valueRoomCode_;
  HWND labelReceiverUrl_;
  HWND valueReceiverUrl_;
  HWND qrStatic_;
  HWND statusText_;
  HWND labelAudioStatus_;
  HWND audioStatusText_;
  HWND labelReceivers_;
  HWND receiverList_;
  HWND labelLanIp_;
  HWND comboLanIp_;
  HWND buttonLanApply_;
  HWND labelLatencyMode_;
  HWND comboLatencyMode_;
  HWND buttonLatencyApply_;
  HWND latencyEstimateText_;
  HBITMAP qrBitmap_;
  MessageHandler messageHandler_;
};

}  // namespace audiostream::ui
