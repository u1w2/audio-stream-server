#include "app/Application.h"

#include "signaling/LocalSignalingServer.h"
#include "signaling/JsonUtil.h"
#include "ui/MainWindow.h"
#include "ui/TrayIcon.h"
#include "ui/i18n/Locale.h"
#include "util/Logger.h"
#include "util/Paths.h"
#include "util/QrBitmap.h"
#include "util/SingleInstanceGuard.h"
#include "util/StringUtil.h"
#include "webrtc/WebRtcEngine.h"

#include <cstdio>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace audiostream {

namespace {

constexpr UINT kTrayCallbackMessage = WM_APP + 42;
constexpr UINT kRefreshReceiversMessage = WM_APP + 43;

std::string ModeToString(const Mode mode) {
  return mode == Mode::kCloud ? "cloud" : "lan";
}

}  // namespace

class Application::MainWindowHolder {
 public:
  ui::MainWindow window;
};

class Application::TrayHolder {
 public:
  ui::TrayIcon icon;
};

Application::Application(const HINSTANCE instance)
    : instance_(instance),
      localSignaling_(nullptr),
      webrtcEngine_(nullptr),
      mainWindow_(nullptr),
      tray_(nullptr),
      trayCallbackMessage_(kTrayCallbackMessage),
      running_(false) {}

int Application::Run(const int commandShow) {
  Logger::Initialize();
  Logger::Info("Log file: " + Logger::LogFilePath());

  SingleInstanceGuard instanceGuard;
  if (!instanceGuard.IsFirstInstance()) {
    instanceGuard.ActivateExistingInstance();
    Logger::Info("Second instance blocked; activating existing window");
    return 0;
  }

  if (!Initialize()) {
    Logger::Error("Application initialization failed");
    return 1;
  }

  mainWindow_->window.Show(config_.showWindowOnStart ? commandShow : SW_HIDE);
  running_ = true;

  MSG message{};
  while (running_ && GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }

  Shutdown();
  return static_cast<int>(message.wParam);
}

bool Application::Initialize() {
  if (!Paths::EnsureAppDataLayout()) {
    Logger::Error("Failed to initialize app data directories");
    return false;
  }

  const ConfigService configService;
  config_ = configService.LoadOrDefault();
  ApplyLocaleFromConfig();

  mainWindow_ = new MainWindowHolder();
  if (!mainWindow_->window.Create(instance_)) {
    Logger::Error("Failed to create main window");
    return false;
  }

  WireWindowHandlers();

  localSignaling_ = new LocalSignalingServer();
  localSignaling_->SetSenderCallback(
      [this](const std::string& messageJson) { OnSignalingMessage(messageJson); });

  const auto publicDir = Paths::PublicAssetsDirectory().string();
  Logger::Info("Public assets directory: " + publicDir);
  if (!localSignaling_->Start(config_.localPort, config_.maxConnections, publicDir)) {
    Logger::Error("Failed to start local signaling server");
    return false;
  }

  tray_ = new TrayHolder();
  if (!tray_->icon.Create(mainWindow_->window.Handle(), instance_, trayCallbackMessage_)) {
    Logger::Error("Failed to create tray icon");
    return false;
  }

  UpdateRoomDisplay();

  const LanRoomInfo room = localSignaling_->GetRoom();
  webrtcEngine_ = new WebRtcEngine();
  webrtcEngine_->SetEventCallback([this](const std::string& event) {
    if (event == "capture-started") {
      audioCaptured_ = true;
      if (mainWindow_ != nullptr) {
        PostMessageW(mainWindow_->window.Handle(), kRefreshReceiversMessage, 0, 0);
      }
    } else if (event == "capture-failed") {
      audioCaptured_ = false;
      if (mainWindow_ != nullptr) {
        mainWindow_->window.SetAudioStatusText(i18n::Tr(L"status.audio_failed"));
      }
    }
  });
  const std::string engineUrl = "http://127.0.0.1:" + std::to_string(room.port) + "/sender-engine.html";
  if (!webrtcEngine_->Start(mainWindow_->window.Handle(), engineUrl)) {
    Logger::Warn("WebRTC engine failed to start; receivers will connect but audio may be unavailable");
  }

  Logger::Info("Room code: " + room.code);
  Logger::Info("Receiver URL: " + room.receiverUrl);
  Logger::Info("AudioStream C++ phase-2 LAN server started");
  Logger::Info("Default mode: " + ModeToString(config_.defaultMode));
  Logger::Info("Config path: " + Paths::ConfigFile().string());
  return true;
}

void Application::Shutdown() {
  const ConfigService configService;
  configService.Save(config_);

  if (localSignaling_ != nullptr) {
    localSignaling_->Stop();
    delete localSignaling_;
    localSignaling_ = nullptr;
  }

  if (webrtcEngine_ != nullptr) {
    webrtcEngine_->Stop();
    delete webrtcEngine_;
    webrtcEngine_ = nullptr;
  }

  if (tray_ != nullptr) {
    tray_->icon.Destroy();
    delete tray_;
    tray_ = nullptr;
  }
  if (mainWindow_ != nullptr) {
    delete mainWindow_;
    mainWindow_ = nullptr;
  }
}

void Application::ApplyLocaleFromConfig() {
  i18n::LocaleService::Instance().SetLocale(
      config_.locale == AppLocale::kEnUS ? i18n::Locale::kEnUS : i18n::Locale::kZhCN);
}

void Application::WireWindowHandlers() {
  mainWindow_->window.SetMessageHandler([this](const UINT msg, const WPARAM wparam,
                                                const LPARAM lparam) {
    return HandleWindowMessage(msg, wparam, lparam);
  });
}

bool Application::HandleWindowMessage(const UINT msg, const WPARAM wparam, const LPARAM lparam) {
  if (msg == trayCallbackMessage_) {
    tray_->icon.OnTrayEvent(lparam);
    return true;
  }

  if (msg == kRefreshReceiversMessage) {
    UpdateReceiverDisplay();
    return true;
  }

  if (msg == WM_COMMAND) {
    const int commandId = LOWORD(wparam);
    if (commandId == ui::TrayIcon::kCmdShow) {
      ShowMainWindow();
      return true;
    }
    if (commandId == ui::TrayIcon::kCmdExit) {
      ExitApplication();
      return true;
    }
  }

  return false;
}

void Application::ShowMainWindow() {
  if (mainWindow_ == nullptr) {
    return;
  }
  ShowWindow(mainWindow_->window.Handle(), SW_SHOW);
  SetForegroundWindow(mainWindow_->window.Handle());
}

void Application::ExitApplication() {
  running_ = false;
  if (mainWindow_ != nullptr) {
    DestroyWindow(mainWindow_->window.Handle());
  }
}

void Application::UpdateRoomDisplay() {
  if (localSignaling_ == nullptr || mainWindow_ == nullptr) {
    return;
  }

  const LanRoomInfo room = localSignaling_->GetRoom();
  std::wstring status = i18n::Tr(L"status.room_waiting");
  if (room.port != config_.localPort) {
    wchar_t portNote[160];
    swprintf_s(portNote, i18n::Tr(L"status.port_fallback").c_str(), config_.localPort, room.port);
    status = std::wstring(portNote) + L"\n" + status;
  }
  mainWindow_->window.SetStatusText(status);
  mainWindow_->window.SetRoomCode(Utf8ToWide(room.code));
  mainWindow_->window.SetReceiverUrl(Utf8ToWide(room.receiverUrl));
  mainWindow_->window.SetAudioStatusText(i18n::Tr(L"status.audio_waiting"));
  audioStreaming_ = false;
  audioCaptured_ = false;
  UpdateReceiverDisplay();

  HBITMAP qrBitmap = QrBitmap::CreateFromUtf8(room.receiverUrl, 200);
  if (qrBitmap != nullptr) {
    mainWindow_->window.SetQrBitmap(qrBitmap);
  } else {
    Logger::Error("Failed to generate QR bitmap");
  }
}

void Application::UpdateReceiverDisplay() {
  if (mainWindow_ == nullptr) {
    return;
  }

  std::vector<std::wstring> items;
  size_t count = 0;
  {
    std::lock_guard<std::mutex> lock(receiversMutex_);
    count = receivers_.size();
    items.reserve(receivers_.size());
    for (const auto& entry : receivers_) {
      items.push_back(Utf8ToWide(entry.second) + L" (" + Utf8ToWide(entry.first) + L")");
    }
  }

  mainWindow_->window.SetReceiverList(items);

  if (count == 0) {
    mainWindow_->window.SetStatusText(i18n::Tr(L"status.room_waiting"));
    if (audioCaptured_) {
      mainWindow_->window.SetAudioStatusText(i18n::Tr(L"status.audio_ready"));
    } else {
      mainWindow_->window.SetAudioStatusText(i18n::Tr(L"status.audio_waiting"));
    }
    return;
  }

  wchar_t statusBuf[128];
  swprintf_s(statusBuf, i18n::Tr(L"status.receivers_connected").c_str(),
             static_cast<int>(count));
  mainWindow_->window.SetStatusText(statusBuf);
  if (audioStreaming_) {
    mainWindow_->window.SetAudioStatusText(i18n::Tr(L"status.audio_capturing"));
  } else {
    mainWindow_->window.SetAudioStatusText(i18n::Tr(L"status.audio_connecting"));
  }
}

void Application::OnSignalingMessage(const std::string& messageJson) {
  Logger::Info("Signaling: " + messageJson);

  const std::string type = JsonGetString(messageJson, "type");
  bool changed = false;
  if (type == "peer-ready") {
    const std::string receiverId = JsonGetString(messageJson, "receiverId");
    std::string nickname = JsonGetString(messageJson, "nickname");
    if (nickname.empty()) {
      nickname = "Listener";
    }
    if (!receiverId.empty()) {
      std::lock_guard<std::mutex> lock(receiversMutex_);
      receivers_[receiverId] = nickname;
      changed = true;
    }
    if (webrtcEngine_ != nullptr) {
      webrtcEngine_->EnsureAudioPipeline();
    }
  } else if (type == "peer-left") {
    const std::string receiverId = JsonGetString(messageJson, "receiverId");
    if (!receiverId.empty()) {
      std::lock_guard<std::mutex> lock(receiversMutex_);
      changed = receivers_.erase(receiverId) > 0;
      if (receivers_.empty()) {
        audioStreaming_ = false;
      }
    }
  } else if (type == "webrtc-offer") {
    audioStreaming_ = true;
    changed = true;
  }

  if (changed && mainWindow_ != nullptr) {
    PostMessageW(mainWindow_->window.Handle(), kRefreshReceiversMessage, 0, 0);
  }
}

}  // namespace audiostream
