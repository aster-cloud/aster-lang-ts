import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule } from '../../../src/typecheck.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import type { TypecheckDiagnostic, Core } from '../../../src/types.js';

function runTypecheck(source: string): TypecheckDiagnostic[] {
  const canonical = canonicalize(source);
  const tokens = lex(canonical);
  const ast = parse(tokens);
  const core = lowerModule(ast);
  return typecheckModule(core);
}

describe('泛型诊断', () => {
  it('未声明的类型变量应触发 TYPE_VAR_UNDECLARED', () => {
    const typeVar = (name: string) => ({ kind: 'TypeVar', name }) as Core.TypeVar;
    const func: Core.Func = {
      kind: 'Func',
      name: 'useUndefined',
      typeParams: [],
      params: [{ name: 'value', type: typeVar('T'), annotations: [] }],
      effects: [],
      effectCaps: [],
      effectCapsExplicit: false,
      ret: typeVar('T'),
      body: {
        kind: 'Block',
        statements: [
          {
            kind: 'Return',
            expr: { kind: 'Name', name: 'value' } as Core.Name
          }
        ]
      }
    };
    const mod: Core.Module = {
      kind: 'Module',
      name: 'test.typecheck.generic.undeclared',
      decls: [func]
    };
    const diagnostics = typecheckModule(mod);
    assert.equal(
      diagnostics.some(d => d.code === ErrorCode.TYPE_VAR_UNDECLARED),
      true,
      '参数类型使用未声明的类型变量应提示错误'
    );
  });

  it('疑似类型变量但未声明应触发 TYPEVAR_LIKE_UNDECLARED', () => {
    const typeName = (name: string) => ({ kind: 'TypeName', name }) as Core.TypeName;
    const func: Core.Func = {
      kind: 'Func',
      name: 'wrap',
      typeParams: [],
      params: [{ name: 'value', type: typeName('Foo'), annotations: [] }],
      effects: [],
      effectCaps: [],
      effectCapsExplicit: false,
      ret: typeName('Foo'),
      body: {
        kind: 'Block',
        statements: [
          {
            kind: 'Return',
            expr: { kind: 'Name', name: 'value' } as Core.Name
          }
        ]
      }
    };
    const mod: Core.Module = {
      kind: 'Module',
      name: 'test.typecheck.generic.like_undeclared',
      decls: [func]
    };
    const diagnostics = typecheckModule(mod);
    assert.equal(
      diagnostics.some(d => d.code === ErrorCode.TYPEVAR_LIKE_UNDECLARED),
      true,
      '看似类型变量的未声明类型名应提示错误'
    );
  });
});

describe('模式匹配 Result/Maybe 绑定', () => {
  it('Result Ok 模式应正确绑定内部类型', () => {
    const diagnostics = runTypecheck(`
This module is test.typecheck.pattern.result_ok.

To unwrap with value: Result of Int and Text, produce Int:
  Match value:
    When Ok(number), Return number.
    When Err(err), Return 0.
`);
    assert.equal(diagnostics.length, 0, 'Ok 模式应正确传播 Int 类型');
  });

  it('Maybe Some 模式应正确绑定内部类型', () => {
    const diagnostics = runTypecheck(`
This module is test.typecheck.pattern.maybe_some.

To unwrap with value: Option of Text, produce Text:
  Match value:
    When Some(text), Return text.
    When None, Return "fallback".
`);
    assert.equal(diagnostics.length, 0, 'Some 模式应正确传播 Text 类型');
  });
});

describe('构造器字段诊断', () => {
  it('缺失必须字段应触发 MISSING_REQUIRED_FIELD', () => {
    const diagnostics = runTypecheck(`
This module is test.typecheck.construct.missing.

Define Profile with id: Int, name: Text.

To build, produce Profile:
  Return Profile with id = 1.
`);
    assert.equal(
      diagnostics.some(d => d.code === ErrorCode.MISSING_REQUIRED_FIELD),
      true,
      '缺失字段必须提示错误'
    );
  });

  it('重复字段类型不符应触发 FIELD_TYPE_MISMATCH', () => {
    const diagnostics = runTypecheck(`
This module is test.typecheck.construct.duplicate.

Define Profile with id: Int, name: Text.

To build, produce Profile:
  Return Profile with id = 1, id = "oops", name = "Alice".
`);
    const mismatch = diagnostics.find(d => d.code === ErrorCode.FIELD_TYPE_MISMATCH);
    assert.ok(mismatch, '重复字段类型不符应报错');
    assert.equal(mismatch?.severity, 'error');
  });
});
