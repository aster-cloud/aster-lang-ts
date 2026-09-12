import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import type { Module as AstModule } from '../../../src/types.js';
import { computeNodeIds } from '../../../src/nodeid/node-id-map.js';
import { generateCandidates, collectLiteralNodes } from '../../../src/mapping/candidate-generator.js';
import { verifyMapping } from '../../../src/mapping/mapping-ir.js';

/**
 * 确定性候选映射生成器（ADR 0037 §3/§7）。
 *
 * <p>核心主张：对 `.aster` 源码，「哪段文本对应哪个 IR 节点」**不需要 AI**——
 * `origin` 就是答案。本测试用全语料闭环证明这一点。
 */

const CORPUS = '/Users/rpang/IdeaProjects/aster-lang-test/corpus/tier1-equivalence/policies';

const irOf = (src: string) =>
  JSON.parse(JSON.stringify(lowerModule(parse(lex(canonicalize(src))).ast as AstModule)));

const POLICY = [
  'Module demo.approve.', '',
  'Rule approve given amount, produce:',
  '  If amount greater than 10000:',
  '    Return "REFER".', '',
].join('\n');

describe('确定性候选生成器', () => {
  it('★候选的 text 必须逐字节等于源码切片（不是重新渲染出来的）', () => {
    const { candidates, skipped } = generateCandidates(POLICY, collectLiteralNodes(irOf(POLICY)));

    assert.strictEqual(skipped.length, 0, `不应有跳过，实际：${JSON.stringify(skipped)}`);
    assert.ok(candidates.length > 0, '应生成候选。');

    for (const c of candidates) {
      assert.strictEqual(c.text, POLICY.slice(c.span.start, c.span.end),
        `候选 text 与 span 切片不符 —— 说明 text 不是从源码切出来的。nodeId=${c.nodeId}`);
    }
  });

  it('★候选的 nodeId 必须与 NodeIdMap 一致（否则 verifier 查不到节点）', () => {
    const ir = irOf(POLICY);
    const ids = computeNodeIds(ir);
    const { candidates } = generateCandidates(POLICY, collectLiteralNodes(ir));

    for (const c of candidates) {
      assert.ok(ids.has(c.nodeId),
        `候选的 nodeId 不在 NodeIdMap 里：${c.nodeId}`
        + '\n★两处的路径构造规则必须逐字一致，否则生成的候选无法被 verifier 解析。');
    }
  });

  it('★`_` 是占位符不是名字：多条裸表达式语句不得塌成同一个 nodeId', () => {
    // 裸表达式语句一律降为 `Let "_" be expr`。若拿 `_` 当路径段，同一函数体里
    // 的多条会全部变成 `statements{_}` —— nodeId 撞车，Map 只留最后一条，
    // 其余节点的身份**静默消失**。实测曾在 1 个样本上丢 4 个节点。
    const src = [
      'Module m.', '',
      'Rule f, produce. It performs io:',
      '  Io.write("a").',
      '  Io.write("b").',
      '  Return 1.', '',
    ].join('\n');

    const ir = irOf(src);
    const ids = computeNodeIds(ir);

    let realNodes = 0;
    (function walk(x: unknown): void {
      if (x !== null && typeof x === 'object') {
        if (typeof (x as { kind?: unknown }).kind === 'string') realNodes++;
        Object.values(x as Record<string, unknown>).forEach(walk);
      }
    })(ir);

    assert.strictEqual(ids.size, realNodes,
      `nodeId 数(${ids.size}) 少于真实节点数(${realNodes}) —— 存在身份碰撞，`
      + '有节点的身份被静默覆盖了。');

    // 且两条 Io.write 的字符串字面量必须是**不同**的候选
    const { candidates } = generateCandidates(src, collectLiteralNodes(ir));
    const texts = candidates.map(c => c.text);
    assert.ok(texts.includes('"a"') && texts.includes('"b"'),
      `两条裸表达式的字面量都应生成候选，实际：${JSON.stringify(texts)}`);
  });

  it('★越界 / 零宽 origin 必须跳过并报告，不得编造候选', () => {
    const r = generateCandidates('short', [
      { nodeId: '$.oob', kind: 'Int', origin: { start: { line: 99, col: 1 }, end: { line: 99, col: 5 } } },
      { nodeId: '$.zero', kind: 'Int', origin: { start: { line: 1, col: 3 }, end: { line: 1, col: 3 } } },
    ]);

    assert.strictEqual(r.candidates.length, 0, '不应为非法 origin 编造候选。');
    assert.strictEqual(r.skipped.length, 2, '两个非法节点都必须被报告。');
    // ★必须**报告**而非静默丢弃：静默跳过会让调用方以为「全都生成了」。
    assert.ok(r.skipped.every(s => s.why.length > 0), '每条跳过都要说明原因。');

    // ★断言**跳过的原因**，不只是跳过的条数。
    //   变异验证发现：零宽区间若不被 `end <= start` 拦下，也会被后面的
    //   「切片为空白」兜住——**两层防御恰好重叠**，只数条数根本测不出
    //   是哪一层在起作用，`end <= start` 那道门因此结构上无法变红。
    const zeroWidth = r.skipped.find(s => s.nodeId === '$.zero');
    assert.match(zeroWidth?.why ?? '', /零宽/,
      `零宽区间应由区间检查拦下（而非被「切片为空白」兜住）。实际：${zeroWidth?.why}`);
    const outOfBounds = r.skipped.find(s => s.nodeId === '$.oob');
    assert.match(outOfBounds?.why ?? '', /超出源码范围/, `实际：${outOfBounds?.why}`);
  });

  it('★全语料闭环：生成的候选必须能被 verifier 判定，且零 REJECTED', () => {
    // 这是本模块的核心主张：机械生成 + 机械验证 = 零误差闭环。
    // 若出现 REJECTED，说明生成器切错了位置（候选文本与节点值对不上）。
    let generated = 0, skipped = 0, verified = 0, rejected = 0, review = 0;
    const rejectSamples: string[] = [];

    for (const f of readdirSync(CORPUS).filter(x => x.endsWith('.aster'))) {
      const src = readFileSync(`${CORPUS}/${f}`, 'utf8');
      let ir: Record<string, unknown>;
      try { ir = irOf(src); } catch { continue; }

      const nodes = collectLiteralNodes(ir);
      const r = generateCandidates(src, nodes);
      generated += r.candidates.length;
      skipped += r.skipped.length;

      // 用 NodeIdMap 的 kind + 原 IR 的 value 做解析
      const byId = new Map(nodes.map(n => [n.nodeId, n]));
      const values = valueIndex(ir);

      for (const c of r.candidates) {
        const node = byId.get(c.nodeId);
        const val = values.get(c.nodeId);
        if (!node || val === undefined) continue;
        const v = verifyMapping(c, () =>
          (val.value === undefined ? { kind: val.kind } : { kind: val.kind, value: val.value }));
        if (v.verdict === 'VERIFIED') verified++;
        else if (v.verdict === 'REVIEW_REQUIRED') review++;
        else { rejected++; if (rejectSamples.length < 3) rejectSamples.push(`${c.text} → ${v.reason}`); }
      }
    }

    assert.ok(generated > 1000, `应在全语料上生成大量候选，实际 ${generated}`);
    assert.strictEqual(skipped, 0, '全语料上不应有跳过（若有，说明 origin 有缺口）。');
    assert.strictEqual(rejected, 0,
      `机械生成的候选不应被证伪（${rejected} 条 REJECTED）——说明切片位置错了。`
      + `\n样例：${rejectSamples.join(' | ')}`);
    assert.ok(verified > generated * 0.9,
      `绝大多数候选应可被机械证明，实际 ${verified}/${generated}（REVIEW_REQUIRED ${review}）。`);
  });
});

/** nodeId → {kind, value}，路径规则与生成器逐字一致。 */
function valueIndex(ir: unknown): Map<string, { kind: string; value: unknown }> {
  const out = new Map<string, { kind: string; value: unknown }>();
  (function walk(node: unknown, path: string): void {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.kind === 'string' && 'value' in obj) {
      out.set(path, { kind: obj.kind, value: obj.value });
    }
    for (const [field, value] of Object.entries(obj)) {
      if (field === 'origin') continue;
      if (Array.isArray(value)) {
        value.forEach((el, i) => walk(el, `${path}.${field}${seg(el, i)}`));
      } else {
        walk(value, `${path}.${field}`);
      }
    }
  })(ir, '$');
  return out;
}

function seg(el: unknown, i: number): string {
  if (el !== null && typeof el === 'object' && !Array.isArray(el)) {
    const e = el as Record<string, unknown>;
    if (typeof e.name === 'string' && e.name !== '_') return `{${e.name}}`;
    if (typeof e.path === 'string') return `{${e.path}}`;
  }
  return `[${i}]`;
}
