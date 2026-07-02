#include "ui/TrayIcon.h"

#include "ui/i18n/Locale.h"

namespace audiostream::ui {

TrayIcon::TrayIcon()
    : ownerWindow_(nullptr),
      instance_(nullptr),
      callbackMessage_(0),
      created_(false) {
  ZeroMemory(&iconData_, sizeof(iconData_));
}

TrayIcon::~TrayIcon() {
  Destroy();
}

bool TrayIcon::Create(const HWND ownerWindow, const HINSTANCE instance,
                      const UINT callbackMessage) {
  ownerWindow_ = ownerWindow;
  instance_ = instance;
  callbackMessage_ = callbackMessage;

  iconData_.cbSize = sizeof(NOTIFYICONDATAW);
  iconData_.hWnd = ownerWindow_;
  iconData_.uID = 1;
  iconData_.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
  iconData_.uCallbackMessage = callbackMessage_;
  iconData_.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
  lstrcpynW(iconData_.szTip, i18n::Tr(L"app.title").c_str(), ARRAYSIZE(iconData_.szTip));

  created_ = Shell_NotifyIconW(NIM_ADD, &iconData_) == TRUE;
  return created_;
}

void TrayIcon::Destroy() {
  if (created_) {
    Shell_NotifyIconW(NIM_DELETE, &iconData_);
    created_ = false;
  }
}

void TrayIcon::ShowBalloon(const wchar_t* title, const wchar_t* message) {
  if (!created_) {
    return;
  }
  NOTIFYICONDATAW data = iconData_;
  data.uFlags |= NIF_INFO;
  lstrcpynW(data.szInfoTitle, title, ARRAYSIZE(data.szInfoTitle));
  lstrcpynW(data.szInfo, message, ARRAYSIZE(data.szInfo));
  data.dwInfoFlags = NIIF_INFO;
  Shell_NotifyIconW(NIM_MODIFY, &data);
}

void TrayIcon::ShowContextMenu() {
  HMENU menu = CreatePopupMenu();
  if (menu == nullptr) {
    return;
  }

  AppendMenuW(menu, MF_STRING, kCmdShow, i18n::Tr(L"tray.show").c_str());
  AppendMenuW(menu, MF_STRING, kCmdExit, i18n::Tr(L"tray.exit").c_str());

  POINT cursor{};
  GetCursorPos(&cursor);
  SetForegroundWindow(ownerWindow_);
  TrackPopupMenu(menu, TPM_RIGHTALIGN | TPM_BOTTOMALIGN, cursor.x, cursor.y, 0, ownerWindow_, nullptr);
  DestroyMenu(menu);
}

void TrayIcon::OnTrayEvent(const LPARAM lparam) {
  if (lparam == WM_RBUTTONUP || lparam == WM_CONTEXTMENU || lparam == WM_LBUTTONUP) {
    ShowContextMenu();
  }
}

}  // namespace audiostream::ui
