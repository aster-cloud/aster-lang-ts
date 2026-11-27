/**
 * 类型别名接收者展开（aster-lang-core#313，ADR 0056 修订 A7 D1）。
 *
 * 别名不产出 Core 声明；R2 收到别名表（lowerTypeAliases）后把别名类型逐层展开为目标类型，点分路径接收者、Match 主语与期望类型
 * 与直接写目标类型时解析结果相同，不再走「接收者类型未知 → 全局唯一候选 + W801」的回退。共享夹具 shared/alias_receiver_parity.json
 * 与 aster-lang-core src/test/resources/diagnostics/alias_receiver_parity.json 逐字节相同；core AliasReceiverParityTest 按同一夹具断言。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSource, resolveAndLower } from '../../../src/compile-pipeline.js';
import { serializeCoreIr } from '../../../src/core/serialize-core-ir.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { buildVocabularyScopes } from '../../../src/config/lexicons/identifiers/scopes.js';
import { IdentifierKind } from '../../../src/config/lexicons/identifiers/types.js';

interface AliasReceiverCase {
  readonly name: string;
  readonly source: string;
  readonly codes: readonly (readonly [string, number])[];
  readonly refs?: readonly string[];
}

const FIXTURE = resolve(process.cwd(), 'shared', 'alias_receiver_parity.json');
const CASES = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: AliasReceiverCase[] }).cases;

const SCOPES = buildVocabularyScopes({
  id: 't', name: 't', locale: 'en-US', version: '1',
  structs: [{ canonical: 'Driver', localized: 'Fahrer', kind: IdentifierKind.STRUCT }],
  fields: [{ canonical: 'age', localized: 'alter', kind: IdentifierKind.FIELD, parent: 'Driver' }],
  functions: [],
  enumValues: [
    { canonical: 'High', localized: 'Hoch', kind: IdentifierKind.ENUM_VALUE, parent: 'Level' },
    { canonical: 'Low', localized: 'Niedrig', kind: IdentifierKind.ENUM_VALUE, parent: 'Level' },
  ],
});

/** Func 体内 Name / PatName（kind:name）与 PatCtor（PatCtor:typeName），按对象键字典序深度优先（与 core 同一遍历）。 */
function refsOf(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const x of node) refsOf(x, out);
    return out;
  }
  if (node === null || typeof node !== 'object') return out;
  const o = node as Record<string, unknown>;
  if (o.kind === 'Name' || o.kind === 'PatName') out.push(`${o.kind}:${String(o.name)}`);
  if (o.kind === 'PatCtor') out.push(`PatCtor:${String(o.typeName)}`);
  for (const k of Object.keys(o).sort()) if (k !== 'origin') refsOf(o[k], out);
  return out;
}

describe('类型别名接收者展开（共享夹具，ts 侧）', () => {
  it('共享夹具共 18 例', () => assert.equal(CASES.length, 18));

  for (const c of CASES) {
    it(c.name, () => {
      const parsed = parseSource(c.source, EN_US, SCOPES);
      assert.deepEqual(parsed.diagnostics.filter((d) => d.severity === 'error'), [], '夹具源码须能解析');
      const resolved = resolveAndLower(parsed.ast, SCOPES);
      assert.deepEqual(resolved.diagnostics.map((d) => [d.code, d.span?.start.line ?? 0]), c.codes);
      if (c.refs === undefined) return;
      const ir = JSON.parse(serializeCoreIr(resolved.core)) as { decls: { kind: string }[] };
      assert.deepEqual(refsOf(ir.decls.filter((d) => d.kind === 'Func')), c.refs);
    });
  }

  it('ts 夹具与 aster-lang-core 副本 byte-identical（跨仓同源）', () => {
    // 与 parse-diagnostics-parity 同口径：CI 中兄弟仓必须存在（fail-closed），本地未并列 checkout 时跳过。
    const RELATIVE = 'src/test/resources/diagnostics/alias_receiver_parity.json';
    const candidates = [
      resolve(process.cwd(), '..', 'aster-lang-core', RELATIVE),
      resolve(process.cwd(), 'aster-lang-core', RELATIVE),
    ];
    const inCi =
      process.env.CI === 'true' ||
      process.env.GITHUB_ACTIONS === 'true' ||
      process.env.ASTER_ERROR_CODES_PARITY_REQUIRED === 'true';
    const javaBytes = candidates.map((p) => { try { return readFileSync(p); } catch { return undefined; } }).find((b) => b !== undefined);
    if (!javaBytes) {
      if (inCi) assert.fail(`CI 中必须 checkout aster-lang-core 才能校验 parity 夹具同源：\n${candidates.join('\n')}`);
      return;
    }
    assert.ok(readFileSync(FIXTURE).equals(javaBytes), 'alias_receiver_parity.json 与 aster-lang-core 副本必须 byte-identical');
  });
});
