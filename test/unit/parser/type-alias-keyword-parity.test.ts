/**
 * 类型别名引导词 TYPE_ALIAS（ADR 0058 修订 2，#346）：zh `类型`、de `Typ`、hi `प्रकार` 只在顶层声明句首引导类型别名，与英文 `Type`
 * 同义；名字位置的同形词照常是名字、不改名。共享夹具 shared/type_alias_keyword_parity.json 与 aster-lang-core
 * src/test/resources/diagnostics/type_alias_keyword_parity.json 逐字节相同，core TypeAliasKeywordParityTest 按同一夹具断言。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileSource, positionFreeSha256 } from '../../../src/policy-package/compile-source.js';

interface TypeAliasCase {
  readonly name: string;
  readonly lexicon: string;
  readonly source: string;
  readonly equivalent?: string;
  readonly names?: readonly string[];
}

const FIXTURE = resolve(process.cwd(), 'shared', 'type_alias_keyword_parity.json');
const CASES = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: TypeAliasCase[] }).cases;

test('共享夹具共 12 例', () => {
  assert.equal(CASES.length, 12);
});

for (const c of CASES) {
  test(`类型别名引导词与 core 同一规则：${c.name}`, () => {
    const ir = compileSource(c.source, { locale: c.lexicon });
    if (c.equivalent !== undefined) {
      assert.equal(positionFreeSha256(ir), positionFreeSha256(compileSource(c.equivalent, { locale: c.lexicon })));
    }
    for (const n of c.names ?? []) assert.ok(ir.includes(`"${n}"`), `Core IR 原样保留名字 ${n}`);
  });
}
