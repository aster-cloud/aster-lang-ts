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
 * **Lint，不是安全边界**（Codex 审查两轮后如实定级，勿高估）。它只做两件小事：
 *   ① 确认至少有内容 span（display 不能全是结构/连接词而无实体内容）。
 *   ② 拦截结构 span 的 canonical 侧夹带**显式字符串字面量**（引号 `"「」『』`）——这是「结构
 *      span 偷塞内容→canonical 编译出 display 读不到的东西」里**最直接的一条**路径，顺手堵掉。
 *
 * ⚠️ 它**堵不住**的欺骗路径（务必知悉，别把它当防线）：
 *   - localized literal（如 jingyesi 的 `思故乡`，源码**无引号**、canonicalize 后才变字符串）
 *     可藏进结构 span 而 display 只显标点——本函数放行。
 *   - 结构 span 塞**非字面量但改变决策**的东西：`else 凶手即 某变量`、额外条件、额外调用、
 *     数字/布尔字面量——本函数放行。
 *
 * 故防「显示欺骗」（看到的 ≠ 运行的）**只能**靠：①UI 展示 canonical view 供人审阅 ②针对性
 * 语义测试（断言编译结果 + 运行值）。`toCanonical === .aster` 字节守卫只防 LayoutMap 与文件
 * 漂移，**不**防 .aster 与 LayoutMap 一起把未显示的语义放进 canonical。本函数是 lint。
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
export function verifyContentParity(spans) {
  const contentPieces = spans.filter((s) => 'text' in s).map((s) => s.text.trim()).filter(Boolean);
  for (const s of spans) {
    if ('canonical' in s) {
      // canonical 侧禁字符串字面量（ASCII " 或中文「」/『』引号）——字面量是内容，须走 text span。
      if (/["「」『』]/u.test(s.canonical)) {
        return { ok: false, reason: `结构 span 的 canonical 含字符串字面量（须用内容 span）: ${JSON.stringify(s.canonical)}` };
      }
    }
  }
  if (contentPieces.length === 0) return { ok: false, reason: '无内容 span' };
  return { ok: true };
}
