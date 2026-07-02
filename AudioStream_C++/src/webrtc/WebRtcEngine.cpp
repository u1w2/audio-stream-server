#include "webrtc/WebRtcEngine.h"

#include "audio/WasapiLoopbackCapture.h"
#include "util/Logger.h"
#include "util/StringUtil.h"

#include <unknwn.h>
#include <wrl/client.h>
#include <wrl/event.h>
#include <WebView2EnvironmentOptions.h>
#include <WebView2.h>

#include <atomic>
#include <deque>
#include <algorithm>
#include <mutex>
#include <sstream>
#include <string>
#include <vector>

namespace audiostream {

namespace {

using Microsoft::WRL::ComPtr;

constexpr UINT kPcmFlushTimerId = 1;
constexpr UINT kPcmFlushIntervalMs = 8;
constexpr UINT kPushAudioConfigMsg = WM_APP + 46;
constexpr UINT kFlushPcmNowMsg = WM_APP + 47;
// ~10 ms stereo PCM @ 48 kHz
constexpr size_t kMaxPcmBytesPerMessage = 1920;
// Cap queued PCM to ~100 ms
constexpr int kMaxQueueMs = 100;

std::string Base64Encode(const uint8_t* data, size_t len) {
  static const char kTable[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((len + 2) / 3) * 4);
  for (size_t i = 0; i < len; i += 3) {
    const uint32_t n = (static_cast<uint32_t>(data[i]) << 16) |
                       ((i + 1 < len ? data[i + 1] : 0) << 8) |
                       (i + 2 < len ? data[i + 2] : 0);
    out.push_back(kTable[(n >> 18) & 63]);
    out.push_back(kTable[(n >> 12) & 63]);
    out.push_back(i + 1 < len ? kTable[(n >> 6) & 63] : '=');
    out.push_back(i + 2 < len ? kTable[n & 63] : '=');
  }
  return out;
}

void PostJsonMessage(ICoreWebView2* webView, const std::string& json) {
  if (webView == nullptr) {
    return;
  }
  const std::wstring wide = Utf8ToWide(json);
  webView->PostWebMessageAsJson(wide.c_str());
}

}  // namespace

struct WebRtcEngine::Impl {
  HWND hostWindow = nullptr;
  HWND parentWindow = nullptr;
  ComPtr<ICoreWebView2Controller> controller;
  ComPtr<ICoreWebView2> webView;
  WasapiLoopbackCapture capture;
  EventCallback eventCallback;
  bool running = false;
  bool captureStarted = false;
  bool enginePageReady = false;
  int sampleRate = 48000;
  int channels = 2;

  void PushAudioConfigOnUiThread() {
    if (!webView || !captureStarted) {
      return;
    }

    const std::string configJson = "{\"type\":\"audio-config\",\"sampleRate\":" +
                                   std::to_string(sampleRate) + ",\"channels\":" +
                                   std::to_string(channels) + "}";
    PostJsonMessage(webView.Get(), configJson);

    const std::wstring script = L"window.__setupNativeAudio && window.__setupNativeAudio(" +
                                std::to_wstring(sampleRate) + L"," + std::to_wstring(channels) +
                                L");";
    webView->ExecuteScript(script.c_str(), nullptr);
    Logger::Info("Pushed native audio config to engine page");
  }

  void RequestPushAudioConfig() {
    if (hostWindow != nullptr) {
      PostMessageW(hostWindow, kPushAudioConfigMsg, 0, 0);
    }
  }

  std::mutex pcmMutex;
  std::deque<int16_t> pcmQueue;
  std::atomic<bool> flushPosted{false};

  size_t MaxQueuedSamples() const {
    const int rate = sampleRate > 0 ? sampleRate : 48000;
    const int ch = channels > 0 ? channels : 2;
    return static_cast<size_t>(rate) * static_cast<size_t>(ch) * kMaxQueueMs / 1000;
  }

  size_t MinFlushSamples() const {
    const int rate = sampleRate > 0 ? sampleRate : 48000;
    const int ch = channels > 0 ? channels : 2;
    return static_cast<size_t>(rate) * static_cast<size_t>(ch) / 100;  // 10 ms
  }

  void ScheduleFlush() {
    if (hostWindow == nullptr) {
      return;
    }
    bool expected = false;
    if (flushPosted.compare_exchange_strong(expected, true)) {
      PostMessageW(hostWindow, kFlushPcmNowMsg, 0, 0);
    }
  }

  void NotifyEvent(const std::string& event) {
    if (eventCallback) {
      eventCallback(event);
    }
  }

  void EnqueuePcm(const int16_t* samples, size_t frameCount, int channelsCount) {
    bool shouldFlush = false;
    {
      std::lock_guard<std::mutex> lock(pcmMutex);
      const size_t sampleCount = frameCount * static_cast<size_t>(channelsCount);
      pcmQueue.insert(pcmQueue.end(), samples, samples + sampleCount);
      const size_t maxSamples = MaxQueuedSamples();
      while (pcmQueue.size() > maxSamples) {
        pcmQueue.pop_front();
      }
      shouldFlush = pcmQueue.size() >= MinFlushSamples();
    }
    if (shouldFlush) {
      ScheduleFlush();
    }
  }

  void FlushPcmQueue() {
    flushPosted.store(false);
    if (!webView) {
      return;
    }

    std::vector<int16_t> chunk;
    bool hasMore = false;
    {
      std::lock_guard<std::mutex> lock(pcmMutex);
      if (pcmQueue.empty()) {
        return;
      }
      const size_t maxSamples = kMaxPcmBytesPerMessage / sizeof(int16_t);
      const size_t take = std::min(pcmQueue.size(), maxSamples);
      chunk.assign(pcmQueue.begin(), pcmQueue.begin() + static_cast<std::ptrdiff_t>(take));
      pcmQueue.erase(pcmQueue.begin(), pcmQueue.begin() + static_cast<std::ptrdiff_t>(take));
      hasMore = pcmQueue.size() >= MinFlushSamples();
    }

    const size_t frameCount = chunk.size() / static_cast<size_t>(channels);
    const std::string b64 =
        Base64Encode(reinterpret_cast<const uint8_t*>(chunk.data()), chunk.size() * sizeof(int16_t));

    std::ostringstream json;
    json << "{\"type\":\"pcm\",\"sampleRate\":" << sampleRate << ",\"channels\":" << channels
         << ",\"frames\":" << frameCount << ",\"data\":\"" << b64 << "\"}";
    PostJsonMessage(webView.Get(), json.str());

    if (hasMore) {
      ScheduleFlush();
    }
  }

  void StartNativeCapture() {
    if (captureStarted) {
      return;
    }

    const bool started = capture.Start(
        [this](const int16_t* samples, size_t frameCount, int rate, int ch) {
          sampleRate = rate;
          channels = ch;
          EnqueuePcm(samples, frameCount, ch);
        },
        [this](const bool ok, const int rate, const int ch) {
          if (!ok) {
            Logger::Error("Native audio capture failed");
            NotifyEvent("capture-failed");
            return;
          }
          captureStarted = true;
          sampleRate = rate;
          channels = ch;
          Logger::Info("Native audio capture ready");
          NotifyEvent("capture-started");
          RequestPushAudioConfig();
          if (hostWindow != nullptr) {
            SetTimer(hostWindow, kPcmFlushTimerId, kPcmFlushIntervalMs, nullptr);
          }
        });

    if (!started) {
      Logger::Error("Failed to start WASAPI capture thread");
      NotifyEvent("capture-failed");
    }
  }

  static LRESULT CALLBACK HostWndProc(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam) {
    auto* impl = reinterpret_cast<Impl*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (msg == WM_TIMER && wparam == kPcmFlushTimerId && impl != nullptr) {
      impl->FlushPcmQueue();
      return 0;
    }
    if (msg == kFlushPcmNowMsg && impl != nullptr) {
      impl->FlushPcmQueue();
      return 0;
    }
    if (msg == kPushAudioConfigMsg && impl != nullptr) {
      impl->PushAudioConfigOnUiThread();
      return 0;
    }
    if (msg == WM_DESTROY && impl != nullptr) {
      KillTimer(hwnd, kPcmFlushTimerId);
    }
    return DefWindowProcW(hwnd, msg, wparam, lparam);
  }

  HWND CreateHiddenHostWindow(HWND parent) {
    static bool registered = false;
    if (!registered) {
      WNDCLASSEXW wc{};
      wc.cbSize = sizeof(wc);
      wc.lpfnWndProc = HostWndProc;
      wc.hInstance = GetModuleHandleW(nullptr);
      wc.lpszClassName = L"AudioStreamWebRtcHost";
      RegisterClassExW(&wc);
      registered = true;
    }

    HWND hwnd = CreateWindowExW(
        WS_EX_NOACTIVATE, L"AudioStreamWebRtcHost", L"", WS_CHILD, 0, 0, 1, 1, parent, nullptr,
        GetModuleHandleW(nullptr), nullptr);
    if (hwnd != nullptr) {
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(this));
      ShowWindow(hwnd, SW_HIDE);
    }
    return hwnd;
  }
};

WebRtcEngine::WebRtcEngine() : impl_(new Impl()) {}

WebRtcEngine::~WebRtcEngine() {
  Stop();
  delete impl_;
}

void WebRtcEngine::SetEventCallback(EventCallback callback) {
  impl_->eventCallback = std::move(callback);
}

bool WebRtcEngine::Start(HWND parentWindow, const std::string& engineUrl) {
  if (impl_->running) {
    return true;
  }

  impl_->parentWindow = parentWindow;
  impl_->hostWindow = impl_->CreateHiddenHostWindow(parentWindow);
  if (impl_->hostWindow == nullptr) {
    Logger::Error("Failed to create hidden WebRTC host window");
    return false;
  }

  const std::wstring wideUrl = Utf8ToWide(engineUrl);
  Impl* impl = impl_;

  const HRESULT envHr = CreateCoreWebView2EnvironmentWithOptions(
      nullptr, nullptr, nullptr,
      Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
          [impl, wideUrl, engineUrl](HRESULT result, ICoreWebView2Environment* environment) -> HRESULT {
            if (FAILED(result) || environment == nullptr) {
              Logger::Error("WebView2 environment creation failed");
              return result;
            }

            return environment->CreateCoreWebView2Controller(
                impl->hostWindow,
                Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                    [impl, wideUrl, engineUrl](HRESULT controllerResult,
                                               ICoreWebView2Controller* controller) -> HRESULT {
                      if (FAILED(controllerResult) || controller == nullptr) {
                        Logger::Error("WebView2 controller creation failed");
                        return controllerResult;
                      }

                      impl->controller = controller;
                      impl->controller->get_CoreWebView2(&impl->webView);
                      if (impl->webView == nullptr) {
                        Logger::Error("WebView2 core instance missing");
                        return E_FAIL;
                      }

                      impl->controller->put_Bounds({0, 0, 0, 0});
                      impl->controller->put_IsVisible(FALSE);

                      ComPtr<ICoreWebView2Settings> settings;
                      if (SUCCEEDED(impl->webView->get_Settings(&settings)) && settings) {
                        settings->put_IsWebMessageEnabled(TRUE);
                      }

                      impl->webView->add_WebMessageReceived(
                          Microsoft::WRL::Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                              [impl](ICoreWebView2* /*sender*/,
                                     ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                                LPWSTR message = nullptr;
                                if (SUCCEEDED(args->TryGetWebMessageAsString(&message)) && message != nullptr) {
                                  if (wcsstr(message, L"track-ready") != nullptr) {
                                    impl->NotifyEvent("track-ready");
                                  } else if (wcsstr(message, L"engine-ready") != nullptr) {
                                    impl->enginePageReady = true;
                                    impl->RequestPushAudioConfig();
                                  } else if (wcsstr(message, L"need-audio-config") != nullptr) {
                                    impl->RequestPushAudioConfig();
                                  }
                                  CoTaskMemFree(message);
                                }
                                return S_OK;
                              })
                              .Get(),
                          nullptr);

                      impl->webView->add_NavigationCompleted(
                          Microsoft::WRL::Callback<ICoreWebView2NavigationCompletedEventHandler>(
                              [impl](ICoreWebView2* /*sender*/,
                                     ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                                BOOL success = FALSE;
                                args->get_IsSuccess(&success);
                                if (success) {
                                  impl->StartNativeCapture();
                                }
                                return S_OK;
                              })
                              .Get(),
                          nullptr);

                      impl->webView->Navigate(wideUrl.c_str());
                      Logger::Info("WebRTC engine navigating to: " + engineUrl);
                      impl->running = true;
                      return S_OK;
                    })
                    .Get());
          })
          .Get());

  if (FAILED(envHr)) {
    Logger::Error("CreateCoreWebView2EnvironmentWithOptions failed");
    return false;
  }

  return true;
}

void WebRtcEngine::EnsureAudioPipeline() {
  impl_->RequestPushAudioConfig();
}

void WebRtcEngine::Stop() {
  if (!impl_->running && impl_->hostWindow == nullptr) {
    return;
  }

  if (impl_->hostWindow != nullptr) {
    KillTimer(impl_->hostWindow, kPcmFlushTimerId);
  }
  impl_->capture.Stop();
  impl_->captureStarted = false;

  if (impl_->webView) {
    impl_->webView->Stop();
    impl_->webView.Reset();
  }
  if (impl_->controller) {
    impl_->controller->Close();
    impl_->controller.Reset();
  }
  if (impl_->hostWindow != nullptr) {
    DestroyWindow(impl_->hostWindow);
    impl_->hostWindow = nullptr;
  }
  impl_->running = false;
}

}  // namespace audiostream
