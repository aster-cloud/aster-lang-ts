import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule } from '../../../src/typecheck.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import type { Core, TypecheckDiagnostic } from '../../../src/types.js';

function runTypecheck(source: string): TypecheckDiagnostic[] {
  const canonical = canonicalize(source);
  const tokens = lex(canonical);
  const ast = parse(tokens);
  const core = lowerModule(ast);
  return typecheckModule(core);
}

describe('异步纪律补充测试', () => {
  it('collectAsync 缺失 origin 时仍应触发 Start 未 Wait 诊断', () => {
    const start: Core.Start = {
      kind: 'Start',
      name: 'job',
      expr: { kind: 'Name', name: 'task' } as Core.Name
    };
    const ret: Core.Return = {
      kind: 'Return',
      expr: { kind: 'Int', value: 0 } as Core.Int
    };
    const block: Core.Block = {
      kind: 'Block',
      statements: [start, ret]
    };
    const func: Core.Func = {
      kind: 'Func',
      name: 'demo',
      typeParams: [],
      params: [],
      effects: [],
      effectCaps: [],
      effectCapsExplicit: false,
      ret: { kind: 'TypeName', name: 'Int' } as Core.TypeName,
      body: block
    };
    const mod: Core.Module = {
      kind: 'Module',
      name: 'test.async.manual',
      decls: [func]
    };

    const diagnostics = typecheckModule(mod);
    const diag = diagnostics.find(d => d.code === ErrorCode.ASYNC_START_NOT_WAITED);
    assert.ok(diag, '缺失 origin 情况下仍应检测 Start 未 Wait');
    assert.equal(diag?.span, undefined, '占位 span 应被滤除');
  });

  it('嵌套作用域中遗漏 Wait 也应被检测', () => {
    const diagnostics = runTypecheck(`
Module test.async.nested_missing_wait.

Define User has id: Text.

Rule process given u: User, produce Text. It performs io:
  If u.id equals to "1":
    Start profile as async fetchProfile(u.id).
  Return "done".

Rule fetchProfile given id: Text, produce Text. It performs io:
  Return "profile".
`);
    const missingWait = diagnostics.filter(d => d.code === ErrorCode.ASYNC_START_NOT_WAITED);
    assert.equal(missingWait.length, 1, '嵌套作用域未等待仍应报错');
  });
});
