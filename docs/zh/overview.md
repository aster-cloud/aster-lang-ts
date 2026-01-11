# 文档总览

Aster CNL 是一种受控自然语言，目标是让非程序员也能读懂，同时保持类型安全。
本仓库包含 TypeScript 编译器工具链、示例与测试。

当前 CNL 风格的新变化：

- 类型推断为默认策略。示例不使用参数、字段或返回值的显式类型标注。
- 移除了运算符链式调用。使用标准函数调用（例如 `Text.concat(a, b)`）或中缀运算（例如 `a plus b`）。
- 语句以句号结尾。块头以冒号结尾，并使用 2 空格缩进。

语言版本：

- English (default): `docs/overview.md`, `docs/cnl-syntax.md`, `docs/type-inference.md`, `docs/operator-call.md`, `docs/examples.md`, `docs/contributing.md`
- 简体中文: `docs/zh/overview.md`, `docs/zh/cnl-syntax.md`, `docs/zh/type-inference.md`, `docs/zh/operator-call.md`, `docs/zh/examples.md`, `docs/zh/contributing.md`
- Deutsch: `docs/de/overview.md`, `docs/de/cnl-syntax.md`, `docs/de/type-inference.md`, `docs/de/operator-call.md`, `docs/de/examples.md`, `docs/de/contributing.md`

文档索引：

- `docs/cnl-syntax.md`: 核心语法与格式规则。
- `docs/type-inference.md`: 类型推断机制与引导方式。
- `docs/operator-call.md`: 迁移说明与替代写法。
- `docs/examples.md`: 精选示例与更多示例入口。
- `docs/contributing.md`: 贡献流程与项目规范。

推荐阅读顺序：

1. `docs/cnl-syntax.md` 了解语法与格式规则。
2. `docs/type-inference.md` 理解类型推断。
3. `docs/operator-call.md` 用于迁移旧代码。
4. `docs/examples.md` 参考完整示例。
