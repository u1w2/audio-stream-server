#pragma once

#include <string>

namespace audiostream::i18n {

enum class Locale {
  kZhCN,
  kEnUS,
};

class LocaleService {
 public:
  static LocaleService& Instance();

  void SetLocale(Locale locale);
  Locale GetLocale() const;

  std::wstring Get(const wchar_t* key) const;

 private:
  LocaleService() = default;
  Locale locale_ = Locale::kZhCN;
};

inline std::wstring Tr(const wchar_t* key) {
  return LocaleService::Instance().Get(key);
}

}  // namespace audiostream::i18n
