# 集成测试 (Integration Tests)

本目录包含模块间交互的集成测试。

## 目录结构

- `lsp/` - LSP 服务集成测试
- `pipeline/` - 编译管道集成测试
- `capabilities/` - 能力系统集成测试

## 运行测试

```bash
# 运行所有集成测试
npm run test:integration

# 运行 LSP 集成测试
npm run test:integration:lsp
```
