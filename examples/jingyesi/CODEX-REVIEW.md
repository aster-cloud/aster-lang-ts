# Codex 交叉审查 — IdentifierKind.LITERAL 特性

按 CLAUDE.md 铁律（Claude 生成 → Codex 审）。三轮，session 019f1f94。

## 第一轮：设计审查（实现前）
Codex 审设计提案 → **需讨论**，抓出：
- 别复用 enumValues，用独立 `literals` 数组（采纳）
- canonical 存内容、替换时包 lexicon 引号（采纳，绕过晚插 ASCII 引号不被 segmentString 保护）
- 校验器只对 LITERAL 豁免 ASCII，改严格单行字符串校验（采纳）
- 提示 TS/Java token 边界正则可能不同（parity 覆盖）

## 第二轮：实现审查 → 6/10 退回，抓出 2 个 P0
1. **注入 P0**：校验只禁 ASCII `"`/`\`，但 zh-CN 引号是「」——内容含「」可提前闭合字符串逃逸注入源码（如 `静夜思」. Return evil`）。
2. **碰撞 P0**：字面量宏触发词与普通标识符同名 → 展开成字符串还是标识符不可预测。
- P0 #6（两端 canonicalize 文本「」vs "）：核实为**既有 zh-CN 引擎特性**（所有 zh-CN 字符串字面量都如此），与本特性无关，parse/eval parity 全绿。Codex 认同不属本 PR。
- P0 #5（parity fixture）：tier1 harness 读纯 .aster 无 vocab 注入机制，改 harness 超范围；等价性由双引擎单测 + truffle E2E 覆盖。Codex 接受为 P1。

## 修复（P0 全采纳）
1. 注入：改为**禁所有引号定界符 `" 「 」 『 』 « »` + 反斜杠**（TS + Java 对称）。
2. 碰撞：**字面量宏触发词须全局唯一**（与任何映射冲突即 error）；普通标识符跨 kind 同名仍只 warning（既有行为，内置 insurance.auto struct/enum 同名不受误伤）。

## 第三轮：确认 → 8/10 **可通过，无 P0 阻断**
两个 P0 确认闭合。3 个非阻断建议：①Java 用 Locale.ROOT（已修）；②引号集合集中定义（P2）；③文档明确 parity 契约是 parse/eval AST 非 canonicalize 原文（记录于此）。

## 结论
综合 8/10，**准予通过**。parity parse 217/217 · eval 255/255 全绿；双引擎 literal 测试 + 生产引擎《静夜思》E2E 全绿。
