#!/usr/bin/env bash
# 扫描代码中的调试锚点引用（不含 node_modules）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== debug-anchors/INDEX.md 活跃项 ==="
grep -E '^\| [A-Z0-9]+-' debug-anchors/INDEX.md 2>/dev/null | grep -v removed || true

echo ""
echo "=== 代码中的 @anchor: / logAnchor / debug-tunnel ==="
rg -n '@anchor:|logAnchor\(|debug-tunnel|debug-anchor\.js|debug-tunnel\.js' \
  --glob '!node_modules/**' \
  --glob '!debug-anchors/list-anchors.sh' \
  . || true

echo ""
echo "完成。移除锚点前请对照 INDEX.md。"
