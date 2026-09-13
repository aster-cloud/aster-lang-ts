import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { verifyMapping, type VerifiableNode } from '../../../src/mapping/mapping-ir.js';

/**
 * 双引擎 verifier 判定一致性（ADR 0037 §7）—— **TS 侧**。
 *
 * <h2>★§7 的要求是有区分的</h2>
 *
 * <pre>
 *   LLM 生成的 candidate  →  **不要求**一致
 *   Verifier 的结果       →  **必须**一致
 * </pre>
 *
 * 故本文件只钉 `verdict`，**不钉 `reason`**（后者含自然语言，两侧措辞允许不同）。
 *
 * <h2>语料是**共享**的</h2>
 *
 * 用例来自 `aster-lang-test/corpus/mapping-verdict/cases.json`，
 * Java 侧 `MappingIrVerdictParityTest` 读**同一个文件**。
 * ★这是"单源"——若两侧各抄一份，语料会各自漂移，而"一致性门禁"
 * 本身就变成了两个互不相干的测试（本仓记过这个坑）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
// ★路径从**编译产物** dist/test/unit/mapping 起算（不是源码目录），故是 5 级。
//   我第一版按源码目录写了 4 级，测试直接红——路径类的东西必须实测，不能数目录。
const CORPUS = resolve(HERE, '../../../../../aster-lang-test/corpus/mapping-verdict/cases.json');

interface Case {
  readonly name: string;
  readonly mapping: { span: { start: number; end: number }; text: string; nodeId: string };
  readonly node: { kind: string; value?: unknown; name?: string } | null;
  readonly expect: 'VERIFIED' | 'REVIEW_REQUIRED' | 'REJECTED';
}

describe('双引擎 verifier 判定一致性 — TS 侧', () => {
  it('★语料文件必须存在（缺失即门禁失效，不得静默跳过）', () => {
    // ★若语料路径漂了而测试"跳过"，这条门禁就会在无人察觉的情况下消失。
    //   本仓记过「跳过看起来像通过」——此处显式断言存在性。
    assert.ok(existsSync(CORPUS),
      `共享语料不存在：${CORPUS}\n`
      + '★这条门禁依赖 aster-lang-test 作为兄弟仓 checkout。'
      + '若路径变了必须同步修改两侧（Java 侧同名测试读同一文件）。');
  });

  it('★每条用例的判定必须与语料声明一致', () => {
    const raw = JSON.parse(readFileSync(CORPUS, 'utf8')) as { cases: readonly Case[] };
    assert.ok(raw.cases.length >= 10,
      `语料用例过少（${raw.cases.length}）——覆盖不了三种 verdict 的各种成因。`);

    const seen = new Set<string>();
    for (const c of raw.cases) {
      const node: VerifiableNode | undefined = c.node === null
        ? undefined
        : {
            kind: c.node.kind,
            ...(c.node.value === undefined ? {} : { value: c.node.value }),
            ...(c.node.name === undefined ? {} : { name: c.node.name }),
          };

      const r = verifyMapping(c.mapping, () => node);
      assert.strictEqual(r.verdict, c.expect,
        `用例「${c.name}」判定不符。\n`
        + `  期望 ${c.expect}，实际 ${r.verdict}\n`
        + `  理由：${r.reason}\n`
        + '★若 Java 侧同用例判定不同，即违反 ADR §7「Verifier 结果必须一致」。');
      seen.add(r.verdict);
    }

    // ★反向守卫：三种 verdict 都必须被覆盖到，否则语料不足以证明一致性。
    //   只覆盖 VERIFIED 的语料，挡不住"把所有输入都判 VERIFIED"这种实现。
    for (const v of ['VERIFIED', 'REVIEW_REQUIRED', 'REJECTED']) {
      assert.ok(seen.has(v),
        `语料未覆盖 ${v} —— 一致性门禁存在盲区。已覆盖：${[...seen].join(', ')}`);
    }
  });
});
