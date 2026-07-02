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
      {L"receivers.empty", L"\u6682\u65e0\u542c\u4f17"},
      {L"status.audio_waiting", L"\u6b63\u5728\u6355\u83b7\u7cfb\u7edf\u97f3\u9891\u2026"},
      {L"status.audio_ready", L"\u7cfb\u7edf\u97f3\u9891\u5df2\u5c31\u7eea"},
      {L"status.audio_capturing", L"\u97f3\u9891\u6b63\u5728\u63a8\u6d41"},
      {L"status.audio_connecting", L"\u542c\u4f17\u5df2\u8fde\u63a5\uff0c\u6b63\u5728\u5efa\u7acb\u97f3\u9891\u2026"},
      {L"status.audio_failed", L"\u7cfb\u7edf\u97f3\u9891\u6355\u83b7\u5931\u8d25"},
      {L"status.receivers_connected", L"%d \u4f4d\u542c\u4f17\u5df2\u8fde\u63a5"},
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
      {L"receivers.empty", L"No receivers yet"},
      {L"status.audio_waiting", L"Capturing system audio..."},
      {L"status.audio_ready", L"System audio ready"},
      {L"status.audio_capturing", L"Streaming audio"},
      {L"status.audio_connecting", L"Receiver connected, negotiating audio..."},
      {L"status.audio_failed", L"System audio capture failed"},
      {L"status.receivers_connected", L"%d receiver(s) connected"},
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
