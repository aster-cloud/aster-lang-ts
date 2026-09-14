import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { lex } from '../../../src/frontend/lexer.js';

/**
 * UTF-8 BOM（U+FEFF）处理（issue core#158）。
 *
 * <h2>为什么 TS 侧也要改</h2>
 *
 * TS 一直在剥 BOM，Java 侧从未剥过——这本身是双引擎分叉。但修 Java 时实测发现，
 * TS 的剥离**会递增列号**（`i++; col++`），于是带 BOM 的文件里所有 token 的
 * 列号整体 +1。把 Java 修成「不进位」之后，两边反而在另一个方向上不一致了。
 *
 * 取「不进位」为准：BOM 是**编码标记**，不是源码内容，不该占一列。
 * 列号偏移会带歪诊断位置、span 与 IDE 高亮——而 ProofIR 的 span 是签字锚定
 * 的一部分，不是可以随手偏一列的东西。
 */
describe('UTF-8 BOM', () => {
  const BOM = '\uFEFF';
  const SRC = 'Module demo.\n';

  test('BOM 不得让首 token 的列号偏移', () => {
    const withBom = lex(BOM + SRC);
    const without = lex(SRC);

    assert.ok(without.length > 0, '前置失败：没有产出任何 token');
    assert.equal(
      withBom[0]!.start.col,
      without[0]!.start.col,
      '带 BOM 时首 token 列号发生了偏移（BOM 是编码标记，不该占一列）',
    );
    assert.equal(withBom[0]!.end.col, without[0]!.end.col);
  });

  test('带 BOM 与不带 BOM 产出逐个相同的 token（含位置）', () => {
    const shape = (ts: readonly { kind: string; value: string;
                                  start: { line: number; col: number } }[]) =>
      ts.map((t) => `${t.kind}:${t.value}@${t.start.line}:${t.start.col}`);

    const withBom = shape(lex(BOM + SRC) as never);
    const without = shape(lex(SRC) as never);

    // 前置：夹具确实产出了 token，否则相等断言在空表上恒真。
    assert.ok(without.length >= 3, `前置失败：只产出 ${without.length} 个 token`);
    assert.deepEqual(withBom, without);
  });

  test('★正文中的 U+FEFF 原样保留（只剥首字符）', () => {
    // 反向守卫：别把剥离写成全文替换。字符串字面量里的 U+FEFF 是**用户数据**，
    // 剥掉就是篡改内容。
    const src = `Module demo.\n\nDefine rule r:\n    Return "a${BOM}b".\n`;
    const kept = lex(src).some(
      (t) => typeof t.value === 'string' && t.value.includes(BOM),
    );

    assert.ok(kept, '字符串字面量内的 U+FEFF 属用户数据，不得被剥离');
  });

  test('无 BOM 的源码不受影响（剥离不得误吃首字符）', () => {
    const tokens = lex(SRC);

    assert.ok(tokens.length > 0);
    assert.equal(tokens[0]!.value, 'Module');
    assert.equal(tokens[0]!.start.col, 1);
  });
});
