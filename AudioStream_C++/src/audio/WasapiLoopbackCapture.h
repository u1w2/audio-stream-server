#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <cstdint>
#include <functional>

namespace audiostream {

class WasapiLoopbackCapture {
 public:
  using PcmCallback = std::function<void(const int16_t* samples, size_t frameCount, int sampleRate,
                                         int channels)>;

  WasapiLoopbackCapture();
  ~WasapiLoopbackCapture();

  WasapiLoopbackCapture(const WasapiLoopbackCapture&) = delete;
  WasapiLoopbackCapture& operator=(const WasapiLoopbackCapture&) = delete;

  bool Start(PcmCallback callback,
             std::function<void(bool ok, int sampleRate, int channels)> readyCallback = nullptr);
  void Stop();

  int SampleRate() const { return sampleRate_; }
  int Channels() const { return channels_; }

 private:
  static DWORD WINAPI ThreadProc(LPVOID param);
  void CaptureThreadMain();

  PcmCallback callback_;
  std::function<void(bool, int, int)> readyCallback_;
  void* threadHandle_ = nullptr;
  DWORD threadId_ = 0;
  volatile bool stopRequested_ = false;
  volatile bool running_ = false;
  int sampleRate_ = 48000;
  int channels_ = 2;
};

}  // namespace audiostream
