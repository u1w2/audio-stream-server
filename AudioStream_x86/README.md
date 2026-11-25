# AudioStream_x86 — Windows 音频发送端

AudioStream 的 Windows 原生发送端，基于 Electron 构建。无需依赖 Chrome 或 Edge 浏览器，即可在 Windows 上将系统音频以低延迟方式发送到 Android/iOS/Web 接收端。

## 功能特性

- **局域网离线模式**：在纯内网环境工作，不依赖公网服务器，通过 mDNS（Bonjour）广播服务，Android 端可自动发现。
- **公网 P2P/TURN 模式**：连接远程信令服务器，优先 P2P，失败自动回退 TURN 中继。
- **系统音频捕获**：使用 Electron `desktopCapturer` + WebRTC `getUserMedia` 捕获桌面音频。
- **托盘常驻**：最小化到系统托盘，支持开机自启、快速显示二维码、切换模式。
- **会话恢复**：崩溃或重启后自动恢复上次的房间。

## 技术栈

| 模块 | 依赖 |
|------|------|
| 桌面框架 | Electron 30 |
| 语言 | TypeScript 5 |
| 信令 | WebSocket (`ws`) |
| mDNS 广播 | `bonjour-service` |
| 二维码 | `qrcode` |
| 本地 HTTP/WebSocket | `express` + `ws` |

## 项目结构

```
AudioStream_x86/
├── assets/                    图标资源
├── build/                     TypeScript 编译输出
├── scripts/
│   └── copy-assets.js         复制 renderer HTML 到 build
├── src/
│   ├── main/                  主进程
│   │   ├── app.ts             应用主类
│   │   ├── main.ts            Electron 入口
│   │   ├── config/            配置持久化
│   │   ├── mdns/              mDNS 服务
│   │   ├── qrcode/            二维码生成
│   │   ├── shared/protocol.ts 共享协议常量
│   │   ├── signaling/         信令客户端 / 本地信令服务器
│   │   ├── tray/              托盘管理
│   │   ├── window/            窗口管理
│   │   └── preload.ts         预加载桥接
│   └── renderer/              渲染进程
│       ├── sender.html        主界面
│       ├── sender.ts          WebRTC 发送逻辑
│       ├── qr.html            二维码窗口
│       └── qr.ts
├── package.json
├── tsconfig.json              主进程编译配置
├── tsconfig.renderer.json     渲染进程编译配置
└── README.md
```

## 开发/构建

```bash
cd AudioStream_x86

# 安装依赖（跳过 Electron 二进制下载，仅做类型检查）
npm install --ignore-scripts

# 编译 TypeScript 并复制资源
npm run build

# 开发运行（需要 Electron 二进制已下载）
npm run dev

# 打包安装程序（需要 Electron 二进制已下载）
npm run dist
```

> 注意：因网络原因，Electron 二进制文件可能需要配置代理才能下载。可在 PowerShell 中设置：
> ```powershell
> $env:HTTPS_PROXY="http://127.0.0.1:7897"
> $env:HTTP_PROXY="http://127.0.0.1:7897"
> npm install
> ```

## 使用说明

1. 启动应用后，默认进入「局域网模式」。
2. 点击「创建房间」，生成 5 位房间码和二维码。
3. Android 接收端扫描该二维码或在同一 WiFi 下自动发现本机。
4. 切换到「公网模式」后，应用会连接默认服务器 `wss://www.u1w2.com`，供外部网络接收端加入。
5. 托盘右键可快速切换模式、显示二维码、复制连接地址、退出。

## 与 Android 接收端协议

- 局域网：本机启动 HTTP + WebSocket 服务器，监听 `0.0.0.0:3000`（或可用端口）。WebSocket 路径为 `/?role=receiver`。
- 公网：通过 `wss://www.u1w2.com` 与服务器建立 WebSocket，使用 JSON 文本帧交换信令。
- WebRTC SDP / ICE 候选通过信令通道转发。
- 详细消息类型见 `src/main/shared/protocol.ts`。
