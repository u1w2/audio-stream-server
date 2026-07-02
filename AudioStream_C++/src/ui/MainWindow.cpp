#include "ui/MainWindow.h"

#include <algorithm>

#include "ui/i18n/Locale.h"

namespace audiostream::ui {
namespace {

constexpr wchar_t kWindowClass[] = L"AudioStreamSenderMainWindow";
constexpr int kDefaultWidth = 560;
constexpr int kDefaultHeight = 680;
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
}

}  // namespace audiostream::ui
