import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import type { Module as AstModule } from '../../../src/types.js';
import { computeNodeIds } from '../../../src/nodeid/node-id-map.js';
import { verifyMapping } from '../../../src/mapping/mapping-ir.js';
import type { CandidateMapping, VerifiableNode } from '../../../src/mapping/mapping-ir.js';

/**
 * MappingIR verifier（ADR 0037 §4/§7）。
 *
 * <p>本测试钉的是**契约**：哪些映射机器能证明、哪些必须交人、哪些能证伪。
 * 不钉实现细节。
 */

/** 从真实源码建「nodeId → 节点」解析器，走完整编译链。 */
function resolverOf(src: string): {
  resolve: (id: string) => VerifiableNode | undefined;
  find: (kind: string, value?: unknown) => string;
} {
  const ir = JSON.parse(JSON.stringify(lowerModule(parse(lex(canonicalize(src))).ast as AstModule)));
  const ids = computeNodeIds(ir);

  // nodeId → 原始节点：按路径在 IR 上走一遍（nodeId 就是路径）
  const nodeAt = (id: string): Record<string, unknown> | undefined => {
    let cur: unknown = ir;
    for (const seg of id.slice(2).split('.')) {
      if (seg === '') continue;
      const m = /^([A-Za-z0-9_]+)(?:\{(.*)\}|\[(\d+)\])?$/.exec(seg);
      if (!m || cur === null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[m[1]!];
      if (m[2] !== undefined) {
        cur = (cur as Record<string, unknown>[]).find(e => e?.name === m[2] || e?.path === m[2]);
      } else if (m[3] !== undefined) {
        cur = (cur as unknown[])[Number(m[3])];
      }
    }
    return cur as Record<string, unknown> | undefined;
  };

  return {
    resolve: (id) => {
      const n = nodeAt(id);
      if (!n || typeof n.kind !== 'string') return undefined;
      // ★不能写 `name: n.name as string | undefined`：tsconfig 开了
      //   exactOptionalPropertyTypes，显式 undefined 与「属性缺席」是两回事。
      const out: VerifiableNode = { kind: n.kind, ...(n.value === undefined ? {} : { value: n.value }) };
      return typeof n.name === 'string' ? { ...out, name: n.name } : out;
    },
    find: (kind, value) => {
      for (const [id] of ids) {
        const n = nodeAt(id);
        if (n?.kind === kind && (value === undefined || n.value === value)) return id;
      }
      throw new Error(`语料里找不到 kind=${kind} value=${String(value)} 的节点`);
    },
  };
}

const POLICY = [
  'Module demo.approve.', '',
  'Rule approve given amount, produce:',
  '  If amount greater than 10000:',
  '    Return "REFER".',
  '  Otherwise:',
  '    Return "APPROVE".', '',
].join('\n');

const mapping = (text: string, nodeId: string, start = 0): CandidateMapping =>
  ({ span: { start, end: start + text.length }, text, nodeId });

describe('MappingIR verifier — 机器能证明的那一类', () => {
  it('★`"$10,000"` ↔ Int(10000)：跨越「人类书写 ↔ IR 值」的鸿沟', () => {
    // ADR §4 的原始场景。货币符号与千分位是人类惯例，IR 里只有 10000。
    const { resolve, find } = resolverOf(POLICY);
    const r = verifyMapping(mapping('$10,000', find('Int', 10000)), resolve);

    assert.strictEqual(r.verdict, 'VERIFIED',
      `应判 VERIFIED（这正是 MappingIR 的价值所在）。实际 ${r.verdict}：${r.reason}`);
  });

  it('字符串字面量按原值比较', () => {
    const { resolve, find } = resolverOf(POLICY);
    const r = verifyMapping(mapping('"REFER"', find('String', 'REFER')), resolve);
    assert.strictEqual(r.verdict, 'VERIFIED', r.reason);
  });

  it('★值矛盾必须 REJECTED，不得放过', () => {
    // 反向守卫：没有这条，verifier 可以退化成「一律 VERIFIED」，
    // 上面两条照样绿，而它就彻底没用了。
    const { resolve, find } = resolverOf(POLICY);
    const r = verifyMapping(mapping('$20,000', find('Int', 10000)), resolve);

    assert.strictEqual(r.verdict, 'REJECTED',
      `文本 20000 与节点值 10000 矛盾，必须证伪。实际 ${r.verdict}`);
    assert.match(r.reason, /矛盾/);
  });

  it('★带业务含义的映射一律交人，不猜（ADR §3）', () => {
    // `"requires approval"` ↔ 某个 If/Call 节点：机器证不了。
    // 判 REVIEW_REQUIRED 而**不是** REJECTED —— 那不是「错」，是「机器管不了」。
    const { resolve, find } = resolverOf(POLICY);
    const r = verifyMapping(mapping('requires approval', find('If')), resolve);

    assert.strictEqual(r.verdict, 'REVIEW_REQUIRED',
      `非精确值节点应交人复核，实际 ${r.verdict}：${r.reason}`);
  });

  it('★Double 不参与机械验证（源码文本与 IR 值不可逆）', () => {
    // 实测：`1.0` → number 1 → 回写 "1"；`1e3` → 1000。文本不可还原，
    // 机器无法证明「这段文本就是这个 Double」。故交人，而不是用近似规则假装能证。
    const r = verifyMapping(mapping('1.0', '$.fake'),
      () => ({ kind: 'Double', value: 1 }));

    assert.strictEqual(r.verdict, 'REVIEW_REQUIRED',
      `Double 应交人复核（不可逆），实际 ${r.verdict}：${r.reason}`);

    // ★必须断言**判定依据**，不只是判定结果。
    //   变异验证发现：把 Double 加进 EXACT_VALUE_KINDS 后，结论仍是
    //   REVIEW_REQUIRED —— 因为 parseLiteralFromText 里也没有 Double 分支，
    //   两层防御恰好重叠。只断言 verdict 的话，EXACT_VALUE_KINDS 这道门
    //   **结构上无法变红**（假门禁）。
    //   断言 reason 提到「不属于可机械证明的精确值字面量」才真正钉住那道门。
    assert.match(r.reason, /不属于可机械证明的精确值字面量/,
      `应因「kind 不在可验证清单」而交人，而不是因为「解析不出值」。实际：${r.reason}`);
  });

  it('★canonical 形态 ≠ 源码文本：`$10,000.00` 必须能验过 Decimal("10000")', () => {
    // 100.00m 在 IR 里是 value:"100"（尾随零被规范化）。
    // 若做字符串相等比较，这条会误判 REJECTED —— 一个数值上完全正确的映射。
    const r = verifyMapping(mapping('$10,000.00', '$.fake'),
      () => ({ kind: 'Decimal', value: '10000' }));

    assert.strictEqual(r.verdict, 'VERIFIED',
      `尾随零差异不应导致失败（必须按值比较而非按文本）。实际 ${r.verdict}：${r.reason}`);
  });

  it('★超安全整数的 Long 不得丢精度', () => {
    // 9007199254740993 一旦过一次 JS number 就变 …992（本仓实测踩过）。
    // verifier 全程字符串比较，必须验得过。
    const big = '9007199254740993';
    const ok = verifyMapping(mapping(big, '$.fake'),
      () => ({ kind: 'Long', value: big }));
    assert.strictEqual(ok.verdict, 'VERIFIED', ok.reason);

    // 且**差 1** 必须能被识别出来——若中途过了 number，这两个值会变得相等。
    const bad = verifyMapping(mapping('9007199254740992', '$.fake'),
      () => ({ kind: 'Long', value: big }));
    assert.strictEqual(bad.verdict, 'REJECTED',
      '相差 1 的大整数必须证伪 —— 若判 VERIFIED，说明中途经过了 JS number 并丢了精度。');
  });

  it('节点不存在 → REJECTED（不能静默当成「待复核」）', () => {
    const { resolve } = resolverOf(POLICY);
    const r = verifyMapping(mapping('$10,000', '$.decls{nonexistent}'), resolve);
    assert.strictEqual(r.verdict, 'REJECTED');
  });

  it('★span 与 text 必须自洽，否则双向导航会跳错位置', () => {
    const { resolve, find } = resolverOf(POLICY);
    const id = find('Int', 10000);

    // 区间宽度 3，但 text 长 7 —— span 指向的根本不是这段文本
    const inconsistent = verifyMapping(
      { span: { start: 0, end: 3 }, text: '$10,000', nodeId: id }, resolve);
    assert.strictEqual(inconsistent.verdict, 'REJECTED', inconsistent.reason);

    // 非法区间
    const bad = verifyMapping(
      { span: { start: 5, end: 5 }, text: '', nodeId: id }, resolve);
    assert.strictEqual(bad.verdict, 'REJECTED', bad.reason);
  });

  it('每条结论都必须给出依据（含 VERIFIED，便于审计复核）', () => {
    const { resolve, find } = resolverOf(POLICY);
    const r = verifyMapping(mapping('$10,000', find('Int', 10000)), resolve);
    assert.ok(r.reason.length > 0, 'VERIFIED 也必须说明依据，否则审计时无法复核。');
  });
});
