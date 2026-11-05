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
#include "util/NetUtil.h"
#include "webrtc/WebRtcEngine.h"

#include <cstdio>
#include <cstdlib>
#include <memory>
#include <mutex>
#include <sstream>
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

std::string AppendQueryParam(const std::string& url, const std::string& key, const std::string& value) {
  std::ostringstream out;
  out << url;
  out << (url.find('?') != std::string::npos ? '&' : '?');
  out << key << '=' << value;
  return out.str();
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

  if (!StartLanServices()) {
    Logger::Error("Failed to start local signaling server");
    return false;
  }

  tray_ = new TrayHolder();
  if (!tray_->icon.Create(mainWindow_->window.Handle(), instance_, trayCallbackMessage_)) {
    Logger::Error("Failed to create tray icon");
    return false;
  }

  UpdateRoomDisplay();
  RefreshLanInterfaceOptions();
  RefreshLatencyModeUi();
  const LanRoomInfo room = localSignaling_->GetRoom();
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
    if (commandId == ui::MainWindow::kControlLanApplyButton) {
      ApplyLanIpFromUi();
      return true;
    }
    if (commandId == ui::MainWindow::kControlLatencyApplyButton) {
      ApplyLatencyModeFromUi();
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

bool Application::StartLanServices() {
  const auto publicDir = Paths::PublicAssetsDirectory().string();
  Logger::Info("Public assets directory: " + publicDir);
  std::string preferredLanIp = config_.lanIp;
  char* envLanIp = nullptr;
  size_t envLanIpLen = 0;
  if (_dupenv_s(&envLanIp, &envLanIpLen, "AUDIOSTREAM_LAN_IP") == 0 && envLanIp != nullptr &&
      envLanIp[0] != '\0') {
    preferredLanIp = envLanIp;
    Logger::Info("Using LAN IP from AUDIOSTREAM_LAN_IP: " + preferredLanIp);
  }
  if (envLanIp != nullptr) {
    free(envLanIp);
  }
  // Always tear down the previous engine first so a failed signaling start never leaves an
  // engine pointed at a dead port.
  if (webrtcEngine_ != nullptr) {
    webrtcEngine_->Stop();
    delete webrtcEngine_;
    webrtcEngine_ = nullptr;
  }
  if (!localSignaling_->Start(config_.localPort, config_.maxConnections, publicDir, preferredLanIp)) {
    return false;
  }

  const LanRoomInfo room = localSignaling_->GetRoom();
  webrtcEngine_ = new WebRtcEngine();
  webrtcEngine_->SetLatencyMode(config_.latencyMode == LatencyMode::kTarget200ms);
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
  const std::string engineUrl = BuildEngineUrl(room.port);
  if (!webrtcEngine_->Start(mainWindow_->window.Handle(), engineUrl)) {
    Logger::Warn("WebRTC engine failed to start; receivers will connect but audio may be unavailable");
  }
  return true;
}

void Application::RefreshLanInterfaceOptions() {
  if (mainWindow_ == nullptr || localSignaling_ == nullptr) {
    return;
  }
  const auto interfaces = localSignaling_->GetNetworkInterfaces();
  std::vector<std::wstring> items;
  items.reserve(interfaces.size());
  for (const auto& iface : interfaces) {
    std::wstring item = Utf8ToWide(iface.name);
    item += L" [";
    item += Utf8ToWide(iface.address);
    item += L"]";
    items.push_back(item);
  }
  std::wstring selected = config_.lanIp.empty() ? Utf8ToWide(localSignaling_->GetRoom().localIp)
                                                 : Utf8ToWide(config_.lanIp);
  mainWindow_->window.SetLanInterfaceList(items, selected);
}

void Application::ApplyLanIpFromUi() {
  if (mainWindow_ == nullptr || localSignaling_ == nullptr) {
    return;
  }
  const std::wstring selectedIpWide = mainWindow_->window.GetSelectedLanIp();
  std::string selectedIp;
  selectedIp.reserve(selectedIpWide.size());
  for (const wchar_t ch : selectedIpWide) {
    if (ch > 0x7F) {
      selectedIp.clear();  // IPv4 text is ASCII-only; anything else is not an IP
      break;
    }
    selectedIp.push_back(static_cast<char>(ch));
  }
  if (!IsValidIPv4(selectedIp)) {
    mainWindow_->window.SetStatusText(i18n::Tr(L"status.lan_ip_apply_failed"));
    return;
  }
  if (selectedIp == localSignaling_->GetRoom().localIp) {
    if (config_.lanIp != selectedIp) {
      config_.lanIp = selectedIp;
      const ConfigService configService;
      configService.Save(config_);
    }
    mainWindow_->window.SetStatusText(i18n::Tr(L"status.lan_ip_applied"));
    return;
  }

  // The listener binds 0.0.0.0, so only the advertised URL/QR changes: no restart, the room
  // code and already-connected receivers are kept.
  if (!localSignaling_->SetLocalIp(selectedIp)) {
    mainWindow_->window.SetStatusText(i18n::Tr(L"status.lan_ip_apply_failed"));
    RefreshLanInterfaceOptions();
    return;
  }
  config_.lanIp = selectedIp;
  const ConfigService configService;
  configService.Save(config_);
  UpdateReceiverUrlDisplay();
  mainWindow_->window.SetStatusText(i18n::Tr(L"status.lan_ip_applied"));
}

std::string Application::BuildEngineUrl(const int port) const {
  std::ostringstream url;
  url << "http://127.0.0.1:" << port << "/sender-engine.html";
  if (config_.latencyMode == LatencyMode::kTarget200ms) {
    // AudioWorklet: 128-frame render quantum instead of a 256-frame ScriptProcessor buffer.
    // sender-engine falls back to ScriptProcessor automatically if the worklet fails to load.
    url << "?latencyMode=200ms&profile=low&autoLow=0&worklet=1";
  } else {
    url << "?latencyMode=stable&profile=stable&autoLow=0";
  }
  return url.str();
}

std::string Application::ReceiverUrlWithMode(const std::string& baseUrl) const {
  if (config_.latencyMode == LatencyMode::kTarget200ms) {
    return AppendQueryParam(baseUrl, "latencyMode", "200ms");
  }
  return AppendQueryParam(baseUrl, "latencyMode", "stable");
}

void Application::RefreshLatencyModeUi() {
  if (mainWindow_ == nullptr) {
    return;
  }
  mainWindow_->window.SetLatencyModeSelection(config_.latencyMode == LatencyMode::kTarget200ms);
  if (config_.latencyMode == LatencyMode::kTarget200ms) {
    mainWindow_->window.SetLatencyEstimateText(i18n::Tr(L"latency.estimate.200ms"));
  } else {
    mainWindow_->window.SetLatencyEstimateText(i18n::Tr(L"latency.estimate.stable"));
  }
}

bool Application::RestartLanServices() {
  {
    std::lock_guard<std::mutex> lock(receiversMutex_);
    receivers_.clear();
  }
  audioCaptured_ = false;
  audioStreaming_ = false;
  localSignaling_->Stop();
  return StartLanServices();
}

void Application::ApplyLatencyModeFromUi() {
  if (mainWindow_ == nullptr || localSignaling_ == nullptr) {
    return;
  }
  const LatencyMode selectedMode =
      mainWindow_->window.IsLatencyMode200msSelected() ? LatencyMode::kTarget200ms
                                                      : LatencyMode::kStable;
  if (selectedMode == config_.latencyMode) {
    RefreshLatencyModeUi();
    mainWindow_->window.SetStatusText(i18n::Tr(L"status.latency_mode_applied"));
    return;
  }

  const LatencyMode previousMode = config_.latencyMode;
  config_.latencyMode = selectedMode;
  if (!RestartLanServices()) {
    // Roll back to the last working mode instead of leaving the app without a server.
    Logger::Error("Latency mode restart failed; rolling back");
    config_.latencyMode = previousMode;
    const bool recovered = RestartLanServices();
    if (recovered) {
      UpdateRoomDisplay();
      RefreshLanInterfaceOptions();
    }
    RefreshLatencyModeUi();
    mainWindow_->window.SetStatusText(i18n::Tr(L"status.latency_mode_apply_failed"));
    return;
  }

  const ConfigService configService;
  configService.Save(config_);
  UpdateRoomDisplay();
  RefreshLanInterfaceOptions();
  RefreshLatencyModeUi();
  mainWindow_->window.SetStatusText(i18n::Tr(L"status.latency_mode_applied"));
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
  mainWindow_->window.SetAudioStatusText(i18n::Tr(L"status.audio_waiting"));
  audioStreaming_ = false;
  audioCaptured_ = false;
  UpdateReceiverDisplay();
  UpdateReceiverUrlDisplay();
}

void Application::UpdateReceiverUrlDisplay() {
  if (localSignaling_ == nullptr || mainWindow_ == nullptr) {
    return;
  }
  const std::string receiverUrl = ReceiverUrlWithMode(localSignaling_->GetRoom().receiverUrl);
  mainWindow_->window.SetReceiverUrl(Utf8ToWide(receiverUrl));
  HBITMAP qrBitmap = QrBitmap::CreateFromUtf8(receiverUrl, 200);
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
