// LayoutMap —— 源码「显示排版」与「编译规范源码」解耦（ADR 研究方案 A 的最小实现）。
//
// 背景（见 aster-api/.claude/tasks/source-layout-preservation）：Aster 的换行/缩进是
// 语义性的（NEWLINE/INDENT/DEDENT 是块结构 token），所以不能让 parser 从「任意排版」反推
// 结构。正确做法是「编译永远吃规范 Aster，显示层按映射渲染成诗」——本模块即该映射。
//
// 核心不变式：
//   toCanonical(layoutMap) === canonical   （编译用的唯一真源，字节级确定）
//   toDisplay(layoutMap)   === display     （给用户看的自由排版）
//   两者内容 token 同序，差异仅在「结构 token（标点/缩进/换行）」是否在 display 中呈现。
//
// 这样《静夜思》可以按李白原诗的工整四句展示，而底层 canonical 仍是能被生产同款引擎
// 逐字编译执行的合法 Aster —— 用户获得排版自由，编译/运行不受影响。

/**
 * 一个 LayoutMap 由若干 **span** 组成，按 canonical 源码顺序排列。每个 span 声明一段文本
 * 在 canonical 与 display 两个视图里各自的呈现：
 *
 *   { text }                         内容片段：canonical 与 display 都原样出现（诗词）。
 *   { canonical, display }           结构片段：canonical 用 canonical 值（如 '：' / 换行+缩进），
 *                                    display 用 display 值（可为 '' 隐藏，或替换成诗的标点）。
 *
 * 防「显示欺骗」（看到诗、实际运行别的东西）的真正防线是：展示 canonical view +
 * `toCanonical === .aster` 字节守卫 + 语义测试（编译结果/运行值断言）三者叠加。
 * verifyContentParity 只是一道轻量闸（防结构 span 夹带内容词），不是安全证明。
 *
 * display 的换行由 span 的 display 值携带（结构 span 的 display 可含 '\n'），从而让显示排版
 * 完全独立于 canonical 的换行/缩进。
 *
 * @typedef {{ text: string } | { canonical: string, display: string }} LayoutSpan
 */

/** 由 spans 拼出编译用的规范源码。 */
export function toCanonical(spans) {
  return spans.map((s) => ('text' in s ? s.text : s.canonical)).join('');
}

/** 由 spans 拼出给用户看的显示排版。 */
export function toDisplay(spans) {
  return spans.map((s) => ('text' in s ? s.text : s.display)).join('');
}

/**
 * 轻量一致性检查（**非安全证明**，Codex 审查后如实定级）：确认结构 span 不夹带内容词——
 * 结构 span 的 canonical/display 只应是块标点/空白/换行，不得含语义内容文本，否则诗里会
 * 凭空多出/篡改词。
 *
 * ⚠️ 它**不**证明 display 与 canonical「语义一致」：结构标点（`。：，`）本身就是会改变
 * 语法结构的 token，「同一批内容词 + 不同结构标点」仍可能编译成不同程序。防「显示欺骗」
 * （用户看到诗、实际运行别的东西）的真正防线是三者叠加：①展示 canonical view ②
 * `toCanonical === .aster` 字节守卫 ③语义测试（编译结果 + 运行值断言）。本函数只是其中
 * 一道轻量闸。
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
export function verifyContentParity(spans) {
  const contentPieces = spans.filter((s) => 'text' in s).map((s) => s.text.trim()).filter(Boolean);
  // 结构 span 允许的字符：显式列举（Codex 审 Medium：不用 \s，它含 \r\v\f/NBSP/U+2028/U+2029
  // 等不可见/非预期空白，作为通用模块不够严）。仅允许 ASCII 空格/tab/换行 + 中英块标点。
  const STRUCT_ALLOWED = /^[ \t\n。，、：；.,:;]*$/u;
  for (const s of spans) {
    if ('canonical' in s) {
      if (!STRUCT_ALLOWED.test(s.canonical)) {
        return { ok: false, reason: `结构 span 的 canonical 含非结构字符: ${JSON.stringify(s.canonical)}` };
      }
      // display 侧允许为空（隐藏）或结构标点；不得夹带内容词，否则会在诗里凭空多出词。
      if (s.display && !STRUCT_ALLOWED.test(s.display)) {
        return { ok: false, reason: `结构 span 的 display 含非结构字符: ${JSON.stringify(s.display)}` };
      }
    }
  }
  if (contentPieces.length === 0) return { ok: false, reason: '无内容 span' };
  return { ok: true };
}
