import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule } from '../../../src/typecheck.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import type { Declaration, Func, Module } from '../../../src/types.js';

function parseSource(source: string): Module {
  const result = parse(lex(canonicalize(source)));
  assert.deepEqual(result.diagnostics, []);
  return result.ast;
}

function findFunc(module: Module, name: string): Func {
  const func = module.decls.find(
    (decl: Declaration): decl is Func => decl.kind === 'Func' && decl.name === name
  );
  assert.ok(func, `expected function ${name}`);
  return func;
}

describe('declaration annotations on Rule', () => {
  test('parses @entry before Rule', () => {
    const module = parseSource(`
Module test.entry.single.

@entry Rule foo, produce Text:
  Return "ok".
`);
    assert.deepEqual(findFunc(module, 'foo').annotations, [{ name: 'entry' }]);
  });

  test('parses @entry on a standalone line (dual-engine parity)', () => {
    // @entry 独立成行——与 aster-lang-core grammar (annotation NEWLINE*)* RULE 对齐
    const module = parseSource(`
Module test.entry.standalone.

@entry
Rule foo, produce Text:
  Return "ok".
`);
    assert.deepEqual(findFunc(module, 'foo').annotations, [{ name: 'entry' }]);
  });

  test('parses multiple annotations with arguments', () => {
    const module = parseSource(`
Module test.entry.multiple.

@entry @preview(source: "x") Rule foo, produce Text:
  Return "ok".
`);
    assert.deepEqual(findFunc(module, 'foo').annotations, [
      { name: 'entry' },
      { name: 'preview', args: [{ name: 'source', value: 'x' }] },
    ]);
  });

  test('keeps unannotated Rule compatible', () => {
    const module = parseSource(`
Module test.entry.none.

Rule foo, produce Text:
  Return "ok".
`);
    // 无注解时 annotations 字段被省略（不输出空数组），保持与既有 golden 基线一致
    assert.equal(findFunc(module, 'foo').annotations, undefined);
  });

  test('parses consecutive @entry functions', () => {
    const module = parseSource(`
Module test.entry.consecutive.

@entry Rule foo, produce Text:
  Return "ok".

@entry Rule bar, produce Text:
  Return "ok".
`);
    assert.deepEqual(findFunc(module, 'foo').annotations, [{ name: 'entry' }]);
    assert.deepEqual(findFunc(module, 'bar').annotations, [{ name: 'entry' }]);
  });

  test('lowers annotations to Core Func', () => {
    const module = parseSource(`
Module test.entry.lower.

@entry Rule foo, produce Text:
  Return "ok".
`);
    const core = lowerModule(module);
    const func = core.decls.find((decl): decl is typeof core.decls[number] & { kind: 'Func' } => decl.kind === 'Func');
    assert.ok(func);
    assert.deepEqual(func.annotations, [{ name: 'entry' }]);
  });

  test('typecheck allows a single @entry Rule', () => {
    const module = parseSource(`
Module test.entry.validator_single.

@entry Rule foo, produce Text:
  Return "ok".
`);
    const diagnostics = typecheckModule(lowerModule(module));
    assert.equal(diagnostics.some(diag => diag.code === ErrorCode.MULTIPLE_ENTRY_RULES), false);
  });

  test('typecheck rejects multiple @entry Rules', () => {
    const module = parseSource(`
Module test.entry.validator_multiple.

@entry Rule foo, produce Text:
  Return "ok".

@entry Rule bar, produce Text:
  Return "ok".
`);
    const diagnostics = typecheckModule(lowerModule(module));
    assert.equal(diagnostics.filter(diag => diag.code === ErrorCode.MULTIPLE_ENTRY_RULES).length, 1);
  });
});
