# AudioStream_C++ Design Plan

## 1. Product Goals

- Build a native Windows sender application with a much smaller installer than Electron.
- Keep end-user experience "install and use" with no manual setup.
- Preserve compatibility with existing AudioStream receivers and signaling protocol.
- Keep architecture modular and aligned with the existing layering principles.

## 2. Non-Goals (Phase 1)

- No macOS/Linux support.
- No advanced settings UI in the first milestone.
- No protocol redesign.
- No assembly-level optimization.

## 3. Target User Experience

1. User installs app.
2. User opens app.
3. App auto-initializes LAN mode and creates a room.
4. App shows room code + QR code immediately.
5. Receiver joins by scan or direct URL.
6. App keeps running in tray if minimized.

## 4. Architecture Layers

### UI Layer

- Main window
- Tray icon/menu
- Status and receiver list presentation

### Application Layer

- Startup orchestration
- Mode switching (LAN/Cloud)
- Session lifecycle
- Error mapping (technical -> user-facing messages)

### Service Layer

- Signaling routing
- WebRTC sender session orchestration
- mDNS broadcasting
- Audio capture control

### Data Layer

- Config persistence
- Session persistence
- Diagnostic logs

## 5. Protocol Compatibility Contract

`AudioStream_C++` must keep key constants aligned with:

- `AudioStream_x86/src/main/shared/protocol.ts`

Initial constants to mirror:

- `DEFAULT_CLOUD_SERVER = wss://www.u1w2.com`
- `DEFAULT_LOCAL_PORT = 3001`
- `HEARTBEAT_INTERVAL_MS = 300000`
- `SENDER_RECONNECT_DELAY_MS = 3000`
- same STUN/TURN entries

## 6. Phase Plan

### Phase 0 - Project Skeleton (done)

- Folder layout
- CMake build
- App/config/protocol core types
- Logging utility

### Phase 1 - Core Runtime (in progress)

- Single instance guard
- Config load/save at `%AppData%/AudioStream`
- Win32 window + tray shell
- i18n default `zh-CN`

### Phase 2 - Networking + Signaling

- Local HTTP + WebSocket signaling server
- Cloud signaling client
- Shared message router

### Phase 3 - Audio + WebRTC

- WASAPI loopback capture
- libwebrtc sender path
- bitrate/tuning parity with existing sender behavior

### Phase 4 - Packaging

- NSIS installer
- bundled runtime dependencies
- "install and use" first-run verification

## 7. Initial Directory Layout

```text
AudioStream_C++/
  CMakeLists.txt
  DESIGN.md
  README.md
  src/
    main.cpp
    app/
      Application.h
      Application.cpp
    config/
      Config.h
      Config.cpp
    protocol/
      Protocol.h
    util/
      Logger.h
      Logger.cpp
```

## 8. Engineering Rules for This Project

- Keep code/comments/docs in English.
- Keep modules focused; avoid cross-layer shortcuts.
- Keep behavior deterministic and easy to test.
- Add diagnostics for failures, but avoid noisy logs.
- Build incrementally and keep each phase runnable.

## 9. Language & i18n Policy

| Audience | Language |
|----------|----------|
| Agent ↔ developer (plans, status) | Chinese (简体中文) |
| Source code, dev docs, logs, error codes | English |
| End-user UI (default) | Chinese (`zh-CN`) via i18n resources |

- UI strings must not be hardcoded in business logic; use `ui/i18n/` (or equivalent).
- Default locale on first launch: `zh-CN`.
- Reserve structure for additional locales (e.g. `en-US`) without code changes.
- When refactoring legacy Chinese comments in code, convert to English in the same change when practical.
