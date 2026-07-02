# AudioStream_C++

Native Windows sender for AudioStream, targeting lower package size and install-and-use UX.

## Current Status

Phase 1 shell is in progress.

Implemented:

- CMake project skeleton (Win32 GUI subsystem)
- Application orchestration with message loop
- Single-instance mutex guard
- Config load/save at `%AppData%/AudioStream/config.json`
- Win32 main window (room code / URL placeholders)
- System tray icon with show/exit menu
- i18n layer with default locale `zh-CN`
- Protocol-aligned default constants

Not yet implemented:

- Room creation / QR rendering
- LAN + cloud signaling
- Audio capture (WASAPI)
- WebRTC sender (libwebrtc)

## Build (Windows)

### Prerequisites

- Visual Studio 2026 Build Tools (or VS 2022+) with **Desktop development with C++**
- CMake 3.20+ (e.g. `C:\Program Files\CMake\bin\cmake.exe`)

Example Build Tools path on this machine:

`D:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools`

### Commands

```powershell
$cmake = "C:\Program Files\CMake\bin\cmake.exe"
$vsInstance = "D:/Program Files (x86)/Microsoft Visual Studio/18/BuildTools"

& $cmake -S . -B build -G "Visual Studio 18 2026" -A x64 `
  -DCMAKE_GENERATOR_INSTANCE="$vsInstance"
& $cmake --build build --config Release
```

For Visual Studio 2022 Build Tools, use generator `Visual Studio 17 2022` and adjust `$vsInstance`.

Binary output:

- `build/Release/AudioStreamSender.exe`

## Runtime Notes

Current executable only validates startup orchestration and config defaults.
Functional media/signaling modules will be added in subsequent phases.
