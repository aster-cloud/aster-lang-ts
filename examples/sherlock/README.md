# 《斑点带子案》— 一段能运行的福尔摩斯推理

把福尔摩斯的推断写成 Aster 决策规则。喂入案发线索，它逐条推断，**运行输出真凶**。

```
$ node examples/sherlock/sherlock.mjs

  【推理独白】读者看到的：

    《斑点带子案》

    要揪出真凶，已知这几处疑点：铃绳通风口、保险箱藏毒蛇、唯继父可入密室。

      若 铃绳通风口 且 保险箱藏毒蛇——则真凶必是"继父罗伊洛特"。
      纵此不足为凭，然唯继父可入密室，亦足以断定凶手乃"继父罗伊洛特"。
      否则，只得承认"疑点未清，尚难定论"。

  喂入案发线索，运行推断输出真凶：
    · 斑点带子案（原案物证）    →  凶手：继父罗伊洛特
    · 仅密室线索              →  凶手：继父罗伊洛特
    · 仅遗言线索              →  凶手：尚需查证：谁豢养毒蛇
    · 线索不足                →  凶手：疑点未清，尚难定论
```

不同线索导出不同结论（定罪 / 待查 / 兜底）——这是**真决策**，不是固定输出。

## 为什么这不是噱头：它真的在推理

和《静夜思》demo（运行只输出诗名）不同，侦探推理**本身有决策逻辑**（条件线索 → 结论），
正好落进 Aster 的决策范式。这段文字既读得像福尔摩斯的推理段落，又是货真价实的规则程序——
契合 Aster「把领域规则变成确定性、可解释、可验证的决策程序」的定位。

> 侦探推理为什么能编译、而任意小说不能？因为 Aster 是**确定性决策引擎**，不是通用叙事执行机。
> 侦探/判决/合规/游戏规则这类文本天然有「条件→结论」结构，能映射成 `if`/`match` 决策；
> 而任意散文的绝大多数句子没有决策含义、也无法落进 Aster 的语法槽位。见
> `aster-api/.claude/tasks/source-layout-preservation/`（可行性研究）。

## 两种机制

### 1. 关键词别名（ADR 0022）—— 结构词变推理叙事词
| 别名 | Aster 关键词 |
|---|---|
| 探案笔记 | Module（立案）→ 案名 `斑点带子案` |
| 推断 | Rule（起一条推断）→ 规则名 `揪出真凶` |
| 已知 | given（列出线索参数） |
| 若 | If |
| 且 | and |
| 凶手即 | Return（下结论） |

`then`/`else` 是 inline-if 的连接词，非 `SemanticTokenKind`、无法别名，故 canonical 里保留
规范拼写——由 ↓ LayoutMap 在显示层渲染成推理连接词。

### 2. LayoutMap —— 显示排版与编译源码解耦
（与 `examples/jingyesi` 同款机制。）canonical（= `sherlock.aster`，编译真源）里的规范
`then`/`else`/缩进，在显示层被渲染成连贯的推理独白：

| canonical | display |
|---|---|
| `then 凶手即 ` | `——则真凶必是` |
| `else 若 ` | `。纵此不足为凭，然` / `。假使仅凭` |
| `else 凶手即 ` | `。否则，只得承认` |

**核心不变式**（`sherlock.test.mjs` 钉住，5 测全绿）：
- `toCanonical(layout)` === `sherlock.aster`（忽略尾随换行；显示映射与编译真源不漂移）
- display 无残留语法 `then`/`else`，读起来是推理独白
- 编译走 canonical → 案卷「斑点带子案」·推断「揪出真凶」
- **真决策**：不同线索 → 不同结论（定罪 / 待查 / 兜底）

> ⚠️ 诚实边界：LayoutMap 的 `verifyContentParity` 只是 **lint**（拦引号字面量偷塞），不是安全
> 边界——防「显示 ≠ 运行」的欺骗只能靠展示 canonical view + 语义测试（见 layout-map.mjs 注释）。

## 文件
- `sherlock.aster`：canonical 编译真源（侦探方言别名 + inline-if 决策链）
- `sherlock.layout.mjs`：LayoutMap 定义（canonical ↔ 推理独白）
- `sherlock.mjs`：demo 入口（两视图展示 + 编译 + 三场景运行）
- `sherlock.test.mjs`：回归测试

## 与 ADR 0028（显式块分隔符）的关系
本 demo **不需要** ADR 0028——现有 inline-if + 别名 + LayoutMap 已足够（Codex 设计审确认）。
ADR 0028 解决的是「源码本身任意排版/单行化、多语句块脱离缩进」，是独立的语言层能力，
本 demo 用不到。见 `aster-api/.claude/adr/0028-explicit-block-delimiters.md`（已立项）。
