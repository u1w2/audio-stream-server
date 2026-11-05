#include "ui/MainWindow.h"

#include <algorithm>

#include "ui/i18n/Locale.h"

namespace audiostream::ui {
namespace {

constexpr wchar_t kWindowClass[] = L"AudioStreamSenderMainWindow";
constexpr int kDefaultWidth = 560;
constexpr int kDefaultHeight = 760;
constexpr int kQrDisplaySize = 200;
constexpr int kQrTop = 16;

}  // namespace

MainWindow::MainWindow()
    : instance_(nullptr),
      hwnd_(nullptr),
      labelRoomCode_(nullptr),
      valueRoomCode_(nullptr),
      labelReceiverUrl_(nullptr),
      valueReceiverUrl_(nullptr),
      qrStatic_(nullptr),
      statusText_(nullptr),
      labelAudioStatus_(nullptr),
      audioStatusText_(nullptr),
      labelReceivers_(nullptr),
      receiverList_(nullptr),
      labelLanIp_(nullptr),
      comboLanIp_(nullptr),
      buttonLanApply_(nullptr),
      labelLatencyMode_(nullptr),
      comboLatencyMode_(nullptr),
      buttonLatencyApply_(nullptr),
      latencyEstimateText_(nullptr),
      qrBitmap_(nullptr),
      messageHandler_(nullptr) {}

MainWindow::~MainWindow() {
  if (qrBitmap_ != nullptr) {
    DeleteObject(qrBitmap_);
    qrBitmap_ = nullptr;
  }
  if (hwnd_ != nullptr) {
    DestroyWindow(hwnd_);
    hwnd_ = nullptr;
  }
}

bool MainWindow::Create(const HINSTANCE instance) {
  instance_ = instance;

  WNDCLASSEXW wc{};
  wc.cbSize = sizeof(WNDCLASSEXW);
  wc.style = CS_HREDRAW | CS_VREDRAW;
  wc.lpfnWndProc = MainWindow::WindowProc;
  wc.hInstance = instance_;
  wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
  wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
  wc.lpszClassName = kWindowClass;

  if (RegisterClassExW(&wc) == 0 && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
    return false;
  }

  hwnd_ = CreateWindowExW(
      0,
      kWindowClass,
      i18n::Tr(L"app.title").c_str(),
      WS_OVERLAPPEDWINDOW,
      CW_USEDEFAULT,
      CW_USEDEFAULT,
      kDefaultWidth,
      kDefaultHeight,
      nullptr,
      nullptr,
      instance_,
      this);

  return hwnd_ != nullptr;
}

void MainWindow::Show(const int commandShow) {
  if (hwnd_ != nullptr) {
    ShowWindow(hwnd_, commandShow);
    UpdateWindow(hwnd_);
  }
}

HWND MainWindow::Handle() const {
  return hwnd_;
}

void MainWindow::SetStatusText(const std::wstring& text) {
  if (statusText_ != nullptr) {
    SetWindowTextW(statusText_, text.c_str());
  }
}

void MainWindow::SetRoomCode(const std::wstring& code) {
  if (valueRoomCode_ != nullptr) {
    SetWindowTextW(valueRoomCode_, code.c_str());
  }
}

void MainWindow::SetReceiverUrl(const std::wstring& url) {
  if (valueReceiverUrl_ != nullptr) {
    SetWindowTextW(valueReceiverUrl_, url.c_str());
  }
}

void MainWindow::SetAudioStatusText(const std::wstring& text) {
  if (audioStatusText_ != nullptr) {
    SetWindowTextW(audioStatusText_, text.c_str());
  }
}

void MainWindow::SetLatencyEstimateText(const std::wstring& text) {
  if (latencyEstimateText_ != nullptr) {
    SetWindowTextW(latencyEstimateText_, text.c_str());
  }
}

void MainWindow::SetReceiverList(const std::vector<std::wstring>& receivers) {
  if (receiverList_ == nullptr) {
    return;
  }
  SendMessageW(receiverList_, LB_RESETCONTENT, 0, 0);
  if (receivers.empty()) {
    SendMessageW(receiverList_, LB_ADDSTRING, 0,
                 reinterpret_cast<LPARAM>(i18n::Tr(L"receivers.empty").c_str()));
    return;
  }
  for (const auto& item : receivers) {
    SendMessageW(receiverList_, LB_ADDSTRING, 0, reinterpret_cast<LPARAM>(item.c_str()));
  }
}

void MainWindow::SetLanInterfaceList(const std::vector<std::wstring>& interfaces,
                                     const std::wstring& selectedIp) {
  if (comboLanIp_ == nullptr) {
    return;
  }
  SendMessageW(comboLanIp_, CB_RESETCONTENT, 0, 0);
  int selectedIndex = -1;
  const std::wstring needle = L"[" + selectedIp + L"]";
  for (size_t i = 0; i < interfaces.size(); ++i) {
    const auto& item = interfaces[i];
    const LRESULT idx = SendMessageW(comboLanIp_, CB_ADDSTRING, 0,
                                     reinterpret_cast<LPARAM>(item.c_str()));
    // Exact "[ip]" suffix match: "192.168.1.1" must not match "[192.168.1.10]".
    if (selectedIndex < 0 && !selectedIp.empty() && item.size() >= needle.size() &&
        item.compare(item.size() - needle.size(), needle.size(), needle) == 0) {
      selectedIndex = static_cast<int>(idx);
    }
  }
  if (selectedIndex < 0 && !interfaces.empty()) {
    selectedIndex = 0;
  }
  if (selectedIndex >= 0) {
    SendMessageW(comboLanIp_, CB_SETCURSEL, static_cast<WPARAM>(selectedIndex), 0);
  }
}

std::wstring MainWindow::GetSelectedLanIp() const {
  if (comboLanIp_ == nullptr) {
    return L"";
  }
  const LRESULT idx = SendMessageW(comboLanIp_, CB_GETCURSEL, 0, 0);
  if (idx == CB_ERR) {
    return L"";
  }
  wchar_t text[256] = {};
  SendMessageW(comboLanIp_, CB_GETLBTEXT, idx, reinterpret_cast<LPARAM>(text));
  const std::wstring selected(text);
  const size_t left = selected.find(L'[');
  const size_t right = selected.find(L']');
  if (left != std::wstring::npos && right != std::wstring::npos && right > left + 1) {
    return selected.substr(left + 1, right - left - 1);
  }
  return selected;
}

void MainWindow::SetLatencyModeSelection(const bool target200ms) {
  if (comboLatencyMode_ == nullptr) {
    return;
  }
  SendMessageW(comboLatencyMode_, CB_SETCURSEL, target200ms ? 1 : 0, 0);
}

bool MainWindow::IsLatencyMode200msSelected() const {
  if (comboLatencyMode_ == nullptr) {
    return false;
  }
  const LRESULT idx = SendMessageW(comboLatencyMode_, CB_GETCURSEL, 0, 0);
  return idx == 1;
}

void MainWindow::SetQrBitmap(const HBITMAP bitmap) {
  if (qrBitmap_ != nullptr) {
    DeleteObject(qrBitmap_);
    qrBitmap_ = nullptr;
  }
  qrBitmap_ = bitmap;
  if (qrStatic_ != nullptr && qrBitmap_ != nullptr) {
    SendMessageW(qrStatic_, STM_SETIMAGE, IMAGE_BITMAP,
                 reinterpret_cast<LPARAM>(qrBitmap_));
  }
}

void MainWindow::SetMessageHandler(MessageHandler handler) {
  messageHandler_ = std::move(handler);
}

LRESULT CALLBACK MainWindow::WindowProc(const HWND hwnd, const UINT msg, const WPARAM wparam,
                                        const LPARAM lparam) {
  MainWindow* self = nullptr;
  if (msg == WM_NCCREATE) {
    const auto* createStruct = reinterpret_cast<CREATESTRUCTW*>(lparam);
    self = static_cast<MainWindow*>(createStruct->lpCreateParams);
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
    self->hwnd_ = hwnd;
  } else {
    self = reinterpret_cast<MainWindow*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  }

  if (self != nullptr) {
    return self->HandleMessage(msg, wparam, lparam);
  }
  return DefWindowProcW(hwnd, msg, wparam, lparam);
}

LRESULT MainWindow::HandleMessage(const UINT msg, const WPARAM wparam, const LPARAM lparam) {
  if (messageHandler_ && messageHandler_(msg, wparam, lparam)) {
    return 0;
  }

  switch (msg) {
    case WM_CREATE:
      OnCreate();
      return 0;
    case WM_SIZE:
      OnSize(LOWORD(lparam), HIWORD(lparam));
      return 0;
    case WM_DESTROY:
      OnDestroy();
      return 0;
    case WM_CLOSE:
      ShowWindow(hwnd_, SW_HIDE);
      return 0;
    default:
      return DefWindowProcW(hwnd_, msg, wparam, lparam);
  }
}

void MainWindow::OnCreate() {
  const HFONT titleFont = CreateFontW(
      28, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS,
      CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Segoe UI");

  const int qrLeft = (kDefaultWidth - kQrDisplaySize) / 2;
  qrStatic_ = CreateWindowExW(
      0, L"STATIC", nullptr, WS_CHILD | WS_VISIBLE | SS_BITMAP | SS_CENTERIMAGE, qrLeft, kQrTop,
      kQrDisplaySize, kQrDisplaySize, hwnd_, nullptr, instance_, nullptr);

  const int contentTop = kQrTop + kQrDisplaySize + 16;
  labelRoomCode_ = CreateWindowExW(
      0, L"STATIC", i18n::Tr(L"label.room_code").c_str(), WS_CHILD | WS_VISIBLE, 24, contentTop,
      120, 24, hwnd_, nullptr, instance_, nullptr);

  valueRoomCode_ = CreateWindowExW(
      0, L"STATIC", i18n::Tr(L"room.placeholder").c_str(),
      WS_CHILD | WS_VISIBLE | SS_CENTER, 24, contentTop + 28, kDefaultWidth - 48, 40, hwnd_,
      nullptr, instance_, nullptr);
  SendMessageW(valueRoomCode_, WM_SETFONT, reinterpret_cast<WPARAM>(titleFont), TRUE);

  labelReceiverUrl_ = CreateWindowExW(
      0, L"STATIC", i18n::Tr(L"label.receiver_url").c_str(), WS_CHILD | WS_VISIBLE, 24,
      contentTop + 80, 120, 24, hwnd_, nullptr, instance_, nullptr);

  valueReceiverUrl_ = CreateWindowExW(
      0, L"STATIC", L"", WS_CHILD | WS_VISIBLE, 24, contentTop + 108, kDefaultWidth - 48, 40,
      hwnd_, nullptr, instance_, nullptr);

  statusText_ = CreateWindowExW(
      0, L"STATIC", i18n::Tr(L"status.ready").c_str(), WS_CHILD | WS_VISIBLE, 24,
      contentTop + 160, kDefaultWidth - 48, 24, hwnd_, nullptr, instance_, nullptr);

  labelAudioStatus_ = CreateWindowExW(
      0, L"STATIC", i18n::Tr(L"label.audio_status").c_str(), WS_CHILD | WS_VISIBLE, 24,
      contentTop + 192, 120, 24, hwnd_, nullptr, instance_, nullptr);

  audioStatusText_ = CreateWindowExW(
      0, L"STATIC", i18n::Tr(L"status.audio_waiting").c_str(), WS_CHILD | WS_VISIBLE, 24,
      contentTop + 216, kDefaultWidth - 48, 24, hwnd_, nullptr, instance_, nullptr);

  labelReceivers_ = CreateWindowExW(
      0, L"STATIC", i18n::Tr(L"label.receivers").c_str(), WS_CHILD | WS_VISIBLE, 24,
      contentTop + 252, 160, 24, hwnd_, nullptr, instance_, nullptr);

  receiverList_ = CreateWindowExW(
      WS_EX_CLIENTEDGE, L"LISTBOX", nullptr,
      WS_CHILD | WS_VISIBLE | LBS_NOTIFY | WS_VSCROLL, 24, contentTop + 280,
      kDefaultWidth - 48, 120, hwnd_, nullptr, instance_, nullptr);
  SetReceiverList({});

  labelLanIp_ = CreateWindowExW(
      0, L"STATIC", i18n::Tr(L"label.lan_ip").c_str(), WS_CHILD | WS_VISIBLE, 24,
      contentTop + 416, 120, 24, hwnd_, nullptr, instance_, nullptr);

  comboLanIp_ = CreateWindowExW(
      0, L"COMBOBOX", nullptr, WS_CHILD | WS_VISIBLE | CBS_DROPDOWNLIST | WS_VSCROLL, 24,
      contentTop + 442, kDefaultWidth - 180, 320, hwnd_,
      reinterpret_cast<HMENU>(static_cast<INT_PTR>(kControlLanCombo)), instance_, nullptr);

  buttonLanApply_ = CreateWindowExW(
      0, L"BUTTON", i18n::Tr(L"button.apply_lan_ip").c_str(), WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
      kDefaultWidth - 144, contentTop + 442, 120, 28, hwnd_,
      reinterpret_cast<HMENU>(static_cast<INT_PTR>(kControlLanApplyButton)), instance_, nullptr);

  labelLatencyMode_ = CreateWindowExW(
      0, L"STATIC", i18n::Tr(L"label.latency_mode").c_str(), WS_CHILD | WS_VISIBLE, 24,
      contentTop + 480, 160, 24, hwnd_, nullptr, instance_, nullptr);

  comboLatencyMode_ = CreateWindowExW(
      0, L"COMBOBOX", nullptr, WS_CHILD | WS_VISIBLE | CBS_DROPDOWNLIST | WS_VSCROLL, 24,
      contentTop + 506, kDefaultWidth - 180, 200, hwnd_,
      reinterpret_cast<HMENU>(static_cast<INT_PTR>(kControlLatencyCombo)), instance_, nullptr);
  SendMessageW(comboLatencyMode_, CB_ADDSTRING, 0,
               reinterpret_cast<LPARAM>(i18n::Tr(L"latency.mode.stable").c_str()));
  SendMessageW(comboLatencyMode_, CB_ADDSTRING, 0,
               reinterpret_cast<LPARAM>(i18n::Tr(L"latency.mode.200ms").c_str()));
  SendMessageW(comboLatencyMode_, CB_SETCURSEL, 0, 0);

  buttonLatencyApply_ = CreateWindowExW(
      0, L"BUTTON", i18n::Tr(L"button.apply_latency_mode").c_str(),
      WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, kDefaultWidth - 144, contentTop + 506, 120, 28, hwnd_,
      reinterpret_cast<HMENU>(static_cast<INT_PTR>(kControlLatencyApplyButton)), instance_, nullptr);

  latencyEstimateText_ = CreateWindowExW(
      0, L"STATIC", L"", WS_CHILD | WS_VISIBLE, 24, contentTop + 542, kDefaultWidth - 48, 24, hwnd_,
      nullptr, instance_, nullptr);
}

void MainWindow::OnDestroy() {
  if (qrStatic_ != nullptr) {
    SendMessageW(qrStatic_, STM_SETIMAGE, IMAGE_BITMAP, 0);
  }
  PostQuitMessage(0);
}

void MainWindow::OnSize(const int width, const int height) {
  if (width <= 0 || height <= 0) {
    return;
  }

  const int contentWidth = width - 48;
  const int qrLeft = std::max(24, (width - kQrDisplaySize) / 2);
  if (qrStatic_ != nullptr) {
    SetWindowPos(qrStatic_, nullptr, qrLeft, kQrTop, kQrDisplaySize, kQrDisplaySize, SWP_NOZORDER);
  }

  const int contentTop = kQrTop + kQrDisplaySize + 16;
  if (labelRoomCode_ != nullptr) {
    SetWindowPos(labelRoomCode_, nullptr, 24, contentTop, 120, 24, SWP_NOZORDER);
  }
  if (valueRoomCode_ != nullptr) {
    SetWindowPos(valueRoomCode_, nullptr, 24, contentTop + 28, contentWidth, 40, SWP_NOZORDER);
  }
  if (labelReceiverUrl_ != nullptr) {
    SetWindowPos(labelReceiverUrl_, nullptr, 24, contentTop + 80, 120, 24, SWP_NOZORDER);
  }
  if (valueReceiverUrl_ != nullptr) {
    SetWindowPos(valueReceiverUrl_, nullptr, 24, contentTop + 108, contentWidth, 40, SWP_NOZORDER);
  }
  if (statusText_ != nullptr) {
    SetWindowPos(statusText_, nullptr, 24, contentTop + 160, contentWidth, 24, SWP_NOZORDER);
  }
  if (labelAudioStatus_ != nullptr) {
    SetWindowPos(labelAudioStatus_, nullptr, 24, contentTop + 192, 120, 24, SWP_NOZORDER);
  }
  if (audioStatusText_ != nullptr) {
    SetWindowPos(audioStatusText_, nullptr, 24, contentTop + 216, contentWidth, 24, SWP_NOZORDER);
  }
  if (labelReceivers_ != nullptr) {
    SetWindowPos(labelReceivers_, nullptr, 24, contentTop + 252, 160, 24, SWP_NOZORDER);
  }
  if (receiverList_ != nullptr) {
    SetWindowPos(receiverList_, nullptr, 24, contentTop + 280, contentWidth, 120, SWP_NOZORDER);
  }
  if (labelLanIp_ != nullptr) {
    SetWindowPos(labelLanIp_, nullptr, 24, contentTop + 416, 120, 24, SWP_NOZORDER);
  }
  if (comboLanIp_ != nullptr) {
    SetWindowPos(comboLanIp_, nullptr, 24, contentTop + 442, contentWidth - 132, 320, SWP_NOZORDER);
  }
  if (buttonLanApply_ != nullptr) {
    SetWindowPos(buttonLanApply_, nullptr, width - 120, contentTop + 442, 96, 28, SWP_NOZORDER);
  }
  if (labelLatencyMode_ != nullptr) {
    SetWindowPos(labelLatencyMode_, nullptr, 24, contentTop + 480, 160, 24, SWP_NOZORDER);
  }
  if (comboLatencyMode_ != nullptr) {
    SetWindowPos(comboLatencyMode_, nullptr, 24, contentTop + 506, contentWidth - 132, 200,
                 SWP_NOZORDER);
  }
  if (buttonLatencyApply_ != nullptr) {
    SetWindowPos(buttonLatencyApply_, nullptr, width - 120, contentTop + 506, 96, 28, SWP_NOZORDER);
  }
  if (latencyEstimateText_ != nullptr) {
    SetWindowPos(latencyEstimateText_, nullptr, 24, contentTop + 542, contentWidth, 24,
                 SWP_NOZORDER);
  }
}

}  // namespace audiostream::ui
