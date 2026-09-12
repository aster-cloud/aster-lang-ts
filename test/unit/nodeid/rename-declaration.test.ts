import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import type { Module as AstModule } from '../../../src/types.js';
import { computeNodeIds } from '../../../src/nodeid/node-id-map.js';
import { diffNodeIds, rename } from '../../../src/nodeid/change-impact.js';

/**
 * 显式 rename 声明（ADR 0037 §8.5 最后一项未决，与 Java 侧对等）。
 *
 * 命名作用域路径对重命名敏感：改一条规则的名字，其整棵子树的 nodeId 全变。
 * 实测 16 节点样本 → 31 条变更，而其中 14 个节点内容逐字节未变。
 */

const V1 = [
  'Module demo.approve.', '',
  'Rule approve given amount, produce:',
  '  If amount greater than 10000:',
  '    Return "REFER".',
  '  Otherwise:',
  '    Return "APPROVE".', '',
].join('\n');

const idsOf = (src: string) =>
  computeNodeIds(JSON.parse(JSON.stringify(lowerModule(parse(lex(canonicalize(src))).ast as AstModule))));

describe('显式 rename 声明（TS 侧）', () => {
  it('★声明后子树身份整体迁移，REMOVED/ADDED 噪声归零', () => {
    const v2 = V1.replace('Rule approve given amount', 'Rule assess given amount');
    assert.notStrictEqual(v2, V1, '★replace 未生效则本用例无效。');

    const before = idsOf(V1), after = idsOf(v2);
    const noiseBefore = diffNodeIds(before, after).filter(c => c.kind !== 'MODIFIED').length;
    const noiseAfter = diffNodeIds(before, after, [rename('approve', 'assess')])
      .filter(c => c.kind !== 'MODIFIED').length;

    assert.ok(noiseBefore > 0, '未声明时应存在 REMOVED/ADDED 噪声（问题本身）。');
    assert.strictEqual(noiseAfter, 0, `声明后不应再有 REMOVED/ADDED，实际 ${noiseAfter} 条。`);
  });

  it('★真实改动仍被报告（反向守卫：声明不得吞掉一切）', () => {
    // 没有这条，「声明重命名」可以退化成「把所有变更都吞掉」，上面那条照样绿。
    const v2 = V1
      .replace('Rule approve given amount', 'Rule assess given amount')
      .replace('10000', '20000');

    const changes = diffNodeIds(idsOf(V1), idsOf(v2), [rename('approve', 'assess')]);

    assert.ok(changes.some(c => c.kind === 'MODIFIED'), '阈值确实改了，必须仍报 MODIFIED。');
    assert.ok(changes.some(c => c.staleAncestors.some(a => a.includes('{assess}'))),
      '受影响的规则应以**新**名字出现在 staleAncestors 里。');
  });

  it('★contentHash 不唯一 —— 自动配对不可靠的依据', () => {
    const ids = idsOf(['Module m.', '', 'Rule alpha, produce:', '  Return 1.', '',
      'Rule beta, produce:', '  Return 1.', ''].join('\n'));

    const a = ids.get('$.decls{alpha}.body');
    const b = ids.get('$.decls{beta}.body');
    assert.ok(a && b, '未找到被测节点，测试失去对象。');
    assert.strictEqual(a!.contentHash, b!.contentHash,
      '两条同体规则的 body 应有相同 contentHash。'
      + '\n★若本条变红，说明 hash 已唯一，届时可重新评估自动配对方案。');
  });

  it('只替换完整路径段，不做子串误伤（approve 不碰 approveAll）', () => {
    const src = ['Module m.', '', 'Rule approve, produce:', '  Return 1.', '',
      'Rule approveAll, produce:', '  Return 2.', ''].join('\n');
    const renamed = src.replace('Rule approve,', 'Rule assess,');
    assert.notStrictEqual(renamed, src, '★构造未生效则本用例无效。');

    const changes = diffNodeIds(idsOf(src), idsOf(renamed), [rename('approve', 'assess')]);

    assert.ok(!changes.some(c => c.nodeId.includes('approveAll')),
      `approveAll 未被修改，不应出现在变更里 —— 多半是把 approve 当子串误伤了。实际：${JSON.stringify(changes)}`);
    assert.ok(changes.every(c => c.kind === 'MODIFIED'), '声明后不应再有 REMOVED/ADDED。');
  });

  it('自相矛盾的声明直接拒绝', () => {
    assert.throws(
      () => diffNodeIds(idsOf(V1), idsOf(V1), [rename('approve', 'assess'), rename('approve', 'review')]),
      /多个目标/, '同一名字声明到两个目标，应当拒绝而非静默取其一。');
  });

  it('非法 Rename 构造直接拒绝', () => {
    assert.throws(() => rename('', 'x'), /不能为空/);
    assert.throws(() => rename('x', ' '), /不能为空/);
    assert.throws(() => rename('same', 'same'), /相同/);
  });

  it('不传 renames 时与旧行为一致（向后兼容）', () => {
    const v2 = V1.replace('10000', '20000');
    assert.deepStrictEqual(diffNodeIds(idsOf(V1), idsOf(v2)),
      diffNodeIds(idsOf(V1), idsOf(v2), []));
  });
});
