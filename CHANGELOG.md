# Changelog

## Unreleased（1.2.3）

### 修复

- 规则引用可作为函数值传递：`twice(inc, n)`、`Let g be inc`、函数类型参数调用此前在 typecheck 报
  E101、解释器报 `Undefined variable`（`List.map(xs, inc)` 也带一条 E101）。现在值位置的规则名类型为其签名的
  `FuncType`，求值得到可调用值；局部名优先于同名规则，经函数类型局部名调用时结果类型取其返回类型，参数个数按
  该局部值的函数类型校验（`Let g be inc. Return g(n, n).` 报 E032，与 Java 一致拒绝）。与 Java 引擎（TypeChecker 在模块作用域登记函数签名、truffle Loader 以 LambdaValue 入 env）一致（#256）。
- LSP 成员补全：光标位于已有成员名中间（`d.ag|e`）时，选中 `age` 不再残留后半截得到 `agee`。客户端声明
  `completionItem.insertReplaceSupport` 时字段项给 InsertReplaceEdit（insert 为点号后到光标、replace 延伸到名字
  末尾），否则 TextEdit 直接覆盖整个名字（#259）。cloud 编辑器需在 initialize 中声明 `insertReplaceSupport: true`
  才会拿到 InsertReplaceEdit。
- 名称解析的源码声明查找改为按声明表建索引：此前每次查找都线性扫描并逐项折叠整张表，解析耗时随声明数平方增长
  （2000 条规则约 1.4s，现约 0.17s）。LSP 成员补全的修补文本推断结果按文本缓存（继续输入成员前缀时复用），
  1000 行以上的文档中，未命中缓存的修补累计耗时超过 150ms 后放弃其余修补，避免大文档补全阻塞服务端；文档大小不设上限，4000 行文档
  当前行未写完时首次成员补全约 0.68s → 0.1s，结果相同（#258）。

### 新增

- 包入口 `./lsp/completion`：导出 `memberCompletions`、`parseDocumentText` 等补全 API，下游不必按相对路径引用
  dist 内部模块（#260）。

## 1.2.2

### 修复

- LSP 日志按真实级别输出：此前 Logger 的所有级别、以及 `[TypecheckCache]` 诊断日志都走 `console.error`，
  被 vscode-languageserver 重定向成 `window/logMessage` 的 Error 类型，每次类型检查都向浏览器控制台推
  多条 `[LSP Error] {"level":"INFO",...}`。现在 LSP 服务端安装日志落点，ERROR/WARN/INFO/DEBUG 分别映射到
  `connection.console` 的 error/warn/info/log（logMessage 类型 1/2/3/4），默认最小级别为 WARN，可用环境变量
  `ASTER_LOG_LEVEL`（兼容 `LOG_LEVEL`）调高；`[TypecheckCache]` 与诊断缓存命中日志降为 debug 级别并走
  Logger。CLI 与非 LSP 场景仍写 stderr，行为不变（#261）。

## 1.2.1

### 修复

- B2 文案与服务端一致：`with` 调用后缀（如 `Let x be helper with 10.`）被拒时，编辑器原报
  "Expected identifier"，现与 Java 引擎（aster-lang-core `malformedConstructField`）同报
  "Expected 'set to' in construction"；关键词按作者语言显示，只报一条（#252）。
- LSP 成员补全：`x.` 之后的字段补全不再只在「行尾 + 文档可解析」时生效。行中（点号后还有内容）、
  点号后已输入前缀（`d.a`）、zh 未完成的块头（`如果 司机.`）以及文档别处有语法错误时，都按接收者的
  声明类型列字段；字段项带 `textEdit`，替换点号之后到光标的前缀（生产复测 cloud#660 第 5 轮）。

## 1.2.0

### 新增

- 函数类型语法 `(T1, T2) -> R` 与括号类型 `(T)`，与 aster-lang-core 文法逐条对齐；参数可带
  `@pii` 注解，`?` 作用于返回类型，可空函数类型写作 `((A) -> B)?`。Core IR 新增
  `{kind: 'FuncType', params, ret}`（不带 effects），与 Java `CoreModel.FuncType` 一致（#247）。
- `Module.typeAliasDecls`：保留每条 `Type X as T.` 的目标类型与位置，与 `Module.typeAliases`
  同序同长；没有别名时省略，既有 AST JSON 不变。别名仍不进入 Core IR（#246）。
- 诊断随语言包本地化：各语言的 message / help 以语言包 overlay 为唯一来源（zh-CN、de-DE 来自
  aster-lang-locales，hi-IN 来自 aster-lang-hi），由 `pnpm run generate:diagnostic-overlays` 从 core
  导出的 lexicons.json 生成 `src/config/lexicons/diagnostic-overlays.generated.ts`，三种语言都覆盖全部
  95 个错误码。新增 `localizeDiagnostics(diagnostics, lexicon)`，已接入 `compile` 的
  `resolutionDiagnostics`、`compileAndTypecheck` 的 `typeErrors` 与 LSP 的名称解析诊断
  （aster-lang-locales#107）。
- LSP：构造字段名位置（`T with |`、`…, |`、`… and |`）补全尚未赋值的字段；按名称解析结果跳转到
  定义，覆盖大小写折叠写法、词汇本地化写法、点分路径中的字段段与枚举成员（#248）。
- `pnpm test:golden -- --update` 改写不一致的 golden 基线，缺失的基线直接新建（#248）。

### 修复

- 格式化器在默认档与 `normalize` 档下不再丢弃 `Type X as T.`。此前带词汇时引用别名处会报 E800，
  不带词汇时别名被当成隐式类型参数，函数被静默改成泛型（#246）。
- 未闭合字符串不再让 LSP pull 诊断变空，改为发布这条词法诊断（#248）。
- 类型别名的 E807 报在后出现的声明上，不再是 0:0 或先出现的 `Define`；隐式类型参数歧义的 E804
  报在签名中该名字的第一处类型写法上，不再覆盖整个函数（#248）。
- 删除内联的 zh 诊断副本（29 条 message / 78 条 help，已与 locales 漂移），de、hi 此前没有译文
  （aster-lang-locales#107）。

### 行为变化

- **Core IR**：只在函数体中出现的显式 `of T` 保留为类型参数，`typeParams` 由 `[]` 变为 `["T"]`，
  与 Java 一致；格式化器按同一规则输出 `of T`（#248）。按裁决 R54，`RESOLVER_VERSION` 不递增，仍为 1。
- **Core IR（Java 侧，core 1.0.37）**：workflow 的 `retry`、`timeout` 与 step 的 `compensate` 未设置时
  Java 引擎改为省略键，不再输出 `null`，与本包一直以来的输出一致（aster-lang-core#219）。
- 传入非 en-US lexicon 时，`compile` / `compileAndTypecheck` 与 LSP 名称解析诊断的 message / help
  输出该语言译文（此前为英文）；参数不足以填满译文模板时保留原文。zh 文案改以 aster-lang-locales 为准，
  部分措辞与 1.1.0 不同。
- 删除无效的 `scripts/update-all-core-golden.js` 与陈旧的编译产物 `scripts/{cli,emit-core,golden}.js`。

## 1.1.0

### Breaking

- The package entries (`@aster-cloud/aster-lang-ts` and `/browser`) no longer
  export `lowerModule` or the unchecked `resolveAndLower`. Use `parseSource`
  followed by `resolveAndLowerChecked(ast)`, which throws `NameResolutionError`
  on any E8xx diagnostic, or the higher-level `compile` /
  `compileAndTypecheck` / `resolvePolicyTypes`.
- The pre-parse global identifier substitution (`translateIdentifiers`,
  `IdentifierIndex.toCanonical`) is removed. Domain vocabulary is resolved by
  position after parsing (ADR 0051); there is no compatibility path.
- `Number`, `Boolean` and `String` are not type names; use `Float`, `Bool`,
  `Text`.

### Added

- **Position-aware vocabulary resolution (ADR 0051)** — R1 resolves
  declarations and type positions on the AST, R2 resolves typed references
  (dotted field paths, bare enum members under an expected enum type,
  pattern constructors, equality-comparison operands) on Core using only
  explicitly declared types. `CompileOptions.vocabulary`, `buildVocabularyScopes`,
  `canonicalScopesJson`, `foldKey` (Unicode 15.1 C+S fold, NFC-closed) and
  `resolvePolicyTypes` are exported. New diagnostics E800–E807 / W800–W801.
- Qualified enum members `E.M` type-check and evaluate.
- Toolchain constants `RESOLVER_VERSION`, `CASEFOLD_VERSION`, `CORE_IR_ABI`.
- LSP hover and field completion by resolved role.

## 1.0.3

### Added

- **Expression-level if (ADR 0019 G2b)** — `return if c then a else b`,
  `let x be if c then a else b`, nested else-if chains, and if-expressions as
  sub-expressions. New Core IR `IfExpr` node (kind="IfExpr", fields
  cond/thenE/elseE). Anchored at the `expr` top level (not in the operator
  precedence chain) to avoid dangling-else / precedence ambiguity; the else
  branch is mandatory. Dual-engine parse-parity 213/213 and eval byte-identical
  with the Java/Truffle engine (aster-lang-core#32 / aster-lang-truffle#18 /
  aster-lang-test#36). Covered across parser, lowering, interpreter, type
  checker, PII flow, JVM emitter, formatter, and LSP diagnostics.

## 1.0.1

### Added

- **Hindi (hi-IN) lexicon** — fourth locale (ADR 0017). 78 Devanagari
  keywords, danda「।」statement-end, ENGLISH whitespace mode. Generated
  from aster-lang-core's lexicon export, exported as `HI_IN` and
  registered (opt-in) via `initializeAllBundledLexicons`. Devanagari
  abugida marks are now accepted by the lexer (matches the Java engine);
  TS↔Java parse-parity verified.

## 1.0.2

### Added

- **Optional `produce` clause** (ADR 0019 G0) — `Rule greet given name:`
  may now omit the `produce <type>` clause entirely; the return type is
  inferred. This matches aster-lang-core's grammar (`(PRODUCE
  annotatedType?)?` was already fully optional) — the TS parser previously
  required `produce` unconditionally, breaking dual-engine parse-parity for
  any omit-produce source. Both `produce <type>` and bare `produce` continue
  to work unchanged. Locked by `g0-omit-produce` tier1-parity fixture
  (209 samples, parse-parity identical).

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
