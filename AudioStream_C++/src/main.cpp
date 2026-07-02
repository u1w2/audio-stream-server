#include "app/Application.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <objbase.h>

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int commandShow) {
  const HRESULT comHr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  const bool comInitialized = SUCCEEDED(comHr) || comHr == RPC_E_CHANGED_MODE;

  audiostream::Application app(instance);
  const int exitCode = app.Run(commandShow);

  if (comInitialized && comHr != RPC_E_CHANGED_MODE) {
    CoUninitialize();
  }
  return exitCode;
}
