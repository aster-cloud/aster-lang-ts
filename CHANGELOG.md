# Changelog

## Unreleased

### 删除过渡字段 legacyCode（ADR 0051 §16 R56 过渡结束）

- **破坏性**：解析 / 词法诊断不再带 `legacyCode`（`Diagnostic`、`compile().parseErrors`、`validateSyntaxWithSpan()`、
  LSP 诊断 `data`），只保留 `code`（E050–E069）与 `params`。消费方必须已改读新码（如原 P005 构造写法现为 E057）。
  aster-cloud 须先部署识别新码的版本，再升级到本版。
### 新增公共导出（aster-cloud#650）

- `resolvePolicyTypes()` 的 `functions[]` 新增 `entry: boolean`：该函数是否带 `@entry` 注解，调用方选入口 Rule 不必再解析一次 AST。
- 新增通用写法解析 `buildSpellingIndex(items, spellingsOf, keyOf)` / `resolveSpelling(index, written)`（及类型
  `SpellingIndex` / `SpellingMatch`），与引擎名称解析同口径：NFC 精确匹配优先，其次折叠键匹配；同一层命中多个不同项
  （按 `keyOf` 去重）为 `conflict`，精确层撞名不退回折叠层。包入口与浏览器入口均导出。

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
