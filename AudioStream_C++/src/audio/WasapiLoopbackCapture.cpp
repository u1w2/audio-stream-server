#include "audio/WasapiLoopbackCapture.h"

#include "util/Logger.h"

#include <audioclient.h>
#include <ksmedia.h>
#include <mmdeviceapi.h>
#include <wrl/client.h>

#include <functional>
#include <vector>

namespace audiostream {
namespace {

using Microsoft::WRL::ComPtr;

constexpr REFERENCE_TIME kBufferDurationHundredNs = 30 * 10000;  // 30 ms

void ConvertToInt16Interleaved(const BYTE* data, UINT32 numFrames, const WAVEFORMATEX* format,
                               std::vector<int16_t>& out) {
  const int channels = static_cast<int>(format->nChannels);
  out.resize(static_cast<size_t>(numFrames) * static_cast<size_t>(channels));

  if (format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT ||
      (format->wFormatTag == WAVE_FORMAT_EXTENSIBLE &&
       reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format)->SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT)) {
    const auto* samples = reinterpret_cast<const float*>(data);
    for (UINT32 i = 0; i < numFrames * channels; ++i) {
      float sample = samples[i];
      if (sample > 1.0f) {
        sample = 1.0f;
      } else if (sample < -1.0f) {
        sample = -1.0f;
      }
      out[i] = static_cast<int16_t>(sample * 32767.0f);
    }
    return;
  }

  if (format->wFormatTag == WAVE_FORMAT_PCM && format->wBitsPerSample == 16) {
    const auto* samples = reinterpret_cast<const int16_t*>(data);
    for (UINT32 i = 0; i < numFrames * channels; ++i) {
      out[i] = samples[i];
    }
    return;
  }

  out.assign(static_cast<size_t>(numFrames) * static_cast<size_t>(channels), 0);
}

}  // namespace

WasapiLoopbackCapture::WasapiLoopbackCapture() = default;

WasapiLoopbackCapture::~WasapiLoopbackCapture() {
  Stop();
}

bool WasapiLoopbackCapture::Start(
    PcmCallback callback,
    std::function<void(bool ok, int sampleRate, int channels)> readyCallback) {
  if (running_) {
    return true;
  }
  if (!callback) {
    return false;
  }

  callback_ = std::move(callback);
  readyCallback_ = std::move(readyCallback);
  stopRequested_ = false;
  threadHandle_ = CreateThread(nullptr, 0, ThreadProc, this, 0, &threadId_);
  if (threadHandle_ == nullptr) {
    Logger::Error("WASAPI capture thread creation failed");
    callback_ = nullptr;
    return false;
  }
  return true;
}

DWORD WINAPI WasapiLoopbackCapture::ThreadProc(LPVOID param) {
  auto* self = static_cast<WasapiLoopbackCapture*>(param);
  self->CaptureThreadMain();
  return 0;
}

void WasapiLoopbackCapture::Stop() {
  if (!running_ && threadHandle_ == nullptr) {
    return;
  }
  stopRequested_ = true;
  if (threadHandle_ != nullptr) {
    WaitForSingleObject(threadHandle_, 5000);
    CloseHandle(threadHandle_);
    threadHandle_ = nullptr;
  }
  running_ = false;
  callback_ = nullptr;
  readyCallback_ = nullptr;
}

void WasapiLoopbackCapture::CaptureThreadMain() {
  const HRESULT coinit = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  const bool needsUninit = SUCCEEDED(coinit) && coinit != S_FALSE;

  ComPtr<IMMDeviceEnumerator> enumerator;
  ComPtr<IMMDevice> device;
  ComPtr<IAudioClient> audioClient;
  ComPtr<IAudioCaptureClient> captureClient;
  WAVEFORMATEX* mixFormat = nullptr;
  bool startedOk = false;
  std::vector<int16_t> pcm;

  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                __uuidof(IMMDeviceEnumerator),
                                reinterpret_cast<void**>(enumerator.GetAddressOf()));
  if (FAILED(hr)) {
    Logger::Error("WASAPI: MMDeviceEnumerator failed");
    goto cleanup;
  }

  hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
  if (FAILED(hr)) {
    Logger::Error("WASAPI: default render endpoint failed");
    goto cleanup;
  }

  hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
                        reinterpret_cast<void**>(audioClient.GetAddressOf()));
  if (FAILED(hr)) {
    Logger::Error("WASAPI: IAudioClient activate failed");
    goto cleanup;
  }

  hr = audioClient->GetMixFormat(&mixFormat);
  if (FAILED(hr) || mixFormat == nullptr) {
    Logger::Error("WASAPI: GetMixFormat failed");
    goto cleanup;
  }

  sampleRate_ = static_cast<int>(mixFormat->nSamplesPerSec);
  channels_ = static_cast<int>(mixFormat->nChannels);

  hr = audioClient->Initialize(AUDCLNT_SHAREMODE_SHARED,
                               AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                               kBufferDurationHundredNs, 0, mixFormat, nullptr);
  if (FAILED(hr)) {
    Logger::Error("WASAPI: Initialize loopback failed");
    goto cleanup;
  }

  hr = audioClient->GetService(__uuidof(IAudioCaptureClient),
                               reinterpret_cast<void**>(captureClient.GetAddressOf()));
  if (FAILED(hr)) {
    Logger::Error("WASAPI: IAudioCaptureClient failed");
    goto cleanup;
  }

  hr = audioClient->Start();
  if (FAILED(hr)) {
    Logger::Error("WASAPI: Start failed");
    goto cleanup;
  }

  running_ = true;
  startedOk = true;
  Logger::Info("WASAPI loopback started: " + std::to_string(sampleRate_) + " Hz, " +
               std::to_string(channels_) + " ch");
  if (readyCallback_) {
    readyCallback_(true, sampleRate_, channels_);
  }

  while (!stopRequested_) {
    UINT32 packetLength = 0;
    hr = captureClient->GetNextPacketSize(&packetLength);
    if (FAILED(hr)) {
      break;
    }

    while (packetLength > 0) {
      BYTE* data = nullptr;
      UINT32 numFrames = 0;
      DWORD flags = 0;
      hr = captureClient->GetBuffer(&data, &numFrames, &flags, nullptr, nullptr);
      if (FAILED(hr)) {
        stopRequested_ = true;
        break;
      }

      if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT) && data != nullptr && numFrames > 0) {
        ConvertToInt16Interleaved(data, numFrames, mixFormat, pcm);
        if (callback_) {
          callback_(pcm.data(), numFrames, sampleRate_, channels_);
        }
      }

      captureClient->ReleaseBuffer(numFrames);
      hr = captureClient->GetNextPacketSize(&packetLength);
      if (FAILED(hr)) {
        stopRequested_ = true;
        break;
      }
    }

    Sleep(1);
  }

  audioClient->Stop();

cleanup:
  if (mixFormat != nullptr) {
    CoTaskMemFree(mixFormat);
  }
  if (!startedOk && readyCallback_) {
    readyCallback_(false, 0, 0);
  }
  running_ = false;
  if (needsUninit) {
    CoUninitialize();
  }
}

}  // namespace audiostream
