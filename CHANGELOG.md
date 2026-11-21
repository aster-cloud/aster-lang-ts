# Changelog

## Unreleased

### 声明头与语句中间的换行与 core 同码（aster-lang-ts#357 第 3 行，ADR 0056 修订 A4 §2，Wave C 裁决 D4）

- **诊断码变化**（接受与拒绝的集合不变）：规则头里换行（`Rule` ⏎ `f …`、无逗号的 `… as Int` ⏎ `produce …`、`given` / `as` /
  `produce` 之后、形参表逗号之后）与 core 同码报在换行处——换行后同列续写此处可接受的记号报 E061，下一行缩进、空行、文件末或不可
  接受的记号报 E062。此前分别报 E055 / E056，形参表逗号之后一律报 E062。
- 语句中间的换行报 E063（`{token: token.newline}`）：`Return` / `Let` / `If` / `Match` 之后直接换行报在关键词处（此前 `Return` ⏎ 报
  E064 且位置差 6 列），`Let y be` ⏎、`Return g(` ⏎ 报在换行处（此前 E064）；实参表逗号之后换行按上面的 E061 / E062 规则。
- 共享夹具 `shared/parse_diagnostics_parity.json` 新增 15 例。

## 3.6.0

> **次版本号的理由**：公开声明只增不删——在 `v3.5.0` 与本版各自 `pnpm run build` 对比 `dist/src/**/*.d.ts` 与 `dist/scripts/**/*.d.ts`：
> 新增声明文件 `layout/package-rules.d.ts`、`layout/reconstruct.d.ts`、`policy-package/display.d.ts`、`ai/providers/load.d.ts`，无删除。
> 经 `exports` 入口可达的改动：`./layout` 新增导出 `checkPackageLayout`、`checkDerivedLayout`、`checkLayoutLimits`、`parseLayoutStrict`、
> `reconstructFromDisplay`、`padStructuralSpans`、`structuralNameHits`、`irNameStrings`、`sourceMeasures`、`layoutRuleOf`、`operatorTable`、
> `operatorSequence`、`containsWholeWord`、`ASCII_OPERATORS` 与类型 `LayoutRule`、`CheckPackageLayoutOptions`、`LayoutRuleContext`、
> `Reconstruction`，`LayoutErrorCode` 联合新增 `layout_display_mismatch`、`layout_structural_hides_operator`，`LayoutError` 与 `LayoutErrorDetail`
> 新增可选字段 `rule`（`LayoutValidation` 经 `LayoutErrorDetail` 带出）；`./token-kind`、`./lexicons` 的 `SemanticTokenKind` 新增成员 `TYPE_ALIAS`。不经任何 `exports` 子路径导出的改动：
> `policy-package/alias-validate.d.ts` 新增 `OPERATOR_KINDS`；`policy-package/manifest.d.ts` 的 `SUPPORTED_FORMAT_VERSIONS` 变为 `["1.0","1.1"]`、
> `Manifest.display?`、`validateManifestSchema` 新增可选参数 `minor`；`policy-package/errors.d.ts` 新增四个错误码与 `Stage` 成员；`argv.d.ts`
> 的 `Command` 新增 `show`；`cli.d.ts` 的 `CommandResult.stdoutBytes?`；`compile-source.d.ts` 新增 `EMPTY_SOURCE_MESSAGE`；
> `identifiers/scopes.d.ts` 新增 `literalsVisibleUnder`（`./lexicons/identifiers` 的再导出清单不含它）。`exports` 子路径不变。
> 行为上：CLI `version` 的 `formatVersions` 由 `["1.0"]` 变为 `["1.0","1.1"]`，新增子命令 `show` 与 `run --display`；既有源码新报 error 级诊断
> （裸小写类型名与歧义分隔符 E055、字符串里的原始换行 E051、规范化后为空的源码、zh 函数头旁的非词法空白），本地两边 dist 实测：
> `Rule f given x as text, produce Int:` 在 3.5.0 编译成功、本版报 E055，含原始换行的字符串在 3.5.0 编译成功、本版报 E051。
> 按 ADR 0046 §11.7 第 11 条（1.6.0、3.1.0–3.5.0 先例）取 minor。
>
> 本版是 aster-lang-test `conformance/package-v1/src/display/pending-ts-release.json` 的 `tsNext`（ADR 0059 修订 4 计划 T5）。

### 包格式 1.1：策略包携带显示排版，`show` 与 `run --display`（ADR 0059 修订 4 T3，#373，与 aster-lang-core 1.0.53 同车次）

- **新增**：`./layout` 的包规则 L1–L7（`checkPackageLayout`、`checkDerivedLayout`、`parseLayoutStrict`、`structuralNameHits`、`padStructuralSpans`、
  `irNameStrings`）与 D7 唯一解反向映射 `reconstructFromDisplay`；`LayoutError` 带规则号；新错误码 `layout_display_mismatch`、
  `layout_structural_hides_operator`。`validatePolicyLayout`（保存校验）不变。
- **新增 CLI**：子命令 `show`（`--canonical`、`--from-display <file>`，成功时 stdout 为包内文件原样字节加 `\n`）、`run --display <file>`
  （反向映射 → 派生规则 → 编译 → L8 / L9 → 求值，`meta.display` 报告是否与包一致）、`verify` 的 `display` / `display-ir` 检查、`inspect` 带出
  `display`；manifest 次版本 ≤ 1 并按次版本选 schema；`version.formatVersions` 为 `["1.0","1.1"]`；新错误码 `PKG_DISPLAY_INVALID`、
  `DISPLAY_UNMAPPABLE`、`DISPLAY_AMBIGUOUS`、`DISPLAY_REJECTED`（与 aster-lang-test `exit-codes.json` 的 `codesSince["1.1"]` 一致）。
- 1.0 包的 `inspect` / `verify` / `run` 输出逐字节不变；不支持 1.1 的旧 CLI 对 1.1 包报 `PKG_UNSUPPORTED_FORMAT`。
- `shared/layout-vectors/`：aster-lang-test 四组共享向量的逐字节副本（sha256 钉住，与 aster-lang-core `LayoutVectorsTest` 同值）。

### 类型别名引导词本地化：zh `类型`、de `Typ`、hi `प्रकार`（aster-cloud/aster-lang-ts#346，ADR 0058 修订 2）

- **新增**：lexicon kind `TYPE_ALIAS`（en `Type`、zh `类型`、de `Typ`、hi `प्रकार`）。`decl-parser` 在顶层声明句首认它与英文 `type`
  （不区分大小写，所有 locale 永久保留）为类型别名引导词。`TYPE_ALIAS` 不进按 token 的关键词翻译：字段、形参等名字位置的同形词
  （zh 字段 `类型`、de 字段 `typ`）照常是名字，Core IR 不改名。此前非英语文档只能写英文 `Type`，`类型 金额 作为 整数。` 报 E064。
  与 aster-lang-core 同名分支同一规则；共享夹具 `shared/type_alias_keyword_parity.json`（与 core 逐字节相同，12 例）。
- 带声明注解的类型别名（`@pii … Type X as T`）本引擎仍报 E056、core 接受，与引导词无关，另行跟踪（#380）。
- LSP 类型补全的别名声明引导词同样取 lexicon 的 TYPE_ALIAS（此前只认英文 `type`）。

### 字面量触发词与关键词同形时关键词优先（aster-cloud/aster-lang-ts#368，ADR 0060 修订 1 R16'）

- **修复**：规范化器只展开在当前有效词法表下不与关键词同形的字面量宏触发词。丢弃折叠键等于下列拼写的触发词：
  有效词法表（叠加 aliasSet 之后）的规范拼写、官方别名与块结束词，以及 en-US 的同类拼写。此前本引擎先展开字面量宏、
  词法之后才逐 token 翻译关键词，触发词 `文本` / `返回` 被展开成字符串（E055 / E064），而 core 先译关键词；en-US 下两引擎
  都把触发词 `Text` 展开成字符串。新增 `literalsVisibleUnder(scopes, lexicon)`（`buildVocabularyScopes` 与
  `canonicalScopesJson` 不变，envelope 不变），`canonicalize` 与 LSP 规范预览共用。共享夹具
  `shared/literal_keyword_shadow_parity.json` 与 aster-lang-core 逐字节相同。别名校验器 v2 的「别名 ≠ 字面量触发词」照旧。

### 字面量宏内容允许反斜杠、ASCII 双引号与弯引号（aster-cloud/aster-lang-ts#362 第 5 项）

- **放宽**：`validateVocabulary` 不再拒绝字面量宏内容里的 `\`、`"` 与 `“ ” ‘ ’`（ADR 0060 修订 1 R18）。展开时 `\` 与 `"`
  已按词法器转义（#345），弯引号只在充当字符串定界符时才被引号归一改写（#347），展开出的字符串里它们是内容。
  `「」『』«»`、控制字符与空内容照旧拒绝。与 aster-lang-core `IdentifierMapping.isValidLiteralContent` 同一规则，
  共享夹具 `shared/literal_value_parity.json`（与 core 逐字节相同）锁定校验结论、读回值与再规范化幂等。

### 解析分歧裁决：裸小写类型名、歧义分隔符、字符串换行、规则头换行（aster-cloud/aster-lang-ts#338、#357，ADR 0056 修订 A4）

- **收紧**：类型位置上的裸小写拉丁名字（`given x as text`、`produce foo`、`maybe int`）报 E055 `Expected type name`，报在名字上（#338 第 2 项）。
  类型名以大写开头；`list of` / `option of` / `result of` / `map … to …` / `maybe …` 的引导词与本地化关键词还原的记号不受影响。
  ADR 0051 的大小写折叠照旧适用于大写写法（`DRIVER` → `Driver`）。
- **收紧**：`X of A` 之后的分隔符（`,` / `and`）后是小写 `map`（第 4 项）或小写名字 + `of`（第 3 项，内建 list / option / result 除外）时报 E055，
  与 A3 的裸小写名字同码同文案；大写 `Map … to …` 照旧是类型参数。
- **收紧**：字符串字面量里的原始换行即未闭合，报 E051（报在开引号上，#357 第 1 行），与 core 一致；多行文本写转义 `\n`。
  `examples/alias-poem-story/tides.ballad.aster` 的换行字符串改写为 `"\n"`。
- **诊断码**：规则头逗号之后换行（`given x as Int,` 换行后写 `produce …`）报 E062（此前 E055），与 core 同码同位置（#357 第 3 行）。
- 共享夹具 `shared/parse_diagnostics_parity.json` 新增 11 例（与 core 逐字节相同）。

### zh-CN 字符串内容可含 `」`（aster-cloud/aster-lang-ts#362 第 3 项）

- **修复**：zh-CN 下 `“…”` 与 `"…"` 定界的字符串在规范化时换成词法表引号 `「…」`，内容里的 `」` 于是提前闭合字符串，
  `返回 “a」b”。`、`返回 "a」b"。` 报 E050 `'」'`，core 接受。现在这类内容含未转义 `」` 的字符串改用 ASCII `"` 定界
  （`“` `”` 写成 `"`，与 Java `normalizeQuoteDelimiters` 相同），内容不动；规范化各步的字符串分段也认 ASCII `"…"`
  （与 Java `segmentString` 的通用回退一致），内容里的全角字符、中文标点与空白照样不被改写。内容不含 `」` 的字符串照旧换成 `「」`。
  只放宽：此前报错的源码现在与 core 得到同一 Core IR。

### zh-CN 支持 `结果为`，函数头只认词法空白（aster-lang-ts#357 第 4 行、#362 第 4 项，aster-lang-locales#147）

- **新增**：zh-CN 启用翻译后变换器 `chinese-result-is`：行首与逗号之后的 `结果为 X` 改写为 `Return X`（Match 分支
  `当 1，结果为 2。` 同样可用），Core 与 `返回 X` 相同。此前 ts 报 E064，core 接受。Java 侧的效果来自关键词翻译加 core
  `result-is`，本引擎按 token 翻译，故在同样两处直接改写。`结果为` 之后的空白只认 ASCII 空格、tab 与 U+3000，不跨行；
  VT、FF 或换行（core 的 `\s` 仍接受）在本引擎报错，留待 core 侧对齐。
- **收紧**：`chinese-function-syntax`（`规则 名（参数）：`）函数头各处的空白只认 ASCII 空格、tab 与 U+3000，不跨行，与
  aster-lang-locales 的同名变换器同步收紧：`规则<U+2003>f（…）`、`f<NBSP>（`、`）<U+2003>，` 以及在关键词、名字、括号之间
  或右括号之后换行的写法此前被重排成合法函数头，现在报 E050 或语法错误。参数组照旧可跨行。
  `test/fixtures/chinese-function-syntax-parity.json` 用新的 Java 变换器重新生成（原 400 条输入加 200 条只取发生重排的随机输入）。

### W709 识别名字前的 `@pii`（aster-cloud/aster-lang-ts#336）

- **修复**：`given @pii(L1, name) name as Text` 与 `has @pii(L2, name) name as Text` 这种把 `@pii` 写在名字前的写法降级为形参 / 字段的
  `annotations`，类型仍是 `Text`，W709（`GOV_PII_RETURNED_AS_TEXT`）只看 `PiiType`，于是漏报。现在形参或字段带名为 `pii` 的注解
  （不区分大小写）同样算 `@pii` 来源，类型未标注的形参也算（注解是作者的显式声明，不是按名字猜测）。Core IR 不变，
  只会多出 W709 warning。与 aster-lang-core `PiiTextReturnAnalyzer` 同一规则。
- 共享夹具 `shared/governance_pii_text_return_parity.json` 新增 7 例（前置、前置加类型、无类型形参、大写 `@PII`、记录字段、无类型记录字段、Int 返回不报），
  与 aster-lang-core 副本 byte-identical。

### 规范化后为空的源码按空源码拒绝（aster-cloud/aster-lang-core#288）

- **收紧**：`compileSource`（`aster compile`、`./package-check` 重编译）在规范化之后再判一次空源码，与 core
  `InProcessCnlParser` 同一规则。zh-CN 只含 U+3000 的源码此前被规范化成半角空格后编译成空模块（`decls: []`），
  现在与 core、aster-api 一样报「源码为空或只含 ASCII 空白」；开头的一个 BOM 由两引擎词法器跳过，`BOM + 空白`同样按空源码拒绝。
  en-US / de-DE / hi-IN 的 U+3000 等 Unicode 空白不规范化，仍报 E050。
- 新增共享夹具 `shared/blank_source_parity.json`（22 份源码 × 4 个词法表，与 aster-lang-core 副本 byte-identical）。

### `npm i --omit=optional` 后 `aster` 可用（aster-cloud/aster-lang-ts#364）

- **修复**：`openai` 与 `@anthropic-ai/sdk` 是 optionalDependencies，但 `aster` 经 `ai-generate` 静态 import 了两个 provider，
  `--omit=optional` 安装后任何 `aster` 命令一启动就 `ERR_MODULE_NOT_FOUND: Cannot find package 'openai'`。现在 provider 在
  `ai-generate` 选中时才动态加载；缺 SDK 时报「未安装可选依赖 openai……请先安装：npm i openai」并以非零退出，其余命令不受影响。
- `scripts/verify-package-bins.mjs` 新增第 6 步：`npm i --omit=optional <tarball>` 后确认可选依赖确实未装、全部 bin 检查照样通过，
  `aster ai-generate` 两个 provider 都给出安装提示。

## 3.5.0

> **次版本号的理由**：公开声明只增不删——在 `v3.4.0` 与本版各自 `pnpm run build` 对比 `dist/src/**/*.d.ts`：新增声明文件
> `policy-package/alias-identifier-guard.d.ts`，无删除；经 `exports` 入口可达的改动只有 `./browser` 的 `CompileOptions`
> 新增可选字段 `astGuard`（解析后、名称解析前的 AST 检查钩子）。`diagnostics/error_codes.d.ts` 的 `ErrorCode` 新增
> `ALIAS_IDENTIFIER_COLLISION = "E808"`；`policy-package/alias-validate.d.ts` 新增 `isZhLocale`、`isHanSingleToken`、
> `MIN_HAN_SINGLE_TOKEN` / `MAX_HAN_SINGLE_TOKEN` 与 `ValidateAliasSetOptions.locale`，`USER_ALIAS_VALIDATOR_VERSION` 由 `'1'`
> 变为 `'2'`（这两个模块不经任何 `exports` 子路径导出）。`exports` 子路径不变。更关键的是行为：E808 是新的 error 级诊断，
> 等于字面量宏触发词的别名此前通过校验、现在失败，属于既有输入新拒绝，按 ADR 0046 §11.7 第 11 条（1.6.0、3.1.0–3.4.0 先例）取 minor。

### 别名校验器 v2 与别名名字守卫 E808（ADR 0060 §5，wontlost-ltd/aster-cloud#830，与 aster-lang-core 同车次）

- **汉字单词别名**：locale 主子标签为 `zh`、每个码点在 U+4E00–U+9FFF 或 U+3400–U+4DBF、长 2–8 个码点的单词别名放行
  （`isHanSingleToken`）；拉丁、假名、谚文、扩展 B 等单词别名仍报「必须是多词短语，或 zh 下 2–8 个汉字的单词」。
  `ValidateAliasSetOptions` 新增 `locale`（缺省视为非 zh），`compileSource` 传入编译 locale。
- **`FUNC_PRODUCE` 入结构词档**：需 `allowStructural`，与 `FUNC_TO` 同类。
- **收紧**：别名不得等于有效词汇中的字面量宏触发词（含其同义写法），此前不检查。
- **别名名字守卫（E808 `ALIAS_IDENTIFIER_COLLISION`，新码）**：aliasSet 含汉字单词别名时，`compileSource` 在解析后、
  名称解析前检查 AST 名字，任一名字折叠后等于该别名或被别名化 kind 的英文拼写即失败；解析失败时，若把第一条错误所在行
  的某处汉字单词别名换成普通名字即可通过语法分析，同样报 E808（与 core 同一算法）。`compile()` 新增内部选项 `astGuard`（解析后、名称解析前的 AST 检查钩子）。
- `USER_ALIAS_VALIDATOR_VERSION` 由 `'1'` 升到 `'2'`。
- 共享夹具 `shared/alias_validation_v2_parity.json`（与 aster-lang-core 副本 byte-identical）；《静夜思》原诗经 `compileSource`
  编译、求值得 `静夜思`，Core IR 投影哈希与 core 相同（`jingyesi-policy.test.ts`）。

## 3.4.0

> **次版本号的理由**：包的公开导出不变——在 `v3.3.0` 与本版各自 `pnpm run build` 对比 `dist/src/**/*.d.ts`：没有新增或删除的
> 声明文件；只有 2 个文件有改动，且都不经任何 `exports` 入口可达：`frontend/canonicalizer.d.ts` 新增 `literalMacroLiteral`
> （包入口只再导出 `canonicalize` 与 `CanonicalizerOptions`），`lsp/canonicalize-options.d.ts` 的 `TenantCanonicalizeOptions.lexicon`
> 由 `Lexicon` 放宽为 `Lexicon | undefined`（`./lsp` 系列入口不导出该模块）。`exports` 子路径不变。但 #347 的引号裁决让既有源码
> 出现新的 error 级诊断（`"abc”` 此前当作闭合的字符串，现在报未闭合字符串；在 3.3.0 上可编译），写不成字面量的宏值由原样拼接
> 改为抛错，含 `‘ ’` 的字符串字面量的 Core IR 值也随之变化，不是补丁级变化，按 ADR 0046 §11.7 第 11 条（1.6.0、3.1.0、3.2.0、
> 3.3.0 先例）取 minor。CLI / LSP 依赖改回 `dependencies` 只影响安装内容，库入口的模块图不变。

### en-US 文档应用租户领域词汇（aster-cloud/aster-lang-ts#365）

- **修复**：LSP 中 en-US 以 lexicon `undefined` 表示（「无 lexicon 即内置英文」），`buildCanonicalizeOptions` 却把
  `undefined` 当作缺参数直接返回，(tenant, domain, en-US) 的词汇从未被查询。于是 en-US 文档的 `aster/canonicalPreview`
  返回 `mappings: []`，词汇术语补全、经词汇的成员补全、悬停 `written → canonical` 与按词汇的名称解析诊断全部缺失；其它
  locale 正常。现在 lexicon 为 `undefined` 时按 `en-US` 查词汇，canonicalize 以 `{ lexicon: undefined, vocabulary }`
  调用（与 `compile()` 的 compile-pipeline 同形）。
- **不变**：传给 lex / parse 的 lexicon 仍为 `undefined`；没有租户上下文、或租户在该领域没有 en-US 词汇时，en-US 文档的
  规范化文本、token、AST 与诊断与此前逐字节相同。`compile()` / CLI / browser 入口不经此路径，不受影响。

### `aster` / `aster-lsp` 在 plain install 后可直接运行（CLI/LSP 依赖改回 `dependencies`）

- **修复**：3.3.0 及更早把 `cac`、`ora`、`p-limit`、`tar`、`vscode-languageserver`、`vscode-languageserver-textdocument`、
  `vscode-languageserver-types` 声明为 optional `peerDependencies`（P0-R19），npm / pnpm 都不安装 optional peer。于是
  `npm i @aster-cloud/aster-lang-ts && npx aster --help`、`npm i -g` 之后的 `aster`、`npx -p @aster-cloud/aster-lang-ts aster …`
  启动即 `ERR_MODULE_NOT_FOUND: Cannot find package 'cac'`，`aster-lsp` 缺 `vscode-languageserver`（ADR 0059 导出包与文档依赖的
  Node CLI 不可用；单文件 `dist/runner/aster.mjs` 不受影响）。这 7 个包现为常规 `dependencies`。
- **库消费者不受影响**：除 `./lsp` 系列外，所有 `exports` 入口（`.`、`./browser`、`./core`、`./cli`、`./package-check` 等）的
  模块图都不含这些包，打包器（wrangler/esbuild 等）按 import 图取模块，Workers bundle 体积不变；变化只在安装体积——
  plain install 的 `node_modules` 从约 49.1 MB 增至 55.8 MB（+6.5 MB、+31 个包，其中 `tar` 约 2.9 MB）。
- **新门禁** `scripts/verify-package-bins.mjs`（CI package-v1 job）：tarball 装进空目录，不借本仓依赖，跑 `aster --help` /
  `aster version` / `aster verify`（一致性夹具 a-decimal）、`aster-core`、`aster-convert --help`、`aster-lsp --stdio`
  initialize，以及 `npm i -g` 与 `npx -p <tarball> aster --help`；并断言库 `exports` 每个条件分支的模块图不含 CLI/LSP 依赖。
  保证范围是默认安装：`npm i --omit=optional` 下 `aster` 仍因静态 import 的 `openai` / `@anthropic-ai/sdk`（optionalDependencies）失败，另案跟进。
  `dist/runner/aster.mjs` 与内置信任锚（kid `export-2026-11a`）不变。

### 字符串字面量内容原样保留、字面量宏值转义后展开（aster-cloud/aster-lang-ts#347、#345，与 aster-lang-core 同车次）

- **引号归一只改写定界符（#347）**：此前规范化整段替换 `“ ” ‘ ’`，字符串字面量里的弯引号也被改写。现在：
  - `"…"` 只由 `"` 闭合、词法表引号对（zh-CN「」）只由其闭引号闭合，内容里的 `“ ” ‘ ’` 与（zh-CN）ASCII `"` 原样保留；
  - `“…”` 仍是字符串定界符（由 `”` `"` `“` 任一闭合，此前能闭合的写法仍闭合），定界符换成词法表引号，内容不动；
  - 字符串之外的弯引号照旧改写。
  **行为变化**：含 `‘` `’` 的字符串字面量（如 `"it’s"`）的值不再被改成 ASCII `'`（Core IR 字符串值变化）；
  `"…“…”…"` 此前被截断成多段（报错，或恰好拼成 `"a " + x + " b"` 这样的表达式），现在是一个字符串；
  `"abc”` 此前当作闭合的字符串，现在 `”` 是内容、字符串未闭合（E051）；zh-CN `「…"…」` 此前把内容里的 `"` 交替改成「」，现在原样保留。
- **字面量宏值转义后展开（#345）**：宏值里的 `\` 与 `"` 转义成 `\\` 与 `\"` 后包进词法表引号，读回的正是宏值本身。此前原样拼接，
  值 `C:\new` 编译成 `C:` + 换行 + `ew`、含 `"` 的值把字符串提前闭合。展开写法（canonicalizer 模块内的 `literalMacroLiteral`，包入口不导出）由 LSP 规范预览（ADR 0058 §8.2）
  与编译器共用，此类宏值的预览不再失败闭锁。写不成字面量的宏值（空、控制字符、`「」『』«»`、当前词法表的非 ASCII 引号）改为抛错，
  与 aster-lang-core `Canonicalizer` 一致（此前原样拼接）；`validateVocabulary` 本就拒绝这些值，注册中心路径不受影响。
- 共享夹具 `shared/parse_diagnostics_parity.json` 新增 7 条用例（含 aster-lang-locales#143 的 zh `令…定义为` 空白），
  与 aster-lang-core 副本 byte-identical。

## 3.3.0

> **次版本号的理由**：包的公开声明只增不删、无签名收窄——在 `v3.2.0` 与本版各自 `pnpm run build` 对比 `dist/src/**/*.d.ts`：
> 没有删除的声明文件；9 个已有文件有改动，全部是新增或等价改写：`ErrorCode` 新增 E730–E735、E737–E739，`ErrorCategory` 增加
> `'export'`（同 `'governance'` 的先例，只加不减），`evaluate` 的 `options` 由内联 `{ maxSteps? }` 改为同形且多一个可选字段的
> `EvaluateOptions`，`EvalResult` 新增可选 `errorKind` / `steps`，新增 `ResourceExhaustedError`（继承 `InterpreterError`）、
> `BUILTIN_ARITY`、`identifierTokenRegex`、`literalMacroRuns`、AST `Field.annotations?`，`read-core-ir` 的三个导出改为从
> `read-core-ir-base` 再导出（名字与类型不变）；另有 38 个新声明文件，`exports` 新增子路径 `./layout`、`./runner`、`./package-check`，
> 已有子路径不变。但 ts#334 与 ts#348 的语法裁决（`X of A` 分隔符后的裸小写名字报 E055、行尾 / 标点前 / 空白行里的非 ASCII
> 空白报 E050）让部分既有源码出现新的 error 级诊断，不是补丁级变化，按 ADR 0046 §11.7 第 11 条（1.6.0、3.1.0、3.2.0 先例）
> 取 minor。ts#348 让 zh-CN / hi-IN 标点前空格之后的 `origin.*.col` 与 core 对齐，不改 IR 形状，也不进投影哈希。

### 包格式 v1：内置信任锚改为生产导出公钥（ADR 0059 P2 T25，§6.2「先发布锚，再签名」）

- `src/policy-package/trust/export-jwks.json` 由空 `{"keys":[]}` 改为平台导出密钥 `export-2026-11a`（Ed25519）的公钥，
  与 aster-lang-truffle `cli` 的内置锚逐字节相同（规范 JSON，SHA-256 `7e24a913…10a4f7`）。不带 `--jwks` / `--pubkey` 时，
  平台签名的包直接验签通过；`aster version` 的 `trustAnchorKids` 由 `[]` 变为 `["export-2026-11a"]`。
- 测试密钥（kid 以 `test-` 开头）仍只能经 `--jwks` / `--pubkey` 注入，测试断言内置锚中不得出现。

### `./package-check` 子路径与导出 builtin 白名单（ADR 0059 P2 T22 / T23，修订 3 P2-R5 / P2-R7 / P2-R13）

- **新子路径 `@aster-cloud/aster-lang-ts/package-check`**（Workers 可用：依赖闭包不引用 Node 内置模块，运行时不生成代码）：
  - `TS_VERSION`：本包版本（构建时由 `scripts/stamp-ts-version.mjs` 写入 dist；从源码直接运行时为占位值 `0.0.0-unstamped`）；
  - `compileSourcePositionFreeSha256(source, { locale, aliasSetJson, allowStructural, vocabularyJson? })`：与 CLI 对 B 包的本地编译同一路径，
    返回修订 1 A2 的投影哈希；编译失败抛 `CompileFailure`；
  - `checkProbes(coreJson, probesJson, { maxSteps, maxCallDepth, deadlineMs })`：与 `verify --probes` 同一读入、输入转换、求值与比较规则，
    返回 `{ count, agreed, firstMismatch }`；超步数、调用深度超限、JS 栈溢出、输入 / 入口不合法、超过 `deadlineMs` 都计为不一致；
    Core IR 用预编译的 schema 校验函数严格读入（`readCoreIrPrecompiled`，与 `readCoreIr` 结果相同），读入失败抛 `CoreIrFormatError`；
    必填 `maxTotalSteps`（合计步数预算，正的安全整数，不接受 Infinity；Workers 同步执行期间时钟不推进，这是那里唯一能约束总耗时的上限）与
    `entries`（manifest 的可运行入口，与 CLI 一样校验探针入口），可选 `now`（注入时钟）；
  - `EXPORT_BUILTINS`：ts 引擎的导出 builtin 白名单。
- **新文件 `src/policy-package/export-builtins.json`**（P1 T10 的 ts 一半，与 truffle `aster/truffle/export-builtins.json` 同形）：
  `BUILTIN_ARITY` 键 ∪ `BUILTIN_OPS` ∪ `NAMED_BUILTIN_OPS` 中值非 null 的键（排除 `await`），`aliases` = `CALL_TARGET_BUILTIN_ALIASES`；
  由 `scripts/generate-export-builtins.ts` 生成，测试锁定与 truffle 白名单的差集（只有 `PII.unwrap`、`Text.redact`、`await` 是 JVM 独有）。
- **行为变化**：解释器超过 `maxSteps` 时改抛 `ResourceExhaustedError`，`evaluate` 的结果多出 `errorKind: 'resource'`（message 不变）。
  包格式 CLI 的步数不设限，不受影响；浏览器 / cloud 调用方的 `success` 与 `error` 不变。`EvalResult` 另增可选字段 `steps`（本次执行的步数）。
- 内部重构（公开导出不变）：`read-core-ir.ts` 拆出不依赖 ajv 的 `read-core-ir-base.ts`；`obtain-ir.ts` 的源码编译与投影哈希移到
  `compile-source.ts`（原路径再导出）；`probeMatches` 移到 `probe-match.ts`（`cli.ts` 再导出）；`evaluatePackage` 与 `checkProbes` 共用 `evaluateIr`。
- `scripts/generate-core-ir-types.ts` 另生成 `src/core/core-ir-v2.validator.generated.ts`（ajv standalone，约 350 KB，只被 `./package-check` 引用）。

### 策略包导出码 E730–E735、E737–E739（ADR 0059 修订 3 P2-R5 / P2-R6，与 aster-lang-core 同车次）

- `shared/error_codes.json` 新增 9 个 `EXPORT_*` 码（新类别 `export`，恒为 error，E736 保留不启用）：E730 IO 能力、E731 workflow / Async / Await、
  E732 名字不在闭世界、E733 入口类型无 JSON 形式、E734 包超限、E735 Node 探针不一致、E737 入口被 `main` 遮蔽、
  E738 入口类型含 DateTime / PII、E739 Node 重编译漂移。英文 message 与 aster-api `ExportDiagnosticCode` 模板逐字相同。
- `ErrorCategory` 联合类型增加 `'export'`（只加不减；对 `ErrorCategory` 做穷举 `switch` 的调用方需补一个分支）。
- `src/diagnostics/error_codes.ts`、`docs/error-codes.md` 与 `diagnostic-overlays.generated.ts`（zh-CN / de-DE / hi-IN 译文）同步。

### 词法空白只认 ASCII，与 aster-lang-core 对齐（aster-cloud/aster-lang-ts#348）

- **破坏性（此前接受的源码改为报错）**：规范化阶段「去行尾空白」「去标点前空白」改用 Java `\s` 的 ASCII 集合 `[ \t\n\x0B\f\r]`，
  「清空只含空白的行」「整行注释」改为只认空格与 `\t`。U+00A0、U+2000–U+200A、U+202F、U+205F、U+1680、U+2028/2029、
  非开头的 U+FEFF，以及 zh-CN 以外词法表里的 U+3000，出现在行尾、只含它们的行、`.` `,` `:` 等标点之前、整行注释之前或
  只含它们的源码里时，不再被吞掉，而是与 core 一样在该字符上报 **E050**（此前 ts / 编辑器 / LSP 接受、生产 aster-api 报 E050）。
  token 之间与缩进里的这些字符两引擎此前已一致报 E050，不变；zh-CN 的 U+3000 仍由全角转半角换成空格，照常是空白；
  字符串字面量与注释正文里的任何空白照旧原样保留。
- 标点前去空白的标点集合与 core 一致、不再分词法表（`.,:` 与 `。：，`，句末档另加 `;?!` 与 `！；？`，再加词法表的非 ASCII
  句末符如 `।`）：zh-CN / hi-IN 里句末符、逗号、冒号前的 `\x0B` `\f` 此前报 E050、core 接受，现在照常去掉；
  zh-CN / hi-IN 标点前的普通空格同样去掉，该位置之后 token 的列号与 core 一致（Core IR `origin.*.col` 可能因此变化）。
- 只含空白的行改为只在字符串字面量之外清空，行界按 Java 的行终止符（`\n` `\r` U+0085 U+2028 U+2029）判定：
  此前字符串里两个 U+2028 之间的空格会被删掉（静默改变字符串值），core 保留。
- 共享夹具 `shared/parse_diagnostics_parity.json` 新增 12 条用例（与 aster-lang-core 副本 byte-identical）；
  aster-lang-test 的 `compile/source-only-nbsp-is-not-blank`、`compile/source-only-ideographic-space-is-not-blank`
  去掉 `knownEngineDivergence`，两个 CLI 期望相同。

### 包格式 v1：首个 `--jwks` URL 的字符级校验（ADR 0059 P1 终审 V-1，aster-cloud/aster-cloud#797）

- 首个 `--jwks <https-url>` 与重定向 `Location` 同一字符级 URI-reference 校验（裸空格、反斜杠、控制字符、未编码的非 ASCII、非法 `%XX` 都不合法），
  再做请求目标检查；非方括号 host 中另不得含 `:`。任一不满足在发出任何请求之前即 `USAGE`（此前 `https://h/é`、`/%zz`、`/\x` 会原样发出）。

### 包格式 v1：重定向目标的发送前检查（ADR 0059 P1 T8 评审 N-1，aster-cloud/aster-cloud#797）

- `--jwks <https-url>` 的首个 URL 与每个解析后的重定向目标在发请求之前检查（`checkRequestTarget`，与参照实现 `validateRequestTarget` 同一判定）：
  host 非空；端口若出现必须是 1–5 位十进制且在 1–65535 内（空端口同样拒绝）；不得带 userinfo；`[` / `]` 只能作为 IP-literal host 的边界，
  出现在普通 host、路径、查询或片段中即拒绝。任一不满足为 `USAGE`，不发请求。

### 包格式 v1：重定向 Location 的 RFC 3986 规则（ADR 0059 P1 T8 评审，aster-cloud/aster-cloud#797）

- `--jwks <https-url>` 跟随重定向时，`Location` 原文必须是 RFC 3986 的 URI-reference（空、空格、反斜杠、控制字符、未编码的非 ASCII 都为 `USAGE`），
  校验通过后才按 §5.2（含 §5.2.4 remove_dot_segments）相对当前请求 URL 解析——自行实现，不用 `new URL()`（它会静默修补这些字符，且对 `https:x` 之类按 WHATWG 规则处理）；重定向目标的 scheme 不区分大小写（`HTTPS://` 照常跟随）。

### 包格式 v1：求值前看门狗报 RESOURCE_EXHAUSTED（#350 评审 N2，aster-cloud/aster-cloud#797）

- 60 s 求值前安全看门狗到点时改报 `RESOURCE_EXHAUSTED`（退出码 5，资源类结果，不在逐字节一致的承诺内；JVM 同码）。
  Worker 在开始求值前崩溃仍按原有的码报告。

### 包格式 v1：#349 评审跟进（aster-cloud/aster-cloud#797）

- https 信任锚的 TLS 信任根改为 Node 缺省 CA（内置根 + `NODE_EXTRA_CA_CERTS`）+ 操作系统信任库，`ASTER_ANCHOR_CA_FILE` 在其上追加、去重；
  此前缺省情形不含系统 CA，设了 `ASTER_ANCHOR_CA_FILE` 时又会丢掉 `NODE_EXTRA_CA_CERTS`。
- 求值开始前（Worker 启动、IR 读入、实参转换，不计入 `--timeout`）加 60 s 安全看门狗，进程不挂住（到点的错误码见上条）。
- `compile` 的空白源码判定移入 `compileSource`，源码形态与包形态（以及 B 包本地重编译）同一判定。
- README：说明未计时阶段的上界与 `--out` 在 SIGKILL 下可能残留的临时文件；一致性运行器给 TIMEOUT 用例加 ≥ 0.9 s 的下界。

### 包格式 v1：按 aster-lang-test#218 收紧 CLI 规则（ADR 0059 P1，aster-cloud/aster-cloud#797）

- 命令行：`--` 结束选项解析；`--opt=` 与单独给出的空值（`--entry ""`）为 `USAGE`；`--opt --` 视为缺值。
- 读包：目录形态与 zip 的条目数上限 1 024（目录计入子目录、不含包根），目录嵌套深度上限 32；目录按名字的 UTF-8 字节序遍历，
  子目录先判深度再计数、普通文件先计数再判大小；zip 在找到 EOCD 后、解析中央目录之前判条目数。
- 信任锚：`--jwks <https-url>` 只接受字面量小写 `https://`，一律直连（忽略全部代理环境变量），只跟随 301/302/303/307/308 且至多 3 次
  https → https，请求 `Accept-Encoding: identity`、拒绝其他 `Content-Encoding`，只认 2xx，响应体 ≤ 1 MiB，全部跳合计 10 s；
  `ASTER_ANCHOR_CA_FILE`（仅测试）追加到缺省 CA；本地 `--jwks` / `--pubkey` 文件 ≤ 1 MiB。任何失败为 `USAGE`。
- `compile`：位置参数以 `.aster` 结尾即源码形态（不存在、是目录为 `USAGE`）；源码按严格 UTF-8 解码并去掉至多一个 BOM（非法为 `USAGE`），
  只含 ASCII 空白为 `COMPILE_ERROR`；`--locale` 只接受 en-US / zh-CN / de-DE / hi-IN；`--allow-structural` 只能与 `--alias-set` 同用；
  aliasSet / 词汇文件不是严格 JSON 为 `USAGE`，aliasSet 形状不对或未知 kind 为 `COMPILE_ERROR`，`null` 即无别名；`--out` 的父目录与
  目标在编译之前判定（父目录不存在 / 不可写、目标是目录为 `USAGE`），成功时同目录临时文件写完再改名，失败不留任何文件。
  包内 `policy/policy.aster` 同样去掉开头 BOM。
- 超时计时起点改为 Worker 内 IR 已读入、实参已转换之后、调用 `evaluate` 之前。
- 一致性测试：新增 `compile/cases.json` 与 `https-jwks-*`、条目数 / 深度等运行时夹具；`KNOWN_RED` 删除。夹具标 `knownEngineDivergence`
  的两行（只含 U+00A0 / U+3000 的源码，aster-cloud/aster-lang-ts#348）在 ts 上按 todo 运行。

### 许可证声明与 LICENSE 文件一致

- `package.json` 的 `license` 由 `MIT` 改为 `Apache-2.0`，浏览器包头注释同步修改。仓库 LICENSE 文件一直是 Apache License 2.0，此前的 `MIT` 声明有误；以 LICENSE 为准（产品负责人确认）。ADR 0059 的 P3（自包含导出打包运行时）以许可证一致为前提。

### 包格式 v1：单文件 runner `dist/runner/aster.mjs`（ADR 0059 P1 T5，aster-cloud/aster-cloud#797）

- `pnpm run build` 末尾用 esbuild 打出 `dist/runner/aster.mjs`（ESM、minify、只 import Node 内置模块，约 0.64 MiB）与
  `dist/runner/aster.mjs.sha256`；同一文件既是 CLI 主线程又是求值 Worker（`new Worker(new URL(import.meta.url))`）。
  体积预算 1 MiB（修订 1 A3），超出即构建失败，CI `package-v1` job 另有显式体积门。
- 新导出 `@aster-cloud/aster-lang-ts/runner`；发布 workflow 把 `aster.mjs` 与 `aster.mjs.sha256` 上传为 GitHub Release 资产并下载回读校验。
- `test/package-v1/runner-bundle.test.ts`：把 bundle 拷到仓外临时目录重跑全部一致性用例。README 新增「Running exported policy packages」。

### 包格式 v1：`aster` 的 compile / run / verify / inspect / version（ADR 0059 P1 T4，aster-cloud/aster-cloud#797）

- `aster run <pkg> --input <file|-> [--entry] [--timeout] [--jwks|--pubkey] [--allow-unsigned]`、`aster verify <pkg> [--recompile] [--probes]`、
  `aster inspect <pkg>`、`aster compile <pkg|file.aster> [--out] [--locale] [--alias-set] [--vocabulary] [--allow-structural]`、`aster version`：
  stdout 恒为一行值规范 JSON（`run` / `inspect` 失败与 `USAGE` 输出错误信封，`verify` 输出检查项），诊断只写 stderr，退出码 0–5 见
  aster-lang-test `conformance/package-v1/exit-codes.json`。这五个子命令绕过 cac，用严格语法解析（重复 / 未知选项、缺值都是 `USAGE`）；
  未知子命令同样报 `USAGE` 信封。
- 求值在 `worker_threads` Worker 中进行（`resourceLimits.stackSizeMb = 32`，`maxCallDepth = 10 000`），`--timeout`（缺省 5 s，≤ 300 s）
  到点 `terminate()` 并报 `TIMEOUT`；深递归报 `RESOURCE_EXHAUSTED`。`verify --probes` 每条按 `--timeout` 计时，结果不符报 `PROBE_MISMATCH`。
- `jvm` / `class` / `jar` / `truffle` / `parse` / `core` 的帮助说明加 `[dev]` 前缀。
- 新 CI job `package-v1`：dist CLI 跑 `conformance/package-v1/` 全部用例（`pnpm run test:package-v1`，已并入 `pnpm test`）。

### 包格式 v1：读包、完整性、签名、取 IR、输入与求值（ADR 0059 P1 T2 + T3，aster-cloud/aster-cloud#797）

- 新目录 `src/policy-package/`（与既有 `src/package/` 依赖管理器无关），按 aster-lang-test `conformance/package-v1/README.md`
  的检查顺序实现 read → manifest → signature → integrity → ir → entry → input → eval 各阶段，错误码、退出码与固定 message
  取自同目录 `exit-codes.json`（`errors.ts`，兄弟仓 parity 测试守住）。
- 读包：目录与 zip 按文件类型区分（与扩展名无关），目录内符号链接、单文件 / 累计 > 64 MiB 即失败；zip 同时解析中央目录与本地头并
  要求一致，`node:zlib` 以「声明大小 + 1」为上限解压，deflate 流之后的多余字节、CRC 不符、ZIP64、加密、非唯一根目录都报 `PKG_INTEGRITY`。
- manifest：严格 JSON（无 BOM / 重复键 / 孤立代理项，深度 ≤ 64）→ 文件字节等于规范 JSON → `format` / `formatVersion`（先于 schema）
  → schema（`manifest-1.0.schema.json` 逐字节副本，ajv 2020 strict）→ 语义规则 → `coreIr.version`。
- 签名：`manifest.sig.json` 严格 JSON + schema + 规范 base64url，内置锚 `trust/export-jwks.json`（P1 为空）或 `--jwks` / `--pubkey`
  （原始公钥不看 kid，单个 JWK 带 kid 时必须相符），`node:crypto` Ed25519 验签。
- 取 IR：A 包严格读入 `compiled/core.json`（`PKG_UNSUPPORTED_IR`）；B 包按 manifest 本地编译并比对 `coreIr.positionFreeSha256`
  （去掉 `origin.*.col`，修订 1 A2），不等或编译失败为 `PKG_IR_DRIFT`。aliasSet 按 aster-api `AliasOverlayLexicon` 的**合并**语义叠加，
  并先过新移植的 `validateAliasSet`（aster-api `UserAliasValidator` VERSION 1 的全部规则）。
- 输入：键恰为形参名，Int 为 int32、Long 为安全整数或 int64 字符串、Decimal 为 ≤ 80 位数字的字符串等（修订 2 R7）。
- 值规范 JSON（`value-json.ts`）：键按码点升序、整数精确、Double 按 ECMAScript 写法、Decimal 普通写法、Enum 去掉 `"__type":"?"`、
  嵌套 ≤ 64 层（修订 1 A1、修订 2 R9）。
- 解释器：`evaluate` 选项新增 `maxCallDepth`（缺省仍为 50，浏览器 / cloud 行为不变）；新增导出 `ResourceExhaustedError`，调用深度超限
  与 JS 栈溢出在 `EvalResult` 中标为 `errorKind: 'resource'`。

### 双引擎 parity：#328 之后余下的七处解析分歧（aster-lang-ts#334，ADR 0056 修订 A3，与 aster-lang-core 同车次）

- **字段前置注解**：`Define C has @pii(L1, email) email as Text, @audit name as @pii(L1, name) Text.`、多行字段表里的
  `@audit score as Int` 现在接受（此前 E055 Expected field name），与 core 文法 `field: annotation* nameIdent …` 一致，
  与形参注解（#328）同法：`X of A` 的分隔符后面是「注解 + 名字 as」时属于字段表。AST 的 `Field.annotations` 记前置注解；
  Core IR 的 `Field.annotations` 先列前置注解、再列类型最外层的 `@pii(…)`，与 core 逐字节相同。
- **lambda 单行体**：`Let g be function given y as Int, produce Int: Return y plus 1.` 与表达式位置的
  `List.map(xs, function given a as Int, produce Int: Return a.)` 现在接受（此前 E055 Expected newline），与 core 文法
  `lambdaExpr: … COLON (returnStmt | NEWLINE block)` 一致：冒号后同一行只能是一条 `Return`，包成一个块，块的位置与整个
  lambda 相同（与 core 一致）。Let 右侧与表达式位置的 lambda 改为共用 `parseLambdaAfterFunction`。
- **`X of A` 的分隔符之后的裸小写名字改报 E055**（`Expected type name: 'y' would be read as another type argument; …`，
  与 core 同码、同参数 `{token: token.typeName}`、同文案、同位置）：`given x as Pair of Int, y, produce Int`、
  `Pair of Int and y`、`result of Int, y`、`Pair of Int, @audit y` 的 `y` 此前被静默读成 Pair 的类型参数，core 一直拒绝。
  写 `y as <Type>`，或给泛型加括号 `(Pair of Int), y`。内建类型关键词（`text` / `int` / `float` / `bool`）、`maybe T`、
  `map K to V`、`foo of …`、天城文名字与 list / option（只收一个参数）之后的名字不受影响。
- 大写字段名（`Define Order with Id as Text.`，E055 `token.fieldName`）、大写规则名（`Rule Approve …`，E055）、
  下划线开头的标识符（`_x`，词法 E050）与导入关键词 `USE` / `uSe` 在 ts 的行为不变（拒绝 / 拒绝 / 拒绝 / 接受），
  core 已与之对齐；新测试锁住这四处。
- 格式化器：输出字段前置注解；下一项没有写出类型（`, y`、`, @audit y`）时，以开放元数的 `X of …` 结尾的字段 / 形参类型
  加括号输出 `(Pair of Int), y`（此前输出 `Pair of Int, y`，重新解析会改变含义，现在则两引擎都拒绝）。LSP 不生成任何被新规则
  拒绝的写法（补全只给关键词 / 类型名，代码动作不生成字段、规则名或形参表）。
- 共享夹具 `shared/parse_diagnostics_parity.json` 新增 11 例，与 aster-lang-core 逐字节相同；新增
  `test/unit/parser/declaration-syntax-parity.test.ts`，`formatter-roundtrip` 新增 3 例。

## 3.2.0

> **次版本号的理由**：包的公开声明只增不删、无签名变化——在 `v3.1.0` 与本版各自 `pnpm run build` 对比 `dist/**/*.d.ts`：
> `ErrorCode` 新增 `GOV_PII_RETURNED_AS_TEXT = "W709"`，`Core.Field` / `Core.Param` 工厂末尾新增可选参数 `annotations`，
> AST `Parameter` 新增可选字段 `annotations`，`ParseIssue` 新增 `unexpectedExpecting`；新模块 `governance/pii-text-return`
> 与 `parser/annotation-parser` 不被任何导出声明引用。但新警告 W709 与下面的语法裁决（`result of A or B` 报 E062、
> `maybe of T` 报 E061、尖括号泛型报 E056）让部分既有源码出现新的诊断，不是补丁级变化，按 ADR 0046 §11.7
> 第 11 条（1.6.0 先例）取 minor。

### W709：@pii 输入字段流入返回的 Text（aster-cloud#772 方案 3，与 aster-lang-core 同车次）

- **新警告 W709 `GOV_PII_RETURNED_AS_TEXT`**（`governance` 类，恒为 warning、不阻断保存）：函数声明返回 `Text`（或返回类型
  由推断得到且返回值已知是文本）时，返回值由 `@pii` 形参或 `@pii` 记录字段经 `+` / `Text.concat` 拼接、Let / Set 绑定、
  if 表达式分支构成，在该 Return 处按字段报告，参数 `{rule}` 与 `{field}`（以参数名为前缀的字段路径，如 `applicant.name`）。
  执行输出原样落库并在日志页展示，日志面的输入打码（ADR 0042 §12.6）覆盖不到它，由策略作者负责。
- 保守口径：只看声明类型；不跨函数、不进集合、不经其他内置调用传播；返回类型声明为 `@pii(...) Text` 或不是 Text 时不报。
- 新文件 `src/governance/pii-text-return.ts`（Java 镜像 `PiiTextReturnAnalyzer`），由 `checkGovernance` 调用，Node 与浏览器
  两条类型检查路径都会给出；共享夹具 `shared/governance_pii_text_return_parity.json` 与 aster-lang-core 逐字节相同。
- 码表、`docs/error-codes.md` 与 `diagnostic-overlays.generated.ts`（zh-CN / de-DE / hi-IN 译文）同步。

### 双引擎 parity：签名与类型别名语法（aster-lang-ts#328，ADR 0056 修订 A2，与 aster-lang-core 1.0.49 同车次）

- **形参前置注解**：`given x as Pair of Int, @pii(L1, email) y as Text`、`given @pii(L2, phone) @audit p as Text`、
  lambda 形参 `function given @seen n as Int` 现在接受（此前 E056），与 core 文法 `param: annotation* nameIdent …` 一致。
  `X of A` 之后的分隔符后面是「注解 + 名字 as」时属于形参表。AST 的 `Parameter.annotations` 记前置注解；
  Core IR 的 `Param.annotations` 先列前置注解、再列类型最外层的 `@pii(…)`，与 core 逐字节相同（此前
  `given q as @pii(L1, email) Text` 的 `annotations` 在 ts 为 `[]`、在 core 为 `[pii]`）。lambda 形参的约束
  （`required` 等）同样进入 Core IR（此前 ts 丢弃），规则与 lambda 共用同一个 `lowerParam`。
- **`result of A or B` 改报 E062**（`Unexpected 'or'; expected 'and' …`，与 core 同码同位置）：`or` 不是失败类型分隔符，
  写 `result of A and B` 或 `result of A, B`。此前 ts 接受、core 拒绝（这类源码从未在生产编译通过）。
- **尖括号泛型 `Pair<Int, Text>` 统一报 E056**（`Expected 'of' after type name …`），落在 `<` 上，形参、字段、返回类型、
  别名、lambda 位置相同。core 同步改为拒绝（此前 core 接受）。
- **`maybe of T` 改报 E061**（`Unexpected 'of': write 'maybe T' or 'T?' …`）：前缀可空写 `maybe T`（≡ `T?`，内层可带注解，
  如 `Maybe @pii(L1, name) Text`）。ts 一直接受 `maybe T`，core 现已接受；`maybe of T` 此前在 ts 报 E059，core 读成名为 maybe 的泛型。
- **字段类型最外层的 `@pii(…)` 同时记入 Core IR 的 `Field.annotations`**，与 core 逐字节相同（此前 ts 为 `[]`）。
- 大写形参名（`given Customer as Text`）与首字母大写的类型别名关键词（`Type Amount as Int.`）在 ts 的行为不变
  （分别报 E055 / 接受），core 已与之对齐。
- 格式化器：输出形参前置注解；lambda 形参带注解时保留块形（箭头形参表写不出注解）。Maybe 的内层不是名字时输出前缀
  `maybe T`（此前 `Maybe @pii(…) Text` 打印成含义不同的 `@pii(…) Text?`，`maybe list of Text` 打印成 `list of Text?`）。
- 内部：声明级注解与形参注解共用 `src/parser/annotation-parser.ts`。
- 测试：`signature-syntax-parity` 单测、解析诊断 parity 夹具新增 12 例（与 core 逐字节相同）。

## 3.1.0

> **次版本号的理由**：包的公开导出（`package.json` 的 `exports` 可达的声明）没有删减或改签名；被删除的
> `Diagnostics.unknownEffect` 与 `parseLegacyCapability` 都不在 `exports` 中、不能被包外导入。但下面的语法裁决
> 让部分此前能编译的源码改报 error 级诊断，不是补丁级变化，按 ADR 0046 §11.7 第 11 条（1.6.0 先例）取 minor。

### 双引擎 parity 清扫（ADR 0056 修订 A1，与 aster-lang-core 1.0.48 同车次）

- **规则头必须写在一行**（aster-lang-core#266）：从 `Rule` 到结尾的 `:` / `.`（含 `It performs …`）不再跳过换行与缩进。
  「逗号后换行再写 produce」「given 后逐行列参数」「`produce T.` 换行再写 `It performs`」此前在 ts 接受，现报解析错误，
  与 core 一致（这些写法从未在生产编译通过）。
- **`X of` 参数与下一个形参 / 字段的边界与 core 一致**：分隔符后是「名字 as」或不能开始类型的记号时属于外层，
  `given x as Pair of Int, y as Text`、`result of Int and y as Text`（此前 E056）与 `result of Int, Text`（此前 E055）现在接受。
- **E064：括号类型表里的歧义逗号**：函数类型参数表里 `X of A, B` 的逗号在 X 还能接参数时报 E064 `Unexpected ','`
  （此前 ts 读作类型表下一项，core 读作 X 的参数，两端 IR 不同），改写为 `and` 或给 X 加括号。
- **格式化器**：类型参数以开放元数的 `X of …` 结尾且后面紧跟分隔符时加括号（此前会把 `((Pair of Int), Text) -> Bool`
  打印成含义不同的 `(Pair of Int, Text) -> Bool`）；`Result` 用 `and` 输出。
- **manifest 能力检查与 core 一致**（#320）：受 manifest 约束的能力 = 显式声明 ∪ 函数体实际用到；裸 `It performs io` /
  `cpu` 不再展开成预置能力；manifest 的 `io` / `cpu` 类别键按 `shared/capabilities.json` 的 `class` 展开（io 补上
  Network、Process、Payment、Inventory，cpu 补上 Crypto），同表里具体能力键覆盖类别键。
- **LSP 效果快修**（#310）：按码表值（E200 / E205 / E303 等）触发，插入小写 `It performs io` / `cpu`，规则头已有
  `It performs` 时也给出修复。
- **E601 改为保留码**（#309）：已无发出点，码表 help 同步说明；删除无调用方的内部构造器 `Diagnostics.unknownEffect`。
- 测试：`X of` 元数与解析诊断 parity 夹具（#326）。

## 3.0.0

> **主版本号的理由**：下面「删除的 API」中，公开类型 `Lexicon`
> （经子路径 `./browser` 与 `./lexicons/types` 导出，并出现在 `parseWithLexicon` 等公开函数的签名里）删除了可选字段 `typeInferenceRules`，消费方给它赋值的
> 代码会编译失败，且该字段不再生效。其余被删除的函数（`attachTypeInferenceRules`、`BASE_NAMING_RULES`、
> `refineInferredType` 等）不在 `package.json` 的 `exports` 中、不能被包外导入，不构成额外的破坏面；但 IR 取值
> （effectCaps、推断类型、captures）的变化本身也是对持久化 IR 与下游读方的破坏性变更。

### 推断值统一（ADR 0056）——破坏性变更

ts 与 aster-lang-core 对未写明的类型与能力产出相同的 IR，Core IR v2 值层豁免表清空。

- **effectCaps 只记显式能力**：`It performs io` / `cpu` 没有列出能力时 `effectCaps` 为 `[]`（此前展开为 io / cpu 预置列表）；
  工作流步骤的能力检查只在 `effectCapsExplicit` 为真时进行。
- **推断返回类型锚点**：Lambda 省略返回类型时占位 `Unknown` 的 origin 是 `produce` 关键词（此前是其后的 `:`）。
- **未标注形参 / 字段的推断类型**：规则表改为 aster-lang-locales `type-inference/naming-rules.json`（副本
  `shared/type-inference-naming-rules.json`），按「分词 + 词表」匹配、与词法表无关，再按约束修正（Range 端点按规范十进制值，
  与书写顺序无关）。en-US 规则此前只在显式传入 lexicon 时生效，现在对所有模块生效，推断结果随之变化
  （例如 `isActive` → `Bool`、`createdAt` → `DateTime`、`value` → `Int`、`candidate` → `Text`、`days_since_consent` → `Int`）。
- **Lambda.captures 只列外层局部**：外层函数形参、lambda 之前的 Let、外层 Match 模式绑定与外层 lambda 形参；
  在方法调用改写后的 IR 上判定，按首次引用的源码位置排序。运算符名（`+`、`>` 等）、模块规则名、内建函数、
  方法名与效应关键词（`io.get(…)` 的 `get`、`io`）不再进 captures；枚举成员也不再进 captures。
- **删除的 API**：`Lexicon.typeInferenceRules`、`TypeInferenceRule` 类型、`attachTypeInferenceRules` /
  `registerOverlayTypeInferenceRules`（`config/lexicons/type-inference-rules`）、overlay 的 `typeInferenceRules` 与
  `loadTypeInferenceRules`、`BASE_NAMING_RULES`、`inferTypeFromConstraints`、`refineInferredType`；`inferFieldType(name, constraints)`
  不再接受 lexicon 参数。

## 2.0.0

### Core IR v2（ADR 0055，与 1.0.46 引擎列车同车次）——破坏性变更

ts 与 aster-lang-core 改为产出同一种 Core IR v2：形状由 aster-lang-locales `core-ir/core-ir.v2.schema.json`
（JSON Schema 2020-12）定义，本仓副本为 `shared/core-ir.v2.schema.json`，由 sibling parity 测试守护。**不做 v1 兼容**：
旧 IR 不能被新读方读入，持久化的 IR 须按源码重新编译。

- **新增 API**：`serializeCoreIr(module)` 输出规范字节（core `CanonicalJson` 规则：键按码点升序、数组保序、null 显式、
  只允许 safe integer）；`validateCoreIrInvariants(module)`；`readCoreIr(json)` 严格读入（`schemaVersion` 预检 → schema
  校验 → 不变式），失败抛 `CoreIrFormatError`（`code` 为 `unsupported_schema_version` 或 `invalid_request`）。
  `compile()` / `compileAndTypecheck()` 的结果新增 `coreJson`（= `serializeCoreIr(core)`）：持久化、哈希或提交给
  aster-api `/evaluate-json` 时直接用它，`core` 保持对象形态。`readCoreIr` 依赖 ajv（已移入 dependencies），只从 Node 入口导出。
- **IR 形状变化**（ADR 0055 §4）：
  - `Module.schemaVersion: 2`；所有字段恒输出（标量 / 对象为 `null`，列表为 `[]`，布尔为 `false`），`profile` 未声明为 `null`；
  - 每个带 kind 的节点都有 `origin`（含签名中的类型节点、约束元素），`origin.file` / `written` / `role` 恒输出；
  - `Import` 改为 `{path, alias, version}`（原 `name` / `asName`）；
  - `Annotation.args` 恒输出（无参为 `[]`），值只能是字符串、Int32 或布尔；
  - `Field` / `Param` 恒带 `annotations`、`constraints`、`typeInferred`；`Range.min` / `max` 是规范十进制串（另一端为 `null`）；
  - `Func.effects` 只含 `io` / `cpu`（小写）与已声明的效应变量，按首次声明顺序去重；删除 `declaredEffects`、`piiLevel`、
    `piiCategories`；恒带 `retTypeInferred`、`retAnnotations`、`effectParams`、`inputRefs`（非档案模块与非 Verdict 函数为 `null`）；
    `typeParams` 不再补推断占位 `Unknown`；
  - `Double.value` 是取自字面量原文的规范十进制串（`1e-7` 不会出现，`0.0000001` 原样，`2.50` → `"2.5"`）；
  - `PatCtor` 只有 `args`（删除 `names`）；枚举成员模式一律为 `PatCtor{typeName, args:[]}`，`PatName` 只表示绑定，
    运行时不再按首字母大小写区分（中文、印地文成员名因此正确）；裸写的 `None` / `Some` / `Ok` / `Err` 同样是 PatCtor；
  - `Lambda` 只有 `ret`（删除 `retType`），`captures` 恒输出；`workflow.retry` / `timeout`、`step.compensate` 无值为 `null`。
- **TS 类型**：`Core.*` 是由 schema 生成的 `src/core/core-ir-v2.generated.ts` 的别名（全部 readonly、必填）。
  `Core.EffectVar` 删除；类型检查器内部使用新的宽松类型 `Ty.*`。
- **诊断**：新增 E213 `EFFECT_PARAM_SHADOWS_BUILTIN`（效应参数与 io / cpu / pure / async 同名，ASCII 大小写不敏感）与
  E900 `PARSE_DUPLICATE_ANNOTATION_ARG`（同一注解的具名参数重名，解析期）。注解参数值为浮点、Long 或 null 时报 E067；
  效应位置上未声明的大写效应变量名在解析期报 E210；效应位置现在也可以直接写已声明的效应变量（`It performs E`）。
  zh / de 译文来自 aster-lang-locales；hi 译文待 aster-lang-hi 补齐（在此之前回退英文）。
- **移除**：`serializeCoreIR` / `deserializeCoreIR` / `isValidCoreIRJson` 与 `CoreIREnvelope`（`version: "1.0"` 外层封装）。
  `aster-convert compile-to-json` 改为输出 `serializeCoreIr` 的规范字节，`json-to-cnl` 改为 `readCoreIr` 严格读入；
  `aster truffle` 写出规范字节，读入 `.json` 时先严格校验。
- `CORE_IR_ABI` 升为 `2.0`（toolchainId 随之变化）。

## 1.6.0

### 控制注册表 1.3.0：`eu-ai-act-high-risk` 要求 verifiedInputs（ADR 0046 §11.4 ⑦，与 aster-lang-core 同车次）

- **行为变化**：registry 1.3.0：`eu-ai-act-high-risk` 要求 verifiedInputs，输入引用无法静态确定的规则报 E708。
  内置副本 `controls-registry.data.ts` 升到 1.3.0，唯一变化是该档案 `requires.verifiedInputs: true`；`governed` 仍为 `false`。
  声明 `Profile "eu-ai-act-high-risk"` 的模块中，`inputRefs` 为 `["*"]` 的 Verdict 规则（动态键、跨模块调用、函数值、
  递归、整体序列化等，见 1.5.0 的 construct 闭集）此前无诊断，现在报 E708（error）。未声明档案、声明 `governed`
  或使用注入注册表的调用方不受影响。W704 / E705 消息里的注册表版本随之变为 `1.3.0`。
  因默认注册表变化会让既有源码出现新的 error 级诊断，本版按 minor 发布（ADR 0046 §11.7 第 11 条）。

## 1.5.0

### 规则输入引用 `Core.Func.inputRefs`、E708 与控制注册表 1.2.0（ADR 0046 §11 R62，与 aster-lang-core 同车次）

- **新增 `Core.Func.inputRefs?: readonly string[]`**：声明了档案（`Profile "…"`）的模块中，返回 Verdict 的规则写入它对
  第一个参数读取的源码字段路径（点连接，按 UTF-16 码元字典序去重；`""` 为参数本身，`["*"]` 为无法静态确定，`[]` 为不读输入）。
  在名称解析 R2 之后计算（`src/governance/input-refs.ts`，Java 镜像 `InputRefsAnalyzer`），zh / de 源码产出规范路径。
  **未声明档案的模块 IR 逐字节不变**；声明档案模块的 IR 只多出该字段。传播规则见 ADR 0046 §11.2 D2 与 §11.6。
- **新增 E708 `GOV_PROFILE_INPUT_UNRESOLVABLE`（error）**：档案要求 `verifiedInputs` 且规则的 `inputRefs` 为 `["*"]` 时报告，
  参数 `{rule, profile, construct}`，`construct` 取先序遍历中第一个产生 `*` 的构造（闭集九项，值不翻译）。
  `src/diagnostics/error_codes.ts` 与 `docs/error-codes.md` 随共享码表同步；zh / de / hi 译文按 aster-lang-locales /
  aster-lang-hi 同名分支（`feat/r62-input-refs`）的语言包重新生成 `diagnostic-overlays.generated.ts`。
- **控制注册表内置副本升到 1.2.0**：两个档案都显式 `"verifiedInputs": false`，因此本版本对任何现有策略**不新增诊断**。
  `ProfileDef` 新增 `verifiedInputs: boolean`：注册表缺该键时为 `false`，出现但不是布尔时该档案不登记（声明它的模块得到 E705），
  与 Java `ControlRegistry` 同口径；其余未知键照旧忽略。
- 共享夹具 `shared/governance_input_refs_parity.json`（与 aster-lang-core 测试资源 byte-identical）：ADR 正反例表逐行、
  补充规则 (a)–(c)、`Use … as Alias` 与本模块函数同名、两处 `*` 的遍历顺序、非 Verdict 函数、zh / de 规范路径。

### 类型嵌套上限 300 → 64（收紧，行为变化，与 aster-lang-core#250 同车次）

- `MAX_TYPE_RECURSION_DEPTH` 由 300 降到 **64**，与 core 新增的词法期类型守卫 `AsterCustomLexer.MAX_TYPE_NESTING_DEPTH`
  同值同单位：每进入一次 `parseType` 计 1（含叶子类型名），`list of` 元素、`Map` 键和值、`result of` 每个分量、
  `option of` 参数各占一层。core 此前没有类型守卫，1MB 线程栈 `-Xint` 下 `result of Int and result of …` 约 206–211 层
  即在 ANTLR 解析期栈溢出；64 取在该值一半以下，512K 栈仍有余量。
- **行为变化**：类型嵌套深度在 65–300 之间的源码，此前 ts 通过，现在报 E054。降低上限的前提是发版前的生产源码
  gate scan 结果为 0（发版计划 §4 第 6 条）。
- 共享夹具 `shared/parse_diagnostics_parity.json` 新增 list 链、Map 键 / 值交替、result 失败分量嵌套三种形态的
  「64 层放行 / 65 层 E054」六例（与 core 副本 byte-identical）。

### 未知效果名与 core 对齐（放宽，#304）

- `It performs <名字>` 接受任意基效果名（如 `teleport`、`pure`），与 aster-lang-core 文法 `IT PERFORMS IDENT` 一致；
  此前 ts 在解析期报错，core 一直接受。core 词法保留的关键词（`return`、`to`、`async` 等，含 zh / de 翻译后同词）
  不是 IDENT，两端都拒绝；core 不保留的软关键词（如 `maybe`）两端都接受。能力名（首字母大写）的处理不变。
- lowering 不再对未知效果抛 E601：名字原样保留在 Core IR 的 `effects` / `declaredEffects`（core 同样透传），
  检查阶段按 pure 处理（效果推断把未知名折算为 PURE，与 core `EffectChecker` 一致）。E601 仍留在码表中，
  两引擎都不再有发出点；共享夹具 `shared/lowering_diagnostics_parity.json` 不变，其中 E601 例在 ts 侧改为断言
  「lowering 接受并保留该名字」，渲染 parity 照旧。

## 1.4.0

### lowering 诊断进入共享错误码表（E600–E606，#302 / #303，与 aster-lang-core#248 同车次）

- 共享码表新增 category=`lowering` 的 E600–E605（AST → Core IR 的不变量守卫：未知声明 / 效果 / 语句 /
  表达式 / 模式 / 类型种类）与 E606（lowering 阶段内部异常，`detail` 为异常消息）。守卫的英文 `message`
  原句不变，诊断的 `code` 由本地码 L101–L106 改为新码并带命名参数（`params`）。
- `compile()` / `compileAndTypecheck()` 新增 `loweringDiagnostics?: TypecheckDiagnostic[]`（与
  `resolutionDiagnostics` / `typeErrors` 同形，`data` 为命名参数，传入 lexicon 时按语言包 overlay 本地化，缺译回退英文）。
  只有 lowering 调用（R1 → lower → R2）的异常才转为 lowering 诊断；规范化 / 词法 / 解析阶段的非诊断异常保持原行为。
- `loweringErrors?: string[]` 标 **@deprecated**，并行保留一个 minor 版本（lowering 失败时为各条诊断的英文 message；
  前置阶段异常仍只出现在这里）。消费方（aster-cloud `useAsterCompiler` / `seed-compile-gate`）改读
  `loweringDiagnostics` 并直接取 `code`、不再映射 E000 后，**下一 minor 删除 `loweringErrors`**（与 R56 的 legacyCode 过渡同理）。
- 共享 parity 夹具 `shared/lowering_diagnostics_parity.json`（与 core 副本 byte-identical）：每码 en / zh / de 各一例。
- zh / de / hi 译文按 aster-lang-locales / aster-lang-hi 同名分支（`fix/302-lowering-error-codes`，locales#126）的语言包重新生成
  diagnostic overlay；overlay 校验对 lowering 码保留缺译豁免（范围断言锁定为 E600–E606），语言包发版后删除。

### 解析（收紧，与 core 对齐，aster-api#472，#305）

- 表达式嵌套上限 `MAX_RECURSION_DEPTH` 300 → **64**，与 aster-lang-core 两道守卫同值：Java 侧 1MB 线程栈上
  157–196 层括号就栈溢出，原上限形同虚设，core 下调到 64 后 TS 随之对齐。共享夹具
  `shared/parse_diagnostics_parity.json` 新增「63 层括号放行 / 64 层 E054」两例。
- 类型递归（`maybe` / `list of` 链）改用独立上限 `MAX_TYPE_RECURSION_DEPTH`，保持 300：Java 侧类型嵌套无守卫，
  TS 不得比 Java 更严。`ParserContext.enterRecursion(limit?)` 新增可选上限参数。

## 1.3.0

### 破坏性：删除过渡字段 legacyCode（ADR 0051 §16 R56 过渡结束，#300）

- 解析 / 词法诊断不再带 `legacyCode`（`Diagnostic`、`compile().parseErrors`、`validateSyntaxWithSpan()`、
  LSP 诊断 `data`），只保留 `code`（E050–E069）与 `params`。消费方必须已改读新码（如原 P005 构造写法现为 E057）。
  aster-cloud 须先部署识别新码的版本，再升级到本版。

### 新增公共导出（aster-cloud#650，#293）

- `resolvePolicyTypes()` 的 `functions[]` 新增 `entry: boolean`：该函数是否带 `@entry` 注解，调用方选入口 Rule 不必再解析一次 AST。
- 新增通用写法解析 `buildSpellingIndex(items, spellingsOf, keyOf)` / `resolveSpelling(index, written)`（及类型
  `SpellingIndex` / `SpellingMatch`），与引擎名称解析同口径：NFC 精确匹配优先，其次折叠键匹配；同一层命中多个不同项
  （按 `keyOf` 去重）为 `conflict`，精确层撞名不退回折叠层。包入口与浏览器入口均导出。

### 规范化

- 冠词删除按语法位置保护声明名：紧跟 `Define` / `Rule`（含 lexicon 别名）且后面紧跟关键词的 a / an / the 视为
  声明名保留（`Define The has …`、`Rule a given …`），名词短语中的冠词照常删除。与 aster-lang-core#244 同步，
  共享夹具 `article-declaration-names.json`。此前 `Rule a given …` 编译后函数名变成 `given`（#298，Fixes #297）。

### 解析（放宽，TS 不比 Java 严）

- 未知能力名（`It performs io [Banana]`、`with Blockchain`）不再在解析期报 E069，按原样进入 `effectCaps`，
  由类型检查给出 INFO；`await` 不再在解析期检查参数个数（E068），与 core 一致（#296，Fixes #294 #295）。

### 诊断译文

- 按 locales / hi 1.0.41 语言包重新生成诊断 overlay，新增 E050–E069 的 zh-CN / de-DE / hi-IN 译文，删除 syntax
  码缺译豁免（#299）。

## 1.2.6

### 解析诊断进入共享错误码表（ADR 0051 §16 R56，与 aster-lang-core 同车次）

- 共享码表新增 E050–E069（category=`syntax`）。所有词法 / 解析错误改发新码与命名参数（`params`），
  诊断的 `code` 由本地码 P0xx / L0xx 改为新码；原本地码保留在过渡字段 `legacyCode` 一个车次
  （aster-cloud 的 P005 启发式改读新码后删除）。英文 `message` 原文不变。
- `compile()` 的 `parseErrors`、`validateSyntaxWithSpan()` 的结果 与 LSP 诊断新增 `code` / `legacyCode` / `params`（LSP 在 `data` 中），
  供消费方按码取译文。
- 解析器报错点只接受「码 + 参数 + 消息」（`parse-issue.ts`），不再接受裸字符串，单测守卫。
- 诊断位置与 Java 对齐（消息不变）：治理结论非法（E056）报在结论起点、`Otherwise` 不在块末（E065）报在该
  `Otherwise` 上、retry 缺必填指令（E066）报在 `retry` 上（此前分别报在块末 / 下一条语句 / 区块末尾）。
- 双引擎 parity 夹具 `shared/parse_diagnostics_parity.json`（与 aster-lang-core 副本 byte-identical）。

### 顶层统一命名空间（ADR 0051 §16 R57）

- 导入别名（`Use … as X`；无 `as` 时为路径末段）与顶层类型、枚举、类型别名共用一个命名空间，同名报 E807，
  不再由枚举静默遮蔽别名（#248 M1）。别名与函数同名不受影响。这是有意变严：aster_api / aster_cloud 生产库扫描均 0 行。

### 类型检查

- **收紧**：函数体内每条 `Return`（任意嵌套 If / Match 分支）都按可赋值规则（Unknown / 按名推断放行，
  Int → Float、Decimal 拓宽放行）与声明返回类型比较，E003 报在该 `Return` 语句上；此前只比较函数级推断结果，
  内层分支的不符 Return 可能漏报或报在第 1 行。没有 Return 报错时保留函数级兜底比较，span 取函数体最后一条语句；
  lambda 体、workflow step / compensate 内的 `Return` 不参与外层规则比较（#284，与 aster-lang-core#240 同步）。
- **放宽**（TS 不比 Java 严，#285）：删除 Java 侧从不发出的三条检查——整数模式不再检查 scrutinee 类型（E010）；
  compensate 块返回值不再检查（E022，运行时丢弃）；删除「首字母大写的未知类型名」启发式（E006，类型别名
  `Type Score as Int.` 不再误报，未声明类型仍由名称解析报 E800）。

### 解释器

- 整数模式 `When N` 对 Decimal 值按数值精确比较（`0.00m` 匹配 `When 0`，`1.5m` 不匹配任何整数模式），与
  aster-lang-truffle#167 的 `BigDecimal.compareTo` 一致；Text 等非数值仍不匹配（#290）。

### LSP

- 成员补全：行尾带成员前缀（`令 x 定义为 司机.年`、`Let x be d.a`）时最先尝试「删去 `.前缀`、补句末标点」修补，
  高负载下首次请求即出字段（#286）。
- 成员补全：`When Box(d), Return d.` 的模式绑定按主语类型与构造器字段给出字段补全；名称解析与诊断不变（#287）。
- `onCompletion` 返回 `CompletionList`：成员补全修补推断因耗时预算截断且未定出接收者类型时 `isIncomplete: true`，
  其余情况为 `false`。LSP 客户端须同时接受数组与 `CompletionList`，aster-cloud 现有适配兼容；导出的
  `memberCompletions` 签名不变（#288）。
## 1.2.5

### 类型检查放宽（与 aster-lang-core#232 #233 #234 同步）

- 按名字推断出的类型一律视为未知：未写类型的 data 字段（`Define Decision has approved, collateralRequired.`）
  不再按推断类型检查构造值（此前 `collateralRequired set to 1` 报 E012 `expects Text, got Int`）；未写类型的形参 /
  lambda 形参的类型实例在实参、字段、`Set`、`Return` 位置不作约束，并随 Let、`Set`、`Some(...)`、规则返回值传播
  （`Return amount`、`Return Some(amount)`、`P with total set to amount` 不再报错）。aster-lang-test 语料消失 80 条 E012。
- `Return`（规则与 lambda）与实参同一套可赋值规则：数值拓宽（`produce Float` 时 `Return 1`、Int → Long / Decimal）、
  T → T?、None → T? 放行；收窄（Float → Int、T? → T、Double ↔ Decimal）仍报 E003。
  泛型规则体内的 Return 不检查（`Rule bad of T … produce T: Return 1.` 不报，与 Java 一致；类型参数之间不做合一）。
- truffle `Builtins.canonicalName` 归一化的单词别名（`plus` `minus` `times` `divide` `modulo` `equals` `is` `under`
  `over`，不区分大小写）与规范 builtin 名一样，同名的非函数局部名被调用时不报「调用非函数局部名」
  （`given over as Int … over(3, 2)`），与 aster-lang-core `CallTargetBuiltins.ALIASES` 一致。

### 修复

- 类型检查：`Decimal` 是内置标量，不再被当作隐式类型参数（#276）。此前 `x as Decimal` 形参降级为类型变量，任何实参
  都能传入，`produce Decimal` 还会误报 `expected Decimal, got Decimal`（语料 10 条）。现在 Int / Long → Decimal 放行，
  Text / Float / Double → Decimal、Decimal → Int / Double 报 E001（ADR 0025）。Core IR 中 Decimal 签名的 `typeParams`
  由 `["Decimal"]` 变为 `[]`，与 Java 一致。
- 解释器：`T?` 的裸值与 `Some` / `None` 模式（#277）。宿主传入或 T → T? 直接传入的值不带 Some/None 标签，此前
  `When Some(v)` / `When None` 都不匹配，Match 静默返回 null。现在裸的非 null 值匹配 `Some(v)`，null 匹配 `None`；
  Some/None/Ok/Err 构造值不变。truffle 同步修复（aster-lang-truffle 同名分支）。
- 解释器：未声明的单词别名调用按 builtin 分派（`divide(10, 2)` → 5，与 truffle 一致；此前报 `Undefined function`）。

## 1.2.4

### 破坏性变更（类型检查）

- 调用本模块规则或函数值局部名时比较实参类型（#266）：**新增 E001 拒绝**，如 `inc("a")`（`inc` 的形参
  `x as Int`）报 `expected Int, got Text`；`Let g be inc. Return g("a").`、把 `(Text) -> Text` 的规则传给
  `(Int) -> Int` 形参同样报错，与 aster-lang-core `BaseTypeChecker.checkCall` 同码。原则是能正常运行的调用不新增
  E001，拿不准时放行：
  - 只比较**写了类型**的形参。未写类型的形参（规则与 lambda）按名字推断出的类型不作为调用约束；实参若是
    未写类型的形参（`given amount` 后 `inc(amount)`），或经 Let 直接取自它的局部名（`Let y be amount. inc(y)`），
    同样不比较。
  - 实参或形参含 Unknown / 类型变量时放行：泛型规则、`produce:` 推断不出的返回类型。
  - **数值拓宽放行**：Int → Long / Float / Decimal，Long → Float / Decimal，Float ↔ Double；包括字面量
    （`f(5)` 传给 Float / Long 形参）与容器元素（`List of Int` → `List of Float`、`Option of Int` → `Option of Float`）。
    收窄（Float → Int）仍报错。
  - Maybe 与 Option 视为同一种类：T → T?、None → T?、T? ↔ `Option of T`、`Some(n)` → `Option of Int` 放行；
    T? → T 仍报错。PII 包装比较前剥掉，函数类型不比较效应。
  - aster-lang-test 全部 454 份语料无新增诊断。aster-lang-core#231（#229）起两引擎按同一套规则检查。
- 调用类型已知且不是函数的局部名报 E001（`expected a function, got 'score' of type Int`，#268）。局部名遮蔽同名
  规则（与 Java 名称解析一致），此前 `Rule main given score as Int … Return score(1, 2).` 在有同名规则 `score`
  时零诊断。未写类型的形参（`given f` 后 `f(n)`）不报。同理，从 If 分支作用域外泄的同名变量（分支内
  `Let score be 1.`、分支外 `score(n)`）现在也遮蔽同名规则，报 E001。单段具名 builtin（`add` / `sub` / `mul` /
  `div` / `intdiv` / `mod` / `eq` / `ne` / `lt` / `lte` / `gt` / `gte` / `and` / `or` / `not` / `await`，与 truffle
  Builtins、aster-lang-core CallTargetBuiltins 一致）不按「调用非函数局部名」报：`given add as Int … Return add(1, 2).`
  在没有同名规则时调用的是 builtin，能正常运行。与 builtin 同名的局部函数值按其函数类型检查（如 `Let add be function
  with a as Int …` 后 `add(1, 2)` 报 E032）。builtin 的别名写法（`divide`、`over`、`equals` 等）尚未纳入名单，
  见 aster-lang-core#234。
- 经未写类型的形参 / 局部值发起的调用不做类型检查；局部名与规则同名且其值不是函数时，现在在运行期报错
  （与 truffle 一致），不再回退到同名规则（例如 `given score` 后 `score(1)`：类型检查不报，运行期报
  `'score' is not a function`）。

### 类型检查放宽

- 字段构造（E012）与 `Set`（E002）复用规则调用实参的兼容规则（数值拓宽含容器元素、T? ← T / None、Maybe/Option
  互通、Unknown / 类型变量占位放行）。此前字段 `Long` ← Int、`Text?` ← Text / None、`List of Float` ← `List of Int`、
  `produce:` 推断不出返回类型的值放进 Float 字段（`expects Float, got Unknown`）报 E012，`Set` Float 变量为 Int 报
  E002；运行都正常，Java 侧也接受。收窄仍报错。

### 修复

- 解释器：调用位置按「局部函数值 → 单段具名 builtin → 局部名遮蔽规则」分派。局部值是函数（闭包、函数类型形参）
  时调用局部值，即使与 builtin 同名（`given gt as (Int, Int) -> Bool … gt(1, 2)` 调用传入的函数）；否则在没有同名
  规则时调用 builtin（`add(1, 2)`、`gt(2, 1)` …），同名的非函数局部变量不影响。此前 TS 解释器不认这些 builtin 名
  （报 `Undefined function 'add'`）。truffle 按同一语义修复见 aster-lang-truffle#158，三个引擎一致。
- 解释器：调用目标与类型检查一致，局部名遮蔽同名规则。局部值不是函数时报 `'score' is not a function`，
  不再改调同名规则并静默丢弃多余实参（#268，与 truffle 的 `Unknown call target` 一致失败）。
- LSP 成员补全：块头行（首词为 If / Otherwise / Match，如中文 `如果 司机.`）先尝试「当前行换成 `返回 接收者.`」
  这份修补。此前按顺序先试的两份修补对块头总是不完整，1000 行以上的文档在高负载下 150ms 预算往往只够解析
  一两份，前 1–2 次请求回落到关键字列表、第 3 次才出字段；现在首次请求即出字段（实测 1207 / 4207 行、
  load ~118：第 1 次请求 null → 字段，修补解析 2 份 / 1 份 → 1 份）。其它行的修补顺序不变（#267）。

### 行为变化（Core IR）

- 裸模式名（无括号）的 IR 形态按成员 / 绑定统一（ADR 0051 裁决 R55，aster-lang-core#227）：成员还是绑定仍按 R12
  判定；首字母**不是 ASCII 大写**、判为枚举成员的名字由 `PatName` 改为无参数 `PatCtor`，判为绑定的仍是 `PatName`。
  受影响的写法：中文 / 天城文成员（`当 待处理，`、`जब उच्च,`）、de 以变音字母开头的成员（`bei Übel,`）、本仓接受的
  小写 ASCII 成员（`Define Color as one of red, Green` 中的 `When red,`）。此前这些成员分支在解释器与 truffle 上都是
  兜底绑定，吞掉其后所有分支（`描述(已删除)` 返回 1，应为 9）。首字母为 ASCII 大写的名字 IR 不变。
  `RESOLVER_VERSION` 不递增（R55）。
- 解释器：无绑定的 `PatCtor` 同时匹配枚举成员（与 truffle `PatCtorNode` 一致）。

## 1.2.3

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
- 解释器：`Set` 按词法作用域写回（ADR 0052，aster-lang-truffle#151）。此前 Scope 与 case 体整表拷贝环境，
  在 case 体 / Scope 里给外层 Let 赋值，离开块后丢失；现在写到最近定义该名字的那层，与 truffle 一致。

### 新增

- 包入口 `./lsp/completion`：导出 `memberCompletions`、`parseDocumentText` 等补全 API，下游不必按相对路径引用
  dist 内部模块（#260）。

### 破坏性变更（类型检查）

- 只有 Let 绑定可被 `Set` 赋值。**新增 E001 拒绝**：`Set` 规则形参、lambda 形参、match 模式绑定，以及在
  lambda 体内 `Set` 捕获的外层变量（报 `expected a Let binding, got parameter 'n'` /
  `pattern binding 'x'` / `captured variable 'acc'`，与 aster-lang-core 同码同行）。此前这些写法都能通过类型检查。
- `Set` 函数名或类型名报 E101（与 aster-lang-core 一致）。
- `Set` 的诊断（E001 / E002 / E101）现在带行列；此前降级后的 `Set` 节点没有位置。

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
