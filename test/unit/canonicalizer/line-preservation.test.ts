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
 * ## 状态：已修复（2026-09-12）
 *
 * 曾经的缺陷：`canonicalize` 用 `/^\s+$/gm` 清空「只含空白的行」，而 `\s`
 * **包含 `\n`**，于是连续空行被当成一整块匹配掉、折叠成一个空串：
 *
 * ```
 * 'A.\n\n\n\n\nB.\n'  (7 行)  →  'A.\n\nB.\n'  (4 行)
 * ```
 *
 * 注释先于该步被置空，所以任何 ≥2 行的注释块/空行块都会让其后**所有**行号整体
 * 上移。实证语料 `test_claims.aster` 经 canonicalize 由 115 行降到 91 行，首个
 * declaration 从第 27 行跑到第 3 行（Java 侧保留行数，一直是对的）。
 *
 * 修法：`/^[^\S\n]+$/gm` —— 空白但排除换行，逐行生效、行数不变。
 *
 * ★该缺陷**不限于注释头**：声明之间出现连续两个空行同样会让 span 脱节。
 *   下面的用例覆盖了这两种形态。
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

  it('基线：无空行时行数不变', () => {
    assertLinePreserved('Module x.\nDefine Y has a.\n', '无空行');
  });

  it('基线：单个空行时行数不变', () => {
    assertLinePreserved('Module x.\n\nDefine Y has a.\n', '单空行');
  });

  it('连续空行不得被折叠', () => {
    // 修复前实测：7 行 → 4 行
    assertLinePreserved('Module x.\n\n\n\n\nDefine Y has a.\n', '连续 4 空行');
  });

  it('注释块不得改变其后代码的行号', () => {
    // 修复前实测：5 行 → 3 行（注释先被置空，再被「连续空行折叠」吃掉）。
    assertLinePreserved('# a\n# b\n# c\nModule x.\n', '3 行注释头');
  });

  it('注释头后的声明行号必须与原文一致', () => {
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
