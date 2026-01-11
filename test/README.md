# Aster Lang 测试

> 更新时间：2025-10-22 22:04 NZST（执行者：Codex）

本目录包含 Aster 编译器的所有测试代码。

## 快速开始

```bash
npm run build
npm run test        # 运行所有测试
npm run test:unit   # 单元测试
```

## 测试架构

- `unit/` - 单元测试（58个）
- `integration/` - 集成测试（12个）
- `e2e/` - 端到端测试（91个）
- `regression/` - 回归测试（6个通过 + 4个TODO）
- `property/` - 属性测试（2个）
- `fuzz/` - 模糊测试（3个）
- `perf/` - 性能测试（2个）

**总计**：174个测试

## 详细文档

- 📖 [完整测试文档](../docs/testing.md) - 测试架构、统计和历史
- 📝 [测试贡献指南](TESTING_GUIDE.md) - 如何添加新测试
- 🎯 [Golden 测试说明](../test/cnl/examples/README.md) - E2E测试数据

## 测试金字塔目标

```
     /\
    /  \     单元测试 (目标70%)
   /____\
  /      \   集成测试 (目标20%)
 /________\
/          \ E2E测试 (目标10%)
/__________\
```

当前状态：单元33% | 集成7% | E2E52%（需增加单元测试）
