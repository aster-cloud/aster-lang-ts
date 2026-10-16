import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule } from '../../../src/typecheck.js';
import { compile } from '../../../src/browser.js';
import { evaluate } from '../../../src/core/interpreter.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import type { TypecheckDiagnostic } from '../../../src/types.js';

/**
 * 未声明类型的 data 字段（`Define X has a, b.`，没有 `as <Type>`）在成员访问时按动态类型处理。
 *
 * 背景：Action Guard 的 `context` 按设计是无类型 map（ADR 0040 §2.2），`req.context.amount`
 * 需要通过类型检查。Java 引擎（aster-lang-core BaseTypeChecker）对点号名一律给 Unknown、
 * 从不在成员访问上报 E011；TS 此前把无类型字段按命名推断成 Text，再对 `Text.amount` 报 E011，
 * 导致同一程序 Java 接受、TS 拒绝。这里固定：无类型字段经成员访问得到 Unknown（不级联报错），
 * 显式声明类型的字段仍保留 E011；运行时行为不变。
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const sample = readFileSync(join(repoRoot, 'test', 'fixtures', 'untyped-field', 'guard-cedar-sample.aster'), 'utf8');

function runTypecheck(source: string): TypecheckDiagnostic[] {
  const core = lowerModule(parse(lex(canonicalize(source))).ast);
  return typecheckModule(core);
}

function errors(diags: readonly TypecheckDiagnostic[]): TypecheckDiagnostic[] {
  return diags.filter(d => d.severity === 'error');
}

describe('无类型字段按动态类型处理（与 Java 对齐）', () => {
  test('guard-cedar-sample 类型检查零诊断', () => {
    const diags = runTypecheck(sample);
    assert.deepEqual(diags.map(d => `${d.code}: ${d.message}`), []);
  });

  test('显式类型的 record 访问未知字段仍报 E011', () => {
    const diags = runTypecheck(`
Module test.typecheck.typed_unknown_field.

Define Req has action as Text, amount as Int.

Rule decide given req as Req, produce Bool:
  Return req.nickname equals to "x".
`);
    assert.equal(diags.some(d => d.code === ErrorCode.UNKNOWN_FIELD), true);
  });

  test('显式 Text 字段上的成员访问仍报 E011', () => {
    const diags = runTypecheck(`
Module test.typecheck.typed_text_member.

Define Req has context as Text.

Rule decide given req as Req, produce Bool:
  Return req.context.amount at least 10000.
`);
    assert.equal(diags.some(d => d.code === ErrorCode.UNKNOWN_FIELD), true);
  });

  test('无类型标记不进入 Core IR（golden 与 TS↔Java 指纹不变）', () => {
    const core = lowerModule(parse(lex(canonicalize(sample))).ast);
    assert.equal(JSON.stringify(core).includes('typeInferred'), false);
  });

  test('无类型字段用于比较、算术与 List.contains 均无错误', () => {
    const diags = runTypecheck(`
Module test.typecheck.untyped_dynamic.

Define Req has principal_roles, context.

Rule decide given req as Req, produce Bool:
  Let total be req.context.amount plus req.context.fee.
  Let large be req.context.limits.refund at least 10000.
  If List.contains(req.principal_roles, "x"):
    Return large.
  Return total greater than 5.
`);
    assert.deepEqual(errors(diags).map(d => `${d.code}: ${d.message}`), []);
  });
});

describe('guard-cedar-sample 运行时行为不变', () => {
  const compiled = compile(sample);
  assert.ok(compiled.core, JSON.stringify((compiled as { diagnostics?: unknown }).diagnostics ?? []));

  function outcome(req: Record<string, unknown>): unknown {
    const ev = evaluate(compiled.core!, 'decide', {
      req: {
        principal_id: 'u1',
        principal_type: 'User',
        principal_roles: [],
        resource_type: 'Order',
        resource_id: 'o1',
        agent_model: 'm',
        context: { amount: 0 },
        ...req,
      },
    }, { maxSteps: 10_000 });
    assert.equal(ev.success, true, String(ev.error));
    return (ev.value as { outcome?: unknown }).outcome;
  }

  test('删除客户记录需审批', () => {
    assert.equal(outcome({ action: 'delete_customer_record' }), 'REQUIRE_APPROVAL');
  });
  test('被停用的主体拒绝', () => {
    assert.equal(outcome({ action: 'read', principal_roles: ['suspended'] }), 'DENY');
  });
  test('大额退款升级', () => {
    assert.equal(outcome({ action: 'refund', context: { amount: 20000 } }), 'ESCALATE');
  });
  test('小额退款放行', () => {
    assert.equal(outcome({ action: 'refund', context: { amount: 50 } }), 'ALLOW');
  });
});
