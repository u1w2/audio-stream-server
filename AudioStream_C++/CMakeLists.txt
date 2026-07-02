cmake_minimum_required(VERSION 3.20)
project(AudioStreamSender VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(WEBVIEW2_SDK "${CMAKE_CURRENT_SOURCE_DIR}/third_party/webview2_sdk/build/native")

add_executable(AudioStreamSender WIN32
  src/main.cpp
  src/app/Application.cpp
  src/app/RoomBootstrap.cpp
  src/config/Config.cpp
  src/signaling/LocalSignalingServer.cpp
  src/signaling/JsonUtil.cpp
  src/ui/MainWindow.cpp
  src/ui/TrayIcon.cpp
  src/ui/i18n/Locale.cpp
  src/util/Logger.cpp
  src/util/Paths.cpp
  src/util/SingleInstanceGuard.cpp
  src/util/StringUtil.cpp
  src/util/NetUtil.cpp
  src/util/QrBitmap.cpp
  src/webrtc/WebRtcEngine.cpp
  src/audio/WasapiLoopbackCapture.cpp
  third_party/qrcodegen/qrcodegen.cpp
  third_party/mongoose/mongoose.c
)

target_include_directories(AudioStreamSender PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/src
  ${CMAKE_CURRENT_SOURCE_DIR}/third_party/qrcodegen
  ${CMAKE_CURRENT_SOURCE_DIR}/third_party/mongoose
  ${WEBVIEW2_SDK}/include
)

target_compile_definitions(AudioStreamSender PRIVATE
  UNICODE
  _UNICODE
  WIN32_LEAN_AND_MEAN
  NOMINMAX
)

target_link_libraries(AudioStreamSender PRIVATE
  user32
  gdi32
  shell32
  comctl32
  iphlpapi
  ws2_32
  ole32
  oleaut32
  version
  shlwapi
  ${WEBVIEW2_SDK}/x64/WebView2LoaderStatic.lib
)

if(MSVC)
  target_compile_options(AudioStreamSender PRIVATE /W4 /permissive- /utf-8)
  set_source_files_properties(third_party/mongoose/mongoose.c PROPERTIES COMPILE_FLAGS "/W0")
else()
  target_compile_options(AudioStreamSender PRIVATE -Wall -Wextra -Wpedantic)
endif()

add_custom_command(TARGET AudioStreamSender POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_directory
          ${CMAKE_SOURCE_DIR}/resources/public
          $<TARGET_FILE_DIR:AudioStreamSender>/public
  COMMENT "Copying receiver web assets next to executable")
