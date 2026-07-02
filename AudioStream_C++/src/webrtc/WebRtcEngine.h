#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <functional>
#include <string>

namespace audiostream {

class WebRtcEngine {
 public:
  using EventCallback = std::function<void(const std::string& event)>;

  WebRtcEngine();
  ~WebRtcEngine();

  WebRtcEngine(const WebRtcEngine&) = delete;
  WebRtcEngine& operator=(const WebRtcEngine&) = delete;

  void SetEventCallback(EventCallback callback);
  bool Start(HWND parentWindow, const std::string& engineUrl);
  void EnsureAudioPipeline();
  void Stop();

 private:
  class Impl;
  Impl* impl_;
};

}  // namespace audiostream
