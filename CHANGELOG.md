# Changelog

## [0.1.0] - 2026-02-24

### BREAKING CHANGES

- **PEG headers 语法**：移除 `FuncHeaderLegacy`（旧 `To` 语法）、`ParamPart`（旧 `with` 参数）、legacy `Data`（旧 `Define with`）、`this module is` 回退分支。类型标注从 `:` 改为 `as`。
- **公开 API**：移除 `validateSyntax()`（零消费者）。
- **废弃符号**：移除 `NAMING_RULES` 别名、`annotationToConstraint()` 函数、3 个旧 `DiagnosticCode` 枚举成员（`DEPENDENCY_RESOLUTION_TIMEOUT`、`VERSION_CONFLICT_UNRESOLVABLE`、`PACKAGE_NOT_FOUND`）。
- **Annotation 类型**：移除已废弃的 `Annotation` 接口及 `Field`/`Parameter`/`TypeName` 上的 `annotations` 字段（使用 `Constraint` 替代）。
- **KW 常量**：移除 8 个未使用的 KW 常量（`FOR_EACH`、`IS`、`MORE_THAN`、`OVER`、`RESULT_IS`、`UNDER`、`FALSE`、`TRUE`）及对应 `KW_TO_SEMANTIC` 映射。
- **Formatter 输出**：类型标注从 `:` 改为 `as`（与解析器对齐）。

### 迁移指南

**语法变更**（Phase 1 + Phase 2a）：

| 旧语法 | 新语法 |
|--------|--------|
| `This module is X.` | `Module X.` |
| `To func with params` | `Rule func given params` |
| `Define X with fields` | `Define X has fields` |
| `name: Text` (类型标注) | `name as Text` |

**API 变更**：

- `validateSyntax()` → 使用 `compile()` + 检查 `diagnostics`
- `NAMING_RULES` → 使用 `BASE_NAMING_RULES`
- `annotationToConstraint()` → 已由解析器内置约束解析替代
- `DiagnosticCode.PACKAGE_NOT_FOUND` → `DiagnosticCode.V003_PackageNotFound`
- `DiagnosticCode.DEPENDENCY_RESOLUTION_TIMEOUT` → `DiagnosticCode.V001_DependencyResolutionTimeout`
- `DiagnosticCode.VERSION_CONFLICT_UNRESOLVABLE` → `DiagnosticCode.V002_VersionConflictUnresolvable`
- `Annotation` 接口 → 使用 `Constraint` 类型
- `Field.annotations` / `Parameter.annotations` → 使用 `.constraints`

### 新增

- `extractSchema` 测试套件（7 个用例）
- AI 训练数据重新生成（适配新语法）

### 修复

- 训练数据无效操作符语法 `>(a,b)` → `a greater than b`
- Formatter fuzz 测试路径修复 + `existsSync` 保护
- `test_loan.aster` 补充显式类型确保格式化幂等
- 全部文档/脚本/注释从旧语法迁移到新规范语法
