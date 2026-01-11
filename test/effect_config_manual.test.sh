#!/bin/bash
# 手动配置测试脚本
# 测试各种配置场景

set -e

echo "=== 效果推断配置系统测试 ==="
echo

# 测试1：默认配置
echo "测试1: 默认配置（无配置文件）"
ASTER_EFFECT_CONFIG=/nonexistent.json node -e "
import { getIOPrefixes } from './dist/src/config/effect_config.js';
const prefixes = getIOPrefixes();
if (!prefixes.includes('IO.') || !prefixes.includes('Http.') || !prefixes.includes('Db.')) {
  throw new Error('默认配置测试失败');
}
console.log('✓ 默认配置正确');
"

# 测试2：完整配置
echo "测试2: 完整配置"
cat > /tmp/full-config.json << 'EOF'
{
  "patterns": {
    "io": {
      "http": ["MyHttp.", "CustomClient."],
      "sql": ["MyDb."],
      "files": ["MyFs."],
      "secrets": ["MyVault."],
      "time": ["MyClock."]
    },
    "cpu": ["MyCpu."],
    "ai": ["MyAI."]
  }
}
EOF

ASTER_EFFECT_CONFIG=/tmp/full-config.json node -e "
import { getIOPrefixes } from './dist/src/config/effect_config.js';
const prefixes = getIOPrefixes();
if (!prefixes.includes('MyHttp.') || !prefixes.includes('CustomClient.')) {
  throw new Error('完整配置测试失败: ' + JSON.stringify(prefixes));
}
console.log('✓ 完整配置正确');
"

# 测试3：部分配置（深度合并）
echo "测试3: 部分配置（深度合并）"
cat > /tmp/partial-config.json << 'EOF'
{
  "patterns": {
    "io": {
      "http": ["PartialClient."]
    }
  }
}
EOF

ASTER_EFFECT_CONFIG=/tmp/partial-config.json node -e "
import { getIOPrefixes } from './dist/src/config/effect_config.js';
const prefixes = getIOPrefixes();
if (!prefixes.includes('PartialClient.')) {
  throw new Error('部分配置测试失败：缺少 PartialClient.');
}
if (!prefixes.includes('Db.')) {
  throw new Error('部分配置测试失败：应保留默认 Db. 前缀');
}
console.log('✓ 部分配置正确合并默认值');
"

# 测试4：空配置
echo "测试4: 空配置"
echo '{}' > /tmp/empty-config.json

ASTER_EFFECT_CONFIG=/tmp/empty-config.json node -e "
import { getIOPrefixes } from './dist/src/config/effect_config.js';
const prefixes = getIOPrefixes();
if (!prefixes.includes('IO.') || !prefixes.includes('Http.')) {
  throw new Error('空配置测试失败');
}
console.log('✓ 空配置正确降级');
"

# 测试5：无效类型
echo "测试5: 无效数组类型"
cat > /tmp/invalid-type.json << 'EOF'
{
  "patterns": {
    "io": {
      "http": "InvalidString"
    }
  }
}
EOF

ASTER_EFFECT_CONFIG=/tmp/invalid-type.json node -e "
import { getIOPrefixes } from './dist/src/config/effect_config.js';
const prefixes = getIOPrefixes();
if (!prefixes.includes('IO.')) {
  throw new Error('无效类型测试失败：应降级到默认配置');
}
console.log('✓ 无效类型正确降级');
"

# 测试6：混合数组元素
echo "测试6: 混合数组元素（过滤非字符串）"
cat > /tmp/mixed-array.json << 'EOF'
{
  "patterns": {
    "io": {
      "http": ["ValidPrefix.", 123, null, "AnotherValid."]
    }
  }
}
EOF

ASTER_EFFECT_CONFIG=/tmp/mixed-array.json node -e "
import { getIOPrefixes } from './dist/src/config/effect_config.js';
const prefixes = getIOPrefixes();
if (!prefixes.includes('ValidPrefix.') || !prefixes.includes('AnotherValid.')) {
  throw new Error('混合数组测试失败：应保留有效字符串');
}
const hasNumber = prefixes.some(p => p === '123');
if (hasNumber) {
  throw new Error('混合数组测试失败：应过滤非字符串元素');
}
console.log('✓ 混合数组元素正确过滤');
"

# 测试7：格式错误的JSON
echo "测试7: 格式错误的JSON"
echo '{invalid json}' > /tmp/malformed.json

ASTER_EFFECT_CONFIG=/tmp/malformed.json node -e "
import { getIOPrefixes } from './dist/src/config/effect_config.js';
const prefixes = getIOPrefixes();
if (!prefixes.includes('IO.')) {
  throw new Error('JSON解析失败测试失败：应降级到默认配置');
}
console.log('✓ 格式错误的JSON正确降级');
"

# 清理
rm -f /tmp/full-config.json /tmp/partial-config.json /tmp/empty-config.json
rm -f /tmp/invalid-type.json /tmp/mixed-array.json /tmp/malformed.json

echo
echo "✅ 所有测试通过！"
