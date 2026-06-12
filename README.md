# Audio Stream

电脑音频 → 手机实时播放

## 使用方式

1. 电脑打开主页 → 创建房间 → 选择要共享的音频源（勾选"共享系统音频"）
2. 手机扫二维码或输入房间码 → 自动开始播放

## 技术方案

- **信令服务**：Node.js + WebSocket（仅用于交换连接信息和信令）
- **P2P 传输**：WebRTC（浏览器原生，零服务器带宽）
- **音频捕获**：浏览器 `getDisplayMedia` API
- **音频中继**：WebSocket（备用方案，仅在 P2P 无法直连时使用）
- **NAT 穿透**：STUN（`stun.l.google.com:19302` + `stun.qq.com:3478`）
- **未来计划**：TURN 服务器（coturn）用于跨网段直连

## 部署

```bash
git clone https://gitee.com/u1w2/audio-stream.git
cd audio-stream
npm install
node server.js
```

默认端口 3000，可通过 `PORT` 环境变量修改。
