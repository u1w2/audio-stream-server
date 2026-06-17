# 调试锚点登记表

> 新增锚点务必在此登记；移除后改状态为 `removed` 并填日期。  
> 扫描残留：`./debug-anchors/list-anchors.sh`

| ID | 状态 | 添加日期 | 代码位置 | 目的 | 移除条件 |
|----|------|----------|----------|------|----------|
| NET-001 | removed | 2026-06-17 | sender/receiver 切网+TURN | 切网重连已稳定，2026-06-17 移除锚点与 debug-tunnel 基础设施 |

## 状态说明

- `active` — 正在用于当前问题排查
- `watch` — 保留观察，问题未完全关闭
- `removed` — 已删代码，仅留档

## 查询日志示例（服务器本机）

```
curl -s "http://127.0.0.1:30001/api/debug/logs?limit=200&tag=anchor"
curl -s "http://127.0.0.1:30001/api/debug/logs?limit=200&anchor=ICE-003&room=ABCDE"
```
