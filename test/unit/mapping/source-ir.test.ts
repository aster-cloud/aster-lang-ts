import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSourceIr, verifyCoverage, nodeAtOffset } from '../../../src/mapping/source-ir.js';
import type { SourceNode } from '../../../src/mapping/source-ir.js';
import { verifyMapping } from '../../../src/mapping/mapping-ir.js';

/**
 * SourceIR（ADR 0037 §2/§9.5）—— 人类文档的结构化表示。
 *
 * <p>核心契约：**只标结构，不改内容**。每个节点的 span 必须能逐字节切回原文，
 * 且父必须覆盖子——这两条是「点击原文 ↔ 定位 IR 节点」的前提。
 */

const POLICY = [
  '# 付款审批政策', '',
  '## 阈值', '',
  '单笔付款超过 $10,000 时需要财务经理审批。', '',
  '- 低于阈值：自动通过', '',
  '- 高于阈值：转人工', '',
  '## 例外', '',
  '紧急付款可事后补批。', '',
].join('\n');

function allNodes(root: SourceNode): SourceNode[] {
  const out: SourceNode[] = [];
  (function walk(n: SourceNode): void { out.push(n); n.children.forEach(walk); })(root);
  return out;
}

describe('SourceIR — 人类文档的结构化表示', () => {
  it('★每个节点的 span 必须能逐字节切回原文（不做任何改写）', () => {
    const ir = parseSourceIr(POLICY);
    assert.deepStrictEqual(verifyCoverage(ir, POLICY), [],
      '覆盖不变式被破坏 —— span 切片与 text 不符或存在重叠。');

    for (const n of allNodes(ir)) {
      assert.strictEqual(n.text, POLICY.slice(n.span.start, n.span.end),
        `${n.nodeId} 的 text 不等于 span 切片 —— 说明做了文本改写。`);
    }
  });

  it('★标题层级必须嵌套（`##` 归到 `#` 之下）', () => {
    const ir = parseSourceIr(POLICY);

    assert.strictEqual(ir.children.length, 1,
      `顶层应只有一个 \`# \` 标题节点，实际 ${ir.children.length} 个 —— 嵌套没建起来。`);
    const h1 = ir.children[0]!;
    assert.strictEqual(h1.level, 1);

    const h2s = h1.children.filter(c => c.kind === 'HEADING');
    assert.strictEqual(h2s.length, 2, '`## 阈值` 与 `## 例外` 都应挂在 `#` 之下。');
    assert.ok(h2s.every(h => h.level === 2));
  });

  it('★父的 span 必须覆盖子（否则 nodeAtOffset 无法下降）', () => {
    // 这是我实际踩过的 bug：HEADING 原本只覆盖标题那一行，其子段落在父之外，
    // 于是「点击 $10,000 定位所在节点」返回 DOCUMENT 而不是那个段落。
    const ir = parseSourceIr(POLICY);

    for (const n of allNodes(ir)) {
      for (const c of n.children) {
        assert.ok(c.span.start >= n.span.start && c.span.end <= n.span.end,
          `${c.nodeId} 不被父 ${n.nodeId} 包含：子 [${c.span.start},${c.span.end}) `
          + `父 [${n.span.start},${n.span.end})`);
      }
    }
  });

  it('★nodeAtOffset 返回**最深**的命中节点', () => {
    const ir = parseSourceIr(POLICY);
    const offset = POLICY.indexOf('$10,000');
    const hit = nodeAtOffset(ir, offset);

    assert.strictEqual(hit?.kind, 'PARAGRAPH',
      `应命中段落而非祖先，实际 ${hit?.kind}（${hit?.nodeId}）`
      + '\n★若返回 DOCUMENT/HEADING，说明包含不变式被破坏、无法逐层下降。');
    assert.ok(hit!.text.includes('$10,000'));
  });

  it('★verifyCoverage 必须能抓出错位的 span（否则它是个假门禁）', () => {
    // 反向守卫：手工构造一个 text 与 span 不符的节点，必须被抓。
    const bad: SourceNode = {
      nodeId: 'doc', kind: 'DOCUMENT', span: { start: 0, end: 5 },
      text: '完全不同的内容', children: [],
    };
    const problems = verifyCoverage(bad, POLICY);
    assert.ok(problems.length > 0, 'text 与 span 不符却没被抓到 —— 这道检查形同虚设。');
  });

  it('★围栏代码块内的空行不得把代码块撕开', () => {
    const doc = [
      '# 标题', '',
      '```', 'line1', '', 'line3', '```', '',
      '正文。', '',
    ].join('\n');

    const ir = parseSourceIr(doc);
    assert.deepStrictEqual(verifyCoverage(ir, doc), []);

    const codeBlocks = allNodes(ir).filter(n => n.kind === 'CODE_BLOCK');
    assert.strictEqual(codeBlocks.length, 1,
      `代码块应是一个整体节点，实际被切成 ${codeBlocks.length} 块。`);
    assert.ok(codeBlocks[0]!.text.includes('line1') && codeBlocks[0]!.text.includes('line3'),
      '代码块内容不完整 —— 空行处被切开了。');
  });

  it('★与 MappingIR 打通：SourceIR 的 offset 可直接做候选映射的 span', () => {
    // 这是 SourceIR 存在的理由：让 MappingIR 能吃**人类文档**而不只是 .aster。
    const ir = parseSourceIr(POLICY);
    const start = POLICY.indexOf('$10,000');
    const text = POLICY.slice(start, start + '$10,000'.length);

    // 该 offset 必须落在某个具体结构节点里（不是孤立的字符）
    assert.ok(nodeAtOffset(ir, start) !== undefined, 'offset 应落在某个 SourceIR 节点内。');

    const r = verifyMapping(
      { span: { start, end: start + text.length }, text, nodeId: '$.threshold' },
      () => ({ kind: 'Int', value: 10000 }));

    assert.strictEqual(r.verdict, 'VERIFIED',
      `人类文档里的 $10,000 应能验过 Int(10000)。实际 ${r.verdict}：${r.reason}`);
  });

  it('★文档首尾的空白必须原样保留（text 不得被 trim）', () => {
    // 反向守卫。★原先的样本 POLICY 首尾没有可 trim 的空白，于是给 freeze 加
    //   `.trim()` 这个变异**测不出来**——契约说「不改内容」，但没有样本能
    //   证伪它。这里显式构造首尾带空白的文档。
    const doc = '\n\n# 标题\n\n正文。\n\n   \n';
    const ir = parseSourceIr(doc);

    assert.deepStrictEqual(verifyCoverage(ir, doc), [],
      '首尾空白应原样保留 —— 若这里变红，多半是某处对 text 做了 trim/规范化。');
    assert.strictEqual(ir.text, doc,
      'DOCUMENT 的 text 必须逐字节等于原文（含首尾空白）。');
  });

  it('空文档与纯空白文档不崩', () => {
    for (const doc of ['', '   \n\n  \n']) {
      const ir = parseSourceIr(doc);
      assert.deepStrictEqual(verifyCoverage(ir, doc), [], `文档 ${JSON.stringify(doc)} 覆盖检查失败`);
      assert.strictEqual(ir.kind, 'DOCUMENT');
    }
  });

  it('nodeId 在文档内唯一（否则映射会指向多个节点）', () => {
    const ids = allNodes(parseSourceIr(POLICY)).map(n => n.nodeId);
    assert.strictEqual(new Set(ids).size, ids.length,
      `nodeId 有重复：${ids.filter((v, i) => ids.indexOf(v) !== i).join(', ')}`);
  });
});
