# 单元测试 (Unit Tests)

本目录包含所有单元测试，测试单个函数/类的行为。

## 目录结构

- `lexer/` - 词法分析器单元测试
- `parser/` - 语法分析器单元测试
- `typecheck/` - 类型检查器单元测试
- `lowering/` - AST → Core 转换单元测试
- `emitter/` - 代码生成器单元测试
- `utils/` - 工具函数单元测试

## 运行测试

```bash
# 运行所有单元测试
npm run test:unit

# 运行特定模块的单元测试
npm run test:unit:typecheck
npm run test:unit:parser
```

## 编写规范

- 使用 AAA 模式（Arrange-Act-Assert）
- 每个测试独立，无共享状态
- 测试执行速度 < 10ms/test
- 无外部依赖（文件系统、网络）
