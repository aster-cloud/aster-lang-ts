import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';

/**
 * canonicalize 的**行数保持**契约。
 *
 * ## 为什么这是一条契约而不是实现细节
 *
 * Core IR 的 `origin.start.line` / `end.line` 指的是 **canonical 文本**的行号。
 * 下游有两个消费者依赖它与**用户原文**行号一一对应：
 *
 * - **ADR 0032**：把执行 trace 的每一步锚定到源码位置，让「点击 trace 步骤
 *   跳转到源码」成立；
 * - **ADR 0037**：在其上建 OriginMap / MappingIR（文本 span ↔ IR 节点的双向导航）。
 *
 * 只要 canonicalize 吞掉任何一行，这两者都会**静默跳到错误的行**——不报错、
 * 不崩溃，只是指错地方。这正是 ADR 0032 当初要解决的那类静默错误。
 *
 * ## 当前状态：本契约**尚未满足**（已知缺陷）
 *
 * TS 侧会把**连续空行折叠成一行**，而注释在此之前已被置空，于是任何
 * ≥2 行的注释块都会让其后所有行号整体偏移：
 *
 * ```
 * '# a\n# b\n# c\nModule x.\n'  →  '\nModule x.\n'   5 行 → 3 行
 * ```
 *
 * 实证（`aster-lang-test` 语料 `test_claims.aster`，24 行注释头）：
 * 首个 declaration 原文在第 27 行，Java 报 27（正确），TS 报 3（偏移 −24）。
 * Java 侧 canonicalizer 把注释置空但**保留行数**（115 → 115），故 Java 正确。
 *
 * ★注意：该缺陷**不限于注释头**。声明之间出现连续两个空行就足以让 TS 的
 *   span 与真实源码脱节。
 *
 * ## 这些测试为什么现在是 `skip`
 *
 * 它们描述的是**目标契约**，不是当前行为。直接让它们失败会把一条既有缺陷
 * 变成全仓 CI 红灯，拦住与之无关的 PR。标 skip 并在此写明判据，等修复 TS
 * 行号后**去掉 skip 即为验收**——而不是把契约留在某个人的记忆里。
 *
 * 跨引擎侧的对应守卫见 `aster-lang-test` 的 `IR-DIVERGENCE-LEDGER.md`
 * 与 `parity-tier1.mjs` 的 `divergent-known-origin-line`（窄口径豁免）。
 */
describe('canonicalize 行数保持契约（ADR 0032 / 0037）', () => {
  /** canonicalize 前后的行数必须一致。 */
  function assertLinePreserved(src: string, label: string): void {
    const out = canonicalize(src);
    const before = src.split('\n').length;
    const after = out.split('\n').length;
    assert.equal(
      after,
      before,
      `${label}：canonicalize 改变了行数（${before} → ${after}）。`
        + `\n每丢一行，origin.line 就整体偏移一行，ADR 0032 的 trace 锚点会静默指错位置。`
        + `\n输出：${JSON.stringify(out)}`,
    );
  }

  it('基线：无空行时行数不变（当前已满足）', () => {
    assertLinePreserved('Module x.\nDefine Y has a.\n', '无空行');
  });

  it('基线：单个空行时行数不变（当前已满足）', () => {
    assertLinePreserved('Module x.\n\nDefine Y has a.\n', '单空行');
  });

  it.skip('【已知缺陷】连续空行不得被折叠', () => {
    // 实测：7 行 → 4 行
    assertLinePreserved('Module x.\n\n\n\n\nDefine Y has a.\n', '连续 4 空行');
  });

  it.skip('【已知缺陷】注释块不得改变其后代码的行号', () => {
    // 实测：5 行 → 3 行。注释先被置空，再被「连续空行折叠」吃掉。
    assertLinePreserved('# a\n# b\n# c\nModule x.\n', '3 行注释头');
  });

  it.skip('【已知缺陷】注释头后的声明行号必须与原文一致', () => {
    const header = Array.from({ length: 24 }, (_, i) => `# comment ${i + 1}`).join('\n');
    const src = `${header}\nModule x.\nDefine Claim has amount.\n`;
    const out = canonicalize(src);

    const srcLine = src.split('\n').findIndex((l) => l.startsWith('Define ')) + 1;
    const outLine = out.split('\n').findIndex((l) => l.startsWith('Define ')) + 1;

    assert.equal(
      outLine,
      srcLine,
      `注释头后的 declaration 行号发生偏移：原文 @${srcLine}，canonical @${outLine}`
        + `（偏移 ${outLine - srcLine}）。这会让 trace 跳转落在错误的行。`,
    );
  });
});
