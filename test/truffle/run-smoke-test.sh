#!/usr/bin/env bash
# Truffle 后端冒烟测试脚本
# 验证 CLI → Truffle 执行链路是否正常

set -e

echo "=== Truffle 后端冒烟测试 ==="
echo ""

# 1. 确保 TypeScript 已编译
if [ ! -f "dist/scripts/aster.js" ]; then
  echo "正在编译 TypeScript..."
  npm run build
fi

# 2. 运行最简单的测试
echo "运行基础测试 (应返回 42)..."
RESULT=$(node dist/scripts/aster.js truffle test/truffle/smoke-test.aster 2>&1 | grep -E "^[0-9]+$" | head -1)

if [ "$RESULT" = "42" ]; then
  echo "✅ 基础测试通过: 输出 = $RESULT"
else
  echo "❌ 基础测试失败: 期望 42, 实际 = $RESULT"
  exit 1
fi

echo ""
echo "=== 所有冒烟测试通过 ==="
