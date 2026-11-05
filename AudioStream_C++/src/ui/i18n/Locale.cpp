#include "ui/i18n/Locale.h"

#include <unordered_map>

namespace audiostream::i18n {
namespace {

using Catalog = std::unordered_map<std::wstring, std::wstring>;

// Unicode escapes keep MSVC happy when source files are not UTF-8 with BOM.
const Catalog& ZhCatalog() {
  static const Catalog catalog = {
      {L"app.title", L"AudioStream \u53d1\u9001\u7aef"},
      {L"status.ready", L"\u5c31\u7eea\uff0c\u6b63\u5728\u51c6\u5907\u623f\u95f4\u2026"},
      {L"status.room_waiting", L"\u623f\u95f4\u5df2\u521b\u5efa\uff0c\u7b49\u5f85\u542c\u4f17\u52a0\u5165"},
      {L"status.port_fallback",
       L"\u7aef\u53e3 %d \u5df2\u88ab\u5360\u7528\uff0c\u5df2\u6539\u7528 %d\u3002\u8bf7\u4f7f\u7528\u4e0b\u65b9\u94fe\u63a5\u6216\u4e8c\u7ef4\u7801"},
      {L"status.second_instance",
       L"\u5e94\u7528\u5df2\u5728\u8fd0\u884c\uff0c\u5df2\u5207\u6362\u5230\u73b0\u6709\u7a97\u53e3"},
      {L"label.room_code", L"\u623f\u95f4\u7801"},
      {L"label.receiver_url", L"\u542c\u4f17\u94fe\u63a5"},
      {L"label.audio_status", L"\u97f3\u9891\u63a8\u6d41"},
      {L"label.receivers", L"\u5df2\u8fde\u63a5\u542c\u4f17"},
      {L"label.lan_ip", L"\u53d1\u9001\u7f51\u5361 IP"},
      {L"button.apply_lan_ip", L"\u5e94\u7528 IP"},
      {L"label.latency_mode", L"\u5ef6\u65f6\u6a21\u5f0f"},
      {L"latency.mode.stable", L"\u7a33\u97f3\u8d28\uff08\u9ed8\u8ba4\uff09"},
      {L"latency.mode.200ms", L"200ms \u4f4e\u5ef6\u65f6"},
      {L"button.apply_latency_mode", L"\u5e94\u7528\u6a21\u5f0f"},
      {L"latency.estimate.placeholder", L"\u5ef6\u65f6\u4f30\u7b97\uff1a\u7b49\u5f85\u8fde\u63a5"},
      {L"latency.estimate.stable", L"\u9884\u4f30\u5ef6\u65f6: ~350-500ms (\u7a33\u97f3\u8d28)"},
      {L"latency.estimate.200ms", L"\u76ee\u6807\u5ef6\u65f6: \u2264200ms (\u5c40\u57df\u7f51 P2P)"},
      {L"receivers.empty", L"\u6682\u65e0\u542c\u4f17"},
      {L"status.audio_waiting", L"\u6b63\u5728\u6355\u83b7\u7cfb\u7edf\u97f3\u9891\u2026"},
      {L"status.audio_ready", L"\u7cfb\u7edf\u97f3\u9891\u5df2\u5c31\u7eea"},
      {L"status.audio_capturing", L"\u97f3\u9891\u6b63\u5728\u63a8\u6d41"},
      {L"status.audio_connecting", L"\u542c\u4f17\u5df2\u8fde\u63a5\uff0c\u6b63\u5728\u5efa\u7acb\u97f3\u9891\u2026"},
      {L"status.audio_failed", L"\u7cfb\u7edf\u97f3\u9891\u6355\u83b7\u5931\u8d25"},
      {L"status.receivers_connected", L"%d \u4f4d\u542c\u4f17\u5df2\u8fde\u63a5"},
      {L"status.lan_ip_applied", L"\u7f51\u5361 IP \u5df2\u5e94\u7528\uff0c\u65b0\u542c\u4f17\u8bf7\u626b\u63cf\u65b0\u4e8c\u7ef4\u7801"},
      {L"status.lan_ip_apply_failed", L"\u7f51\u5361 IP \u5e94\u7528\u5931\u8d25"},
      {L"status.latency_mode_applied", L"\u5ef6\u65f6\u6a21\u5f0f\u5df2\u5e94\u7528\uff0c\u8bf7\u624b\u673a\u91cd\u65b0\u626b\u7801"},
      {L"status.latency_mode_apply_failed", L"\u5ef6\u65f6\u6a21\u5f0f\u5e94\u7528\u5931\u8d25"},
      {L"tray.show", L"\u663e\u793a\u4e3b\u7a97\u53e3"},
      {L"tray.exit", L"\u9000\u51fa"},
      {L"room.placeholder", L"---"},
  };
  return catalog;
}

const Catalog& EnCatalog() {
  static const Catalog catalog = {
      {L"app.title", L"AudioStream Sender"},
      {L"status.ready", L"Ready, preparing room..."},
      {L"status.room_waiting", L"Room created, waiting for receivers"},
      {L"status.port_fallback",
       L"Port %d is in use; using %d instead. Use the URL or QR code below"},
      {L"status.second_instance", L"Already running, switched to existing window"},
      {L"label.room_code", L"Room code"},
      {L"label.receiver_url", L"Receiver URL"},
      {L"label.audio_status", L"Audio stream"},
      {L"label.receivers", L"Connected receivers"},
      {L"label.lan_ip", L"Sender LAN IP"},
      {L"button.apply_lan_ip", L"Apply IP"},
      {L"label.latency_mode", L"Latency mode"},
      {L"latency.mode.stable", L"Stable quality (default)"},
      {L"latency.mode.200ms", L"200ms low-latency"},
      {L"button.apply_latency_mode", L"Apply mode"},
      {L"latency.estimate.placeholder", L"Latency estimate: waiting for connection"},
      {L"latency.estimate.stable", L"Estimated latency: ~350-500ms (stable)"},
      {L"latency.estimate.200ms", L"Target latency: <=200ms (LAN P2P)"},
      {L"receivers.empty", L"No receivers yet"},
      {L"status.audio_waiting", L"Capturing system audio..."},
      {L"status.audio_ready", L"System audio ready"},
      {L"status.audio_capturing", L"Streaming audio"},
      {L"status.audio_connecting", L"Receiver connected, negotiating audio..."},
      {L"status.audio_failed", L"System audio capture failed"},
      {L"status.receivers_connected", L"%d receiver(s) connected"},
      {L"status.lan_ip_applied", L"LAN IP applied; new receivers should scan the new QR code"},
      {L"status.lan_ip_apply_failed", L"Failed to apply LAN IP"},
      {L"status.latency_mode_applied", L"Latency mode applied; rescan QR on phone"},
      {L"status.latency_mode_apply_failed", L"Failed to apply latency mode"},
      {L"tray.show", L"Show window"},
      {L"tray.exit", L"Exit"},
      {L"room.placeholder", L"---"},
  };
  return catalog;
}

}  // namespace

LocaleService& LocaleService::Instance() {
  static LocaleService instance;
  return instance;
}

void LocaleService::SetLocale(const Locale locale) {
  locale_ = locale;
}

Locale LocaleService::GetLocale() const {
  return locale_;
}

std::wstring LocaleService::Get(const wchar_t* key) const {
  const std::wstring lookup(key);
  const Catalog& catalog = (locale_ == Locale::kEnUS) ? EnCatalog() : ZhCatalog();
  const auto it = catalog.find(lookup);
  if (it != catalog.end()) {
    return it->second;
  }
  return lookup;
}

}  // namespace audiostream::i18n
