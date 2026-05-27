# Changelog

## Unreleased

### Deprecations (will be removed in 0.3.0 / next major)

- **`shouldEnforcePii()`** (typecheck/utils.ts, also re-exported from
  typecheck/index.ts) is now a no-op stub that always returns `true`.
  PII flow analysis is **always enabled** since ADR-0009 P0-1. New code
  must not branch on this function's return value; existing call sites
  should be removed. The function will be deleted in the next major release.
- **`BrowserTypecheckOptions.enforcePii`** and the corresponding option on
  `compileAndTypecheck` are now **ignored**. Setting `false` does NOT
  disable PII checking. The field is kept for source-level backwards
  compatibility only and will be removed in the next major release.
- **LSP `--enforce-pii` CLI flag** is now **ignored**. The LSP server
  prints a deprecation warning on stderr if the flag is passed. Will be
  removed in the next major release.

### Internal (P0-R review fixes)

- `PII_ANALYZER_FAILED` (E404) added: new dedicated error code for
  internal failures in the PII flow analyzer. Browser path now uses this
  code instead of `UNDEFINED_VARIABLE` (E101) when `checkModulePII`
  throws. Severity = error.

## [0.2.0] - 2026-05-22

### BREAKING CHANGES

- **`AnthropicProvider`** 从已弃用的 `completions` API 迁移到 `messages` API。
  Claude 3+ 模型不再支持旧 API；Claude 4.x 完全无法工作。
  对调用方意味着 `usage` 字段不再是估算值，而是 Anthropic API 返回的真实 token 计数。
- **`compile()` 成功语义收紧**：解析阶段返回任何 `severity === 'error'` 的诊断时
  `success: false`（即便部分恢复出了 AST）。先前实现仅在 `decls.length === 0` 时报失败。
  warning/info/hint 级仍透过 `parseErrors` 返回但不阻塞。
- **`DefaultCoreVisitor`** 现在对未处理的 `Core.Expression` / `Core.Statement` kind
  在运行时 throw，而不是静默忽略。子类必须覆盖或调用 super。

### 新增

- `CapabilityKind.NETWORK` / `CRYPTO` / `PROCESS` —— 用户可以声明这些 capability；
  对应 `CAPABILITY_PREFIXES` 添加 `Net./Tcp./Udp./Socket./Ws./Sse.`（Network）、
  `Crypto./Hash./Cipher./Sign./Kms./Jwt.`（Crypto）、`Process./Exec./Shell./Env./Os.`（Process）。
  Crypto 归入 CPU_CLASS（本地哈希/签名是 CPU-bound）。
- `DefaultCoreVisitor.visitExpression` 添加 `Await` 分支并对内部表达式递归遍历，
  修复 effect/capability 推断遗漏 async 内嵌调用的问题。
- `DefaultCoreVisitor` switch 末尾添加 `assertNeverExpression` / `assertNeverStatement`
  穷尽性守卫；Core IR 增加新 kind 时编译期会立即报错。
- 新 LSP API `invalidateAllDiagnosticAndTypecheckCaches()` —— locale 切换时全量清缓存
  （含 closed-document 条目）。
- 解析器恢复诊断通过 LSP `CachedDoc.parseDiagnostics` 透传给客户端。
- CLI `policy-converter` 在解析错误存在时 fail-fast，避免生成残缺 JSON。
- Anthropic provider `neutralizeTurnMarkers` 防御性中和 `(^|\n)\s*(Human|Assistant)\s*:`
  的伪造 turn 边界（覆盖 NBSP / 各类 Unicode 空白 / 大小写变体），保留散文中的字符串。

### 修复

- `CoreLowering` 现在通过 `applyTypeAnnotations` 把 `Decl.Func.retAnnotations` 应用到
  Core IR 的 ret 类型上（先前完全丢弃），并把原始注解列表存到 `CoreModel.Func.retAnnotations`。
  `@pii` 在返回类型槽上的标记会正确流到 piiLevel/piiCategories 聚合。
- `LexiconRegistry` SPI 注册路径现在调用 `validate(lexicon)`，并把校验失败计入
  `discoveryFailures`（先前未校验，损坏的外部插件会直接污染 registry）。
- `parser/decl-parser` `syncToNextDecl` 停止集提取为 `KW` 常量驱动的 `Set`，防止与
  `collectTopLevelDecls` 的入口集漂移。
- LSP locale 切换：先更新 `currentLexicon`，再清 `docCache` + 全量
  `invalidateAllDiagnosticAndTypecheckCaches()` + `rebuildWorkspaceIndex`，
  最后才 revalidate；先前 zh→en 切换会留下旧 lexicon 的 parser 缓存。

### 内部

- 累计 5 轮深度代码审查闭环；测试 1032/1034 unit + 87/87 integration 通过。
- 删除未使用的 `@AsterPii` 注解（无消费者，PII 通过 `AsterPiiValue` 运行时对象传递）。

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
