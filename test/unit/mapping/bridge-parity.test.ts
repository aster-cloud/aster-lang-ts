import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { runSemanticBridge } from '../../../src/mapping/pipeline.js';

/**
 * 双引擎**主链路**输出一致性 —— TS 侧（ADR 0037 §7 扩展）。
 *
 * <h2>★与 `verdict-parity.test.ts` 的区别</h2>
 *
 * - `verdict-parity` 钉的是 verifier 对**单条候选**的判定
 * - **本文件**钉的是**整条主链路**的输出：文档结构 + 数量 + 候选 + 判定
 *
 * <h2>为什么需要它</h2>
 *
 * §7 只要求 verifier 判定一致，但**能力**是另一回事——
 * 只用 Java 引擎的用户同样需要语义桥。两侧都接线后，就必须证明
 * 「同一份文档，两个引擎给出同样的结构、同样的数量、同样的候选与判定」。
 *
 * <p>★语料**单源**：Java 侧 `SemanticBridgeParityTest` 读同一文件。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** ★两种布局都要支持：CI 检出到工作区内 / 本地兄弟仓并列。 */
const CORPUS = ((): string => {
  const rel = 'corpus/mapping-verdict/bridge-cases.json';
  for (const base of [
    resolve(HERE, '../../../../aster-lang-test'),
    resolve(HERE, '../../../../../aster-lang-test'),
  ]) {
    const p = resolve(base, rel);
    if (existsSync(p)) return p;
  }
  return resolve(HERE, '../../../../../aster-lang-test', rel);
})();

interface BridgeCase {
  readonly name: string;
  readonly source: string;
  readonly expectSummary: { verified: number; reviewRequired: number; rejected: number };
  readonly expectCandidates: ReadonlyArray<{
    verdict: string; text: string; nodeId: string; start: number; end: number;
  }>;
  readonly expectQuantities: ReadonlyArray<{
    kind: string; text: string; start: number; end: number; value: string;
  }>;
  readonly expectDiagnosticContains?: string;
}

describe('双引擎主链路输出一致性 — TS 侧', () => {
  it('★语料必须存在（缺失即门禁失效，不得静默跳过）', () => {
    assert.ok(existsSync(CORPUS),
      `共享语料不存在：${CORPUS}\n`
      + '★本门禁依赖 aster-lang-test 的 checkout。路径变更须同步改两侧。');
  });

  it('★主链路输出必须与语料声明逐字段一致', () => {
    const raw = JSON.parse(readFileSync(CORPUS, 'utf8')) as { cases: readonly BridgeCase[] };
    assert.ok(raw.cases.length >= 2, `语料用例过少（${raw.cases.length}）。`);

    for (const c of raw.cases) {
      const r = runSemanticBridge(c.source);

      assert.deepStrictEqual(
        { verified: r.summary.verified, reviewRequired: r.summary.reviewRequired,
          rejected: r.summary.rejected },
        c.expectSummary,
        `用例「${c.name}」的 summary 不符。\n诊断：${r.diagnostics.join(' | ')}`);

      const actualCands = r.verified.map(v => ({
        verdict: v.result.verdict, text: v.mapping.text, nodeId: v.mapping.nodeId,
        start: v.mapping.span.start, end: v.mapping.span.end,
      }));
      assert.deepStrictEqual(actualCands, c.expectCandidates.map(x => ({ ...x })),
        `用例「${c.name}」的候选不符。\n`
        + '★若 Java 侧同用例输出不同，即两引擎主链路已分叉。');

      const actualQtys = r.quantities.map(q => ({
        kind: q.kind, text: q.text, start: q.span.start, end: q.span.end, value: q.value,
      }));
      assert.deepStrictEqual(actualQtys, c.expectQuantities.map(x => ({ ...x })),
        `用例「${c.name}」的数量抽取不符。`);

      if (c.expectDiagnosticContains !== undefined) {
        assert.ok(r.diagnostics.some(d => d.includes(c.expectDiagnosticContains!)),
          `用例「${c.name}」应报出含「${c.expectDiagnosticContains}」的诊断。\n`
          + `实际：${JSON.stringify(r.diagnostics)}`);
      }
    }
  });

  it('★语料必须同时覆盖「可编译」与「不可编译」两种形态', () => {
    // 反向守卫：只覆盖可编译源码的语料，证明不了分层降级的正确性；
    // 只覆盖不可编译文档的语料，证明不了候选/验证层的一致性。
    const raw = JSON.parse(readFileSync(CORPUS, 'utf8')) as { cases: readonly BridgeCase[] };
    assert.ok(raw.cases.some(c => c.expectCandidates.length > 0),
      '语料缺少「可编译源码」用例——候选/验证层未被覆盖。');
    assert.ok(raw.cases.some(c => c.expectQuantities.length > 0
      && c.expectCandidates.length === 0),
      '语料缺少「不可编译文档」用例——分层降级未被覆盖。');
  });
});
