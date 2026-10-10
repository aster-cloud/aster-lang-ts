/**
 * 模块头只能出现一次且位于文件开头（与 Java `module : NEWLINE* (moduleHeader …)? … topLevelDecl*` 一致）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';

const MISPLACED = 'Module header must appear once, at the start of the file';

function errorsOf(source: string): string[] {
  return parse(lex(canonicalize(source))).diagnostics
    .filter((d) => d.severity === 'error')
    .map((d) => d.message);
}

test('第二个模块头报错', () => {
  assert.deepEqual(errorsOf('Module a.\nModule b.\n\nRule r produce Int:\n  Return 1.\n'), [MISPLACED]);
});

test('声明之后的模块头报错', () => {
  assert.deepEqual(errorsOf('Rule r produce Int:\n  Return 1.\n\nModule a.\n'), [MISPLACED]);
});

test('单个模块头与无模块头都照常解析', () => {
  assert.deepEqual(errorsOf('Module a.\n\nRule r produce Int:\n  Return 1.\n'), []);
  assert.deepEqual(errorsOf('Rule r produce Int:\n  Return 1.\n'), []);
});
