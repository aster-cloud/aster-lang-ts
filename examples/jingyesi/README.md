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
