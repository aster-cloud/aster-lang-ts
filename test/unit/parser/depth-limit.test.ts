/**
 * Parser 递归深度限制测试 (#24)
 *
 * 深度嵌套输入（如 5000 个 `(`）此前会撑爆原生调用栈并以 RangeError 崩溃。
 * 现在解析器应抛出可恢复的 DiagnosticError（P015），由 decl-parser 的恢复
 * 逻辑捕获并降级为诊断信息，而不是让进程崩溃。
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse, type ParseResult } from '../../../src/parser.js';
import { DiagnosticCode } from '../../../src/diagnostics/diagnostics.js';
import { MAX_RECURSION_DEPTH } from '../../../src/parser/context.js';

describe('parser depth limit', () => {
  test('deeply nested parens yield a diagnostic, not a crash', () => {
    const depth = 5000;
    const open = '('.repeat(depth);
    const close = ')'.repeat(depth);
    const source = `Module test.depth.\n\nRule deep, produce Int:\n  return ${open}1${close}.\n`;

    let result: ParseResult | undefined;
    assert.doesNotThrow(() => {
      result = parse(lex(canonicalize(source)));
    }, 'parse should not throw a raw RangeError on deep nesting');

    assert.ok(result, 'parse returned a result');
    assert.ok(
      result!.diagnostics.length > 0,
      'expected at least one diagnostic for over-deep nesting'
    );
    const hasDepthDiag = result!.diagnostics.some(
      (d) => d.code === DiagnosticCode.P015_NestingTooDeep
    );
    assert.ok(
      hasDepthDiag,
      `expected a P015_NestingTooDeep diagnostic, got: ${result!.diagnostics.map((d) => d.code).join(', ')}`
    );
  });

  test('shallow nesting (well under limit) parses without depth diagnostic', () => {
    const depth = 10;
    assert.ok(depth < MAX_RECURSION_DEPTH);
    const source = `Module test.shallow.\n\nRule ok, produce Int:\n  return ${'('.repeat(depth)}1${')'.repeat(depth)}.\n`;
    const result = parse(lex(canonicalize(source)));
    const hasDepthDiag = result.diagnostics.some(
      (d) => d.code === DiagnosticCode.P015_NestingTooDeep
    );
    assert.strictEqual(hasDepthDiag, false, 'shallow nesting should not trip the depth limit');
  });
});
