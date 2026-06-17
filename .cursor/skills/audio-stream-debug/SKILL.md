---
name: audio-stream-debug
description: >-
  audio-stream 研发期线上调试：debug.log、logToServer、调试锚点登记与移除。
  在排查 WebRTC/切网/TURN/会话 Bug、加临时日志、分析公网日志时使用。
---

# audio-stream 调试技能

## 适用场景

- 用户报告 receiver/sender 无声、切网失败、TURN 异常
- 需要加临时日志锚点排查
- 问题关闭后清理调试代码

## 日志体系（常驻）

| 层级 | 机制 |
|------|------|
| 客户端 | `logToServer(text, tag)` → WebSocket `client-log` |
| 服务端 | `appendDebugLog(source, message, meta)` → `logs/debug.log` + 内存 ring |
| tag 常用 | `ice` `network` `media` `session` `version` `recover` |

### 本机查询（SSH 到服务器）

```bash
curl -s "http://127.0.0.1:30001/api/debug/logs?limit=300&room=房间码"
curl -s "http://127.0.0.1:30001/api/status"
```

公网 `https://www.u1w2.com/api/debug/*` 与 `/api/status` 已关闭，勿使用公网 URL。

**必须自行拉日志分析**，不要只靠用户口述。

## 调试锚点（研发期临时）

专用目录：`debug-anchors/`（已纳入仓库）

### 新增锚点

1. 在 `debug-anchors/INDEX.md` 登记一行（ID、文件、目的、状态 `active`）
2. 可选：复制 `_template.md` 写调查笔记
3. 代码中使用**统一 ID**（如 `NET-002`、`ICE-003`）

**轻量方式**（无需基础设施）：

```javascript
logToServer('@anchor:NET-002 ice=' + ice + ' useTURN=' + useTURN, 'anchor');
```

**完整方式**（需恢复基础设施时）：

- `public/debug-anchor.js` + `lib/debug-tunnel.js` + server `debug-tunnel` 分支
- `DebugAnchor.logAnchor(id, data)` / `DebugAnchor.sendTunnel({ anchorId, data })`
- 见 `debug-anchors/README.md`

查询锚点：`?tag=anchor` 或 `?anchor=NET-002&room=ABCDE`

### 移除锚点

1. `INDEX.md` 标 `removed` 并注明日期
2. 删代码中对应 `logAnchor` / `@anchor:ID` / `sendTunnel`
3. 运行 `./debug-anchors/list-anchors.sh` 确认无活跃残留
4. 若无活跃锚点，移除临时基础设施（`debug-anchor.js`、`debug-tunnel.js` 等）

## 排查流程

```
1. curl /api/status 确认房间码与 receiver 在线
2. curl /api/debug/logs?room=CODE&tag=network|ice|media 看最近事件
3. 对照版本 tag（sender/receiver logToServer version）
4. 必要时加锚点 → 让用户复现 → 再拉日志
5. 修复后删锚点 + 更新 INDEX.md
```

## 切网问题速查

| 日志关键词 | 含义 |
|-----------|------|
| `network-changed netType=wifi/cellular` | receiver 上报网络类型 |
| `切网蜂窝 P2P 超时，改 TURN` | 移动网走 TURN |
| `切到 WiFi，forceRebuild P2P` | WiFi 应走 P2P 重建 |
| `自动 reconnectWebRTC` | receiver 6s 未恢复自动刷新会话 |
| `relay=0 turnBroken=1` | TURN 分配失败，查 coturn/安全组 UDP |

## 勿做

- 未登记就散落 `@anchor:` / `logAnchor`
- 提交 `logs/debug.log`、`data/rooms.json`
- 问题已关闭仍留临时日志或锚点代码

## 相关文件

- `debug-anchors/README.md` — 锚点目录说明
- `debug-anchors/INDEX.md` — 锚点总表
- `debug-anchors/list-anchors.sh` — 扫描残留
- `.cursor/rules/debug-anchors.mdc` — 规则摘要
- `.cursor/rules/deployment.mdc` — 部署与日志 API
