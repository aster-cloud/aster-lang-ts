/**
 * ADR 0056 §4.1（V2 能力推断）：IR 只记源码写下的能力。
 * `It performs` 子句列出至少一个能力时 effectCaps 为这些能力（源码顺序、按首次出现去重），
 * effectCapsExplicit = true；否则 effectCaps = []、effectCapsExplicit = false——裸 `io` / `cpu`
 * 不再展开为预置能力列表（与 aster-lang-core 一致）。
 * 工作流步骤的能力检查只在 effectCapsExplicit 为真时进行，裸 `io` 函数的工作流不按任何预置判定。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule } from '../../../src/typecheck.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import type { Core, Func, Module as AstModule } from '../../../src/types.js';

function parseFunc(src: string): Func {
  const parsed = parse(lex(canonicalize(src)));
  assert.deepEqual(parsed.diagnostics, [], '源码必须无诊断解析');
  return (parsed.ast as AstModule).decls.find((d) => d.kind === 'Func') as Func;
}

function lowerSrc(src: string): Core.Module {
  const parsed = parse(lex(canonicalize(src)));
  assert.deepEqual(parsed.diagnostics, [], '源码必须无诊断解析');
  return lowerModule(parsed.ast as AstModule);
}

function lowerFunc(src: string): Core.Func {
  return lowerSrc(src).decls.find((d) => d.kind === 'Func') as Core.Func;
}

const rule = (effects: string): string =>
  `Module m.\n\nRule f given u as Text, produce Text. It performs ${effects}:\n  Return Http.get(u).\n`;

const workflow = (effects: string): string =>
  'Module m.\n\n' +
  `Rule sync given u as Text, produce. It performs ${effects}:\n` +
  '  workflow:\n' +
  '    step fetch:\n' +
  '      Return Http.get(u).\n' +
  '  .\n';

const codes = (src: string): string[] => typecheckModule(lowerSrc(src)).map((d) => String(d.code));

describe('ADR 0056 V2：effectCaps 只记显式能力', () => {
  for (const effect of ['io', 'cpu']) {
    it(`裸 \`It performs ${effect}\`：AST 与 IR 的 effectCaps 都为空、非显式`, () => {
      const ast = parseFunc(rule(effect));
      assert.deepEqual(ast.effectCaps, []);
      assert.equal(ast.effectCapsExplicit, false);
      const core = lowerFunc(rule(effect));
      assert.deepEqual(core.effectCaps, []);
      assert.equal(core.effectCapsExplicit, false);
    });
  }

  it('显式能力按源码顺序保留并按首次出现去重', () => {
    const core = lowerFunc(rule('io [Sql, Http, Sql]'));
    assert.deepEqual(core.effectCaps, ['Sql', 'Http']);
    assert.equal(core.effectCapsExplicit, true);
  });

  it('工作流 + 裸 io：步骤里调用 Http 不报 WORKFLOW_UNDECLARED_CAPABILITY', () => {
    assert.equal(codes(workflow('io')).includes(ErrorCode.WORKFLOW_UNDECLARED_CAPABILITY), false);
  });

  it('工作流 + 裸 io：补偿块引入主体未用的能力照常报 COMPENSATE_NEW_CAPABILITY（不受显式门控）', () => {
    const src =
      'Module m.\n\n' +
      'Rule sync given u as Text, produce. It performs io:\n' +
      '  workflow:\n' +
      '    step fetch:\n' +
      '      Return Http.get(u).\n' +
      '    compensate:\n' +
      '      Return Db.query(u).\n' +
      '  .\n';
    const found = codes(src);
    assert.equal(found.includes(ErrorCode.COMPENSATE_NEW_CAPABILITY), true, JSON.stringify(found));
    assert.equal(found.includes(ErrorCode.WORKFLOW_UNDECLARED_CAPABILITY), false, JSON.stringify(found));
  });

  it('工作流 + 显式能力：步骤用到未声明能力照常报 WORKFLOW_UNDECLARED_CAPABILITY', () => {
    assert.equal(codes(workflow('io [Sql]')).includes(ErrorCode.WORKFLOW_UNDECLARED_CAPABILITY), true);
    assert.equal(codes(workflow('io [Http]')).includes(ErrorCode.WORKFLOW_UNDECLARED_CAPABILITY), false);
  });
});
