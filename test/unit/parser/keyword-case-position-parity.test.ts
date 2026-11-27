/**
 * 关键词大小写（ADR 0059 A4 §1.1）在列表分隔符与构造位置（aster-lang-ts#411，产品裁决 2026-11-28）：形参之间的 and（规则头与
 * lambda）、变体之间的 or / and、apply 的 to、构造里 and 之后的 set 不区分大小写；字段列表里换行起头（不缩进）的 and 与 has 构造
 * （与 with 同义）两引擎都接受。共享夹具 shared/keyword_case_position_parity.json 与 aster-lang-core
 * src/test/resources/diagnostics/keyword_case_position_parity.json 逐字节相同，core KeywordCasePositionParityTest 按同一夹具断言：
 * 带 pf 的例两引擎的 Core IR positionFreeSha256 都恰为 pf。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CompileFailure, compileSource, positionFreeSha256 } from '../../../src/policy-package/compile-source.js';

interface PositionCase {
  readonly name: string;
  readonly source: string;
  readonly equivalent?: string;
  readonly pf?: string;
  readonly reject?: true;
}

const FIXTURE = resolve(process.cwd(), 'shared', 'keyword_case_position_parity.json');
const CASES = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: PositionCase[] }).cases;

const pfOf = (source: string): string => positionFreeSha256(compileSource(source, { locale: 'en-US' }));

test('共享夹具共 98 例，其中 19 例两引擎都拒', () => {
  assert.equal(CASES.length, 98);
  assert.equal(CASES.filter((c) => c.reject).length, 19);
});

for (const c of CASES) {
  test(`关键词位置与 core 同一结论：${c.name}`, () => {
    if (c.reject) {
      assert.throws(() => compileSource(c.source, { locale: 'en-US' }), CompileFailure);
      return;
    }
    const pf = pfOf(c.source);
    assert.equal(pf, c.pf);
    if (c.equivalent !== undefined) assert.equal(pf, pfOf(c.equivalent));
  });
}
