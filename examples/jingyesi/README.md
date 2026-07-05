# 《静夜思》— 一首能编译执行的诗

把李白《静夜思》按**原词序**当作 Aster Lang 源码。运行它，输出这首诗的名字「静夜思」。

```
床前 明月光。
疑是 地上霜，举头 望明月：
  低头 思故乡。
```

```
$ node examples/jingyesi/jingyesi.mjs
  编译成真程序：模块「明月光」· 函数「地上霜」
  运行诗句构造的源码，输出该诗的名字：
      →  静夜思
```

## LayoutMap —— 显示排版与编译源码解耦

上面那三行 canonical 源码被 Aster 语法结构约束：第 2 行的 `：`（开块）、第 3 行的**缩进**
（块内）是语法必需的，于是诗被迫排成「1 句 / 1 句+2 句 / 缩进 1 句」——**不是李白原诗的
工整四句**。

**LayoutMap** 让显示排版与编译源码解耦：同一段程序有两个视图——

| 视图 | 内容 | 用途 |
|---|---|---|
| **display**（显示） | 李白原诗，工整四句、原诗标点 | 给用户看，排版自由 |
| **canonical**（编译） | `jingyesi.aster`，换行/缩进迁就 Aster 语法 | 编译/运行的**唯一真源** |

```
【显示视图】按原诗排版           【编译视图】底层规范源码
  床前 明月光，                    床前 明月光。
  疑是 地上霜。         ⟺         疑是 地上霜，举头 望明月：
  举头 望明月，                      低头 思故乡。
  低头 思故乡。
```

**核心不变式**（`layout-map.test.mjs` 钉住）：
- `toCanonical(layout)` 逐字节 === `jingyesi.aster` —— 映射与编译真源永不漂移
- `toDisplay(layout)` === 原诗四句，且内容 token 两视图一致 —— 显示层不凭空增删诗词
- **编译永远走 canonical**（不试图编译 display）—— 显示自由排版无损编译/运行/确定性

> 为什么不让 parser 从「任意排版」反推结构？因为 Aster 的换行/缩进是**语义性**的
> （NEWLINE/INDENT/DEDENT 是块结构 token），丢掉缩进=丢掉块层级=无法无歧义还原。正确
> 做法是「编译吃规范 Aster，显示层按映射渲染成诗」——即本模块。语言层若要支持源码本身
> 任意排版/单行化，见 ADR《显式块分隔符》（另行立项）。

文件：`layout-map.mjs`（通用映射 + 渲染 + 校验）、`jingyesi.layout.mjs`（本诗的 LayoutMap 定义）。

## 原理

两种「词 → 语言构件」机制，都只在 canonicalize 阶段生效，Lexer/Parser/Core IR 完全
不知其存在——所以「诗版」与规范版编译到**结构一致的 Core IR**，是货真价实的程序。

### 1. 关键词别名（ADR 0022）—— 诗句领字变结构关键词
| 诗句领字 | Aster 关键词 |
|---|---|
| 床前 | Module（立篇）→ 模块名 `明月光` |
| 疑是 | Rule（起一首）→ 函数名 `地上霜` |
| 举头 | produce（产出）→ 返回类型 `望明月`（Text 的诗意名，类型由用法推断） |
| 低头 | Return（归于所思） |

### 2. 字面量宏 `IdentifierKind.LITERAL`（本 demo 引入的新特性）—— 术语变字面量
把一个 localized token 展开成**字符串字面量**：

```
思故乡 → 内容「静夜思」
```

于是末句 `低头 思故乡。` canonicalize 成 `Return "静夜思".`。

字面量宏的 `canonical` 是字符串**内容**（不含引号），canonicalize 时用当前 lexicon 的
`stringQuotes` 包裹（zh-CN 是「」，随后 ANTLR 兼容步归一为 ASCII `"`）。内容受严格校验
（单行、无控制字符、无裸引号/反斜杠），防编译期文本注入。

> 用途不止于诗：把一个**领域术语固定展开成一段标准文案**（合规场景常见），例如某个
> 业务词固定展开成一句免责声明。

## 双引擎

同一首诗在 **aster-lang-ts**（cloud playground 同款 `browser.compile`）与
**aster-lang-truffle**（生产 `/evaluate-source` 同款 Java 引擎 + 受限沙箱）上都编译执行
输出「静夜思」——字面量宏在两引擎逐字节对齐，双引擎 parity（parse 217/217 · eval 255/255）
全绿。

- TS 特性测试：`test/unit/config/lexicons/identifiers/literal-macro.test.ts`
- Java 特性测试：`aster-lang-core` `LiteralMacroTest` + `aster-lang-truffle` `JingYeSiPoemTest`
