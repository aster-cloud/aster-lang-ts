import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import type { Module as AstModule } from '../../../src/types.js';

function lower(src: string) {
  const ast = parse(lex(canonicalize(src))).ast as AstModule;
  return lowerModule(ast);
}

test('位置字符串参数注解降为 $0 键', () => {
  const core = lower('Module probe.\n@id("PII-001")\nRule main produce Bool:\n  Return true.\n');
  const fn = core.decls.find((d) => d.kind === 'Func') as { annotations?: readonly { name: string; args?: readonly { name: string; value: unknown }[] }[] };
  assert.deepEqual(fn.annotations, [{ name: 'id', args: [{ name: '$0', value: 'PII-001' }] }]);
});

test('多个位置参数依次编号', () => {
  const core = lower('Module probe.\n@tag("a", "b")\nRule main produce Bool:\n  Return true.\n');
  const fn = core.decls.find((d) => d.kind === 'Func') as { annotations?: readonly { args?: readonly { name: string }[] }[] };
  assert.deepEqual(fn.annotations![0]!.args!.map((a) => a.name), ['$0', '$1']);
});

test('命名参数仍按原名保留', () => {
  const core = lower('Module probe.\n@id(value: "X")\nRule main produce Bool:\n  Return true.\n');
  const fn = core.decls.find((d) => d.kind === 'Func') as { annotations?: readonly { args?: readonly { name: string }[] }[] };
  assert.deepEqual(fn.annotations![0]!.args!.map((a) => a.name), ['value']);
});
