#include "util/QrBitmap.h"

#include "qrcodegen.hpp"

#include <algorithm>

namespace audiostream {
namespace {

constexpr int kQuietBorderModules = 2;
constexpr COLORREF kLightColor = RGB(255, 255, 255);
constexpr COLORREF kDarkColor = RGB(17, 24, 39);

}  // namespace

HBITMAP QrBitmap::CreateFromUtf8(const std::string& text, const int displaySize) {
  if (text.empty() || displaySize <= 0) {
    return nullptr;
  }

  const qrcodegen::QrCode qr =
      qrcodegen::QrCode::encodeText(text.c_str(), qrcodegen::QrCode::Ecc::MEDIUM);
  const int modules = qr.getSize();
  const int totalModules = modules + kQuietBorderModules * 2;
  const int scale = std::max(1, displaySize / totalModules);
  const int bitmapSize = totalModules * scale;

  HDC screenDc = GetDC(nullptr);
  if (screenDc == nullptr) {
    return nullptr;
  }

  HDC memoryDc = CreateCompatibleDC(screenDc);
  HBITMAP bitmap = CreateCompatibleBitmap(screenDc, bitmapSize, bitmapSize);
  ReleaseDC(nullptr, screenDc);
  if (memoryDc == nullptr || bitmap == nullptr) {
    if (memoryDc != nullptr) {
      DeleteDC(memoryDc);
    }
    if (bitmap != nullptr) {
      DeleteObject(bitmap);
    }
    return nullptr;
  }

  HGDIOBJ oldBitmap = SelectObject(memoryDc, bitmap);
  HBRUSH lightBrush = CreateSolidBrush(kLightColor);
  RECT fullRect{0, 0, bitmapSize, bitmapSize};
  FillRect(memoryDc, &fullRect, lightBrush);
  DeleteObject(lightBrush);

  HBRUSH darkBrush = CreateSolidBrush(kDarkColor);
  for (int y = 0; y < modules; ++y) {
    for (int x = 0; x < modules; ++x) {
      if (!qr.getModule(x, y)) {
        continue;
      }
      RECT moduleRect{
          (x + kQuietBorderModules) * scale,
          (y + kQuietBorderModules) * scale,
          (x + kQuietBorderModules + 1) * scale,
          (y + kQuietBorderModules + 1) * scale,
      };
      FillRect(memoryDc, &moduleRect, darkBrush);
    }
  }
  DeleteObject(darkBrush);

  SelectObject(memoryDc, oldBitmap);
  DeleteDC(memoryDc);
  return bitmap;
}

}  // namespace audiostream
