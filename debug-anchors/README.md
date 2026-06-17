# 调试锚点（研发期专用）

网站处于研发阶段、未推广。排查需求或 Bug 时，在此目录**登记**每一处临时日志/隧道锚点，便于日后**按清单移除**，避免全局搜索遗漏。

## 何时使用

| 手段 | 适用场景 |
|------|----------|
| `DebugAnchor.logAnchor(id, data)` | 单端状态快照、分支命中、计数器 |
| `DebugAnchor.sendTunnel({ anchorId, data })` | sender ↔ receiver 同步对端不可见的运行时数据 |
| 既有 `logToServer(text, tag)` | 常规信令/ICE 日志，tag 如 `ice` `network` `session` |

## 新增锚点流程

1. 在 `INDEX.md` 登记一行（ID、文件、目的、状态）
2. 复制 `_template.md` 写简要调查笔记（可选）
3. 代码中使用**统一 ID**（建议 `领域-序号`，如 `ICE-003`）：
   ```javascript
   DebugAnchor.logAnchor('ICE-003', { ice, useTURN, deviceId }, 'anchor');
   DebugAnchor.sendTunnel({ anchorId: 'ICE-003', data: { ice }, targetReceiverId });
   ```
4. 日志查询：
   - `?tag=anchor` — 全部锚点
   - `?anchor=ICE-003` — 指定锚点
   - `?room=ABCDE&tag=anchor`

## 移除流程

1. 打开 `INDEX.md`，将对应行标为 `removed` 并注明日期
2. 按「代码位置」列删除 `logAnchor` / `sendTunnel` / 注释 `// @anchor:ID`
3. 运行 `./debug-anchors/list-anchors.sh` 确认无残留
4. 若无活跃锚点，可考虑移除 `public/debug-anchor.js`、`lib/debug-tunnel.js` 及 server 中的 `debug-tunnel` 分支

## 相关文件

| 文件 | 作用 |
|------|------|
| `INDEX.md` | 锚点总表（**移除时先看此文件**） |
| `_template.md` | 单次调查笔记模板 |
| `list-anchors.sh` | 扫描代码中的锚点引用 |
| `public/debug-anchor.js` | 客户端 API |
| `lib/debug-tunnel.js` | 服务端隧道中继 |
