// Bard 方言：一个**自定义 Lexicon**，用 ADR 0022 的关键词别名机制（recognition-side aliases）
// 把 Aster 的结构关键词改写成吟游词，使 .ballad.aster 源码读起来就是一首谣曲，却仍由生产同款
// 引擎逐字编译执行。别名只在 canonicalize 阶段归一回规范拼写——Lexer/Parser/Core IR 完全不知
// 别名存在，故「别名版」与「规范版」编译到结构一致的 Core IR（见 keyword-aliases 测试）。
//
// 为了让源码尽量不像程序，本方言做了三件事（全部经 spike 实测可行，无需改 grammar）：
//   1. **类型全省**：Aster 的 `as Int` / `produce Text` 都可省——引擎从用法推断类型。
//      故诗里写 `Verse stars of n:`，不出现任何类型标注。
//   2. **拼接走中缀连词**：`+` 运算符本就能拼字符串，把 PLUS 别名成 `then`，于是嵌套的
//      `Text.concat(Text.concat(a, b), c)` 变成左结合中缀 `a then b then c`，读如诗句相续。
//   3. **绑定去重 be**：`Let <name> be <expr>` 里 `be` 是固定关键词 BE；把 LET 别名成 `let`、
//      BE 留作 `be`，得到自然的 `let earlier be …`（旧版 LET→"let there be" 造成双 be）。
//
// 仍无法藏起的两处「代码痕」（受限于当前 grammar，非别名能解）：
//   - 函数调用必须带括号：`stars(n less 1)`（parser 硬要求 `(`）。
//   - 语句必须以句号 `.` 收尾（parser 硬要求 DOT；但句号本就像诗的收束/顿）。
//   - 数字必须是阿拉伯数字字面量：`past 18` / `but 1`（无英文数词支持）。
//
// 规范 ←→ Bard 别名 对照：
//   Module→Ballad  Rule→Verse  given→of  Let→let  be→be  If→where  Return→sing
//   plus(+)→then(拼接)  at most→but(≤)  at least→past(≥)  minus→less(−)
import { compile, evaluate, EN_US, initializeAllBundledLexicons } from '../../dist/src/browser.js';
import { SemanticTokenKind as K } from '../../dist/src/config/token-kind.js';

initializeAllBundledLexicons();

/** Bard（English）Lexicon：在 en-US 上叠加吟游别名，规范拼写不动。 */
export const BARD_EN = {
  ...EN_US,
  id: 'bard-en',
  name: 'Bard (English)',
  aliases: {
    [K.MODULE_DECL]: ['Ballad'],
    [K.FUNC_TO]: ['Verse'],
    [K.FUNC_GIVEN]: ['of'],
    [K.LET]: ['let'],
    [K.BE]: ['become'],
    [K.IF]: ['where'],
    [K.RETURN]: ['sing'],
    [K.MATCH]: ['behold'],
    [K.WHEN]: ['as'],
    [K.PLUS]: ['then'],
    [K.AT_MOST]: ['but'],
    [K.AT_LEAST]: ['past'],
    [K.MINUS_WORD]: ['less'],
  },
};

/**
 * NIGHTFALL_EN — a second dialect where the **source itself reads as a poem**, not just its
 * output (the goal of nightfall.ballad.aster). Different alias choices than BARD_EN so each
 * source line scans as a line of verse:
 *   Module→Nightfall  Rule→I  given→count  If→while  Return→sing  Let→let  be→be
 *   plus→with(join)  minus→less  at most→but
 * Read nightfall.ballad.aster top-to-bottom — it is a poem; it also compiles and runs
 * (recursively gathering the lights one by one). The last seam — the recursive call's
 * parentheses `gather(stars less 1)` — is now hidden too: ADR 0027's paren-free call
 * `apply <fn> to <arg>`, with APPLY aliased to the verse word `echoing`, turns the line into
 * `echoing gather to stars less 1` (the recursion lowers to the identical Call IR as before).
 */
export const NIGHTFALL_EN = {
  ...EN_US,
  id: 'nightfall-en',
  name: 'Nightfall (English)',
  aliases: {
    [K.MODULE_DECL]: ['Nightfall'],
    [K.FUNC_TO]: ['I'],
    [K.FUNC_GIVEN]: ['count'],
    [K.IF]: ['while'],
    [K.RETURN]: ['sing'],
    [K.LET]: ['let'],
    [K.BE]: ['be'],
    [K.PLUS]: ['with'],
    [K.MINUS_WORD]: ['less'],
    [K.AT_MOST]: ['but'],
    // ADR 0027：无括号单参调用引入词，别名成诗词 `echoing`（回响）——递归=回响。
    [K.APPLY]: ['echoing'],
  },
};

/**
 * 把一段方言源码编译成 Core IR。失败时抛出可读错误（含诊断）。
 * @param {string} source ballad 源码
 * @param {object} [lexicon] 方言（默认 BARD_EN；nightfall 用 NIGHTFALL_EN）
 * @returns {import('../../dist/src/types.js').Core.Module}
 */
export function compileBallad(source, lexicon = BARD_EN) {
  const result = compile(source, { lexicon });
  if (!result.success || !result.core) {
    const diags = (result.parseErrors ?? []).map((e) => e.message).join('; ');
    throw new Error(`ballad failed to compile: ${diags || 'unknown error'}`);
  }
  return result.core;
}

/**
 * 通用吟诵：编译 + 执行给定 verse（入口）于给定上下文，返回成诗的文本行。
 * @param {string} source ballad 源码
 * @param {string} entry 入口 verse 名（如 seasong / gather）
 * @param {Record<string, unknown>} context 入参（如 { phase } / { stars }）
 * @param {object} [lexicon] 方言（默认 BARD_EN）
 * @returns {string}
 */
export function reciteVerse(source, entry, context, lexicon = BARD_EN) {
  const core = compileBallad(source, lexicon);
  const ev = evaluate(core, entry, context);
  if (!ev.success) throw new Error(`ballad failed to recite ${entry}: ${ev.error}`);
  return String(ev.value);
}
