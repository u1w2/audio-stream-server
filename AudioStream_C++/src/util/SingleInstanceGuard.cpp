#include "util/SingleInstanceGuard.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

namespace audiostream {

namespace {

constexpr const wchar_t* kMutexName = L"Global\\AudioStreamSenderMutex";
constexpr const wchar_t* kWindowClass = L"AudioStreamSenderMainWindow";

}  // namespace

SingleInstanceGuard::SingleInstanceGuard()
    : mutexHandle_(nullptr), isFirstInstance_(false) {
  mutexHandle_ = CreateMutexW(nullptr, TRUE, kMutexName);
  if (mutexHandle_ == nullptr) {
    isFirstInstance_ = true;
    return;
  }
  isFirstInstance_ = (GetLastError() != ERROR_ALREADY_EXISTS);
}

SingleInstanceGuard::~SingleInstanceGuard() {
  if (mutexHandle_ != nullptr) {
    CloseHandle(static_cast<HANDLE>(mutexHandle_));
    mutexHandle_ = nullptr;
  }
}

bool SingleInstanceGuard::IsFirstInstance() const {
  return isFirstInstance_;
}

void SingleInstanceGuard::ActivateExistingInstance() const {
  HWND existing = FindWindowW(kWindowClass, nullptr);
  if (existing == nullptr) {
    return;
  }
  if (IsIconic(existing)) {
    ShowWindow(existing, SW_RESTORE);
  }
  SetForegroundWindow(existing);
}

}  // namespace audiostream
