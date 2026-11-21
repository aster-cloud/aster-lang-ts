/**
 * 缩进的顶层声明（aster-lang-ts#380，Wave C 裁决 D1）：与 core 同码报在缩进处（首条声明 E063，已有声明之后 E052），
 * 只越过缩进记号、不做同步：缩进的声明与其后的声明照常解析，后续错误照常报告。码与行的 parity 见共享夹具。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parseWithLexicon } from '../../../src/parser.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';

function parse(source: string) {
  return parseWithLexicon(lex(canonicalize(source, EN_US), EN_US), EN_US);
}

describe('缩进的顶层声明', () => {
  it('首条声明缩进报 E063（token.indent），位置在缩进处', () => {
    const { diagnostics } = parse('Module m.\n\n  Type A as Text.\n');
    assert.deepEqual(diagnostics.map((d) => [d.code, d.span.start.line, d.span.start.col, d.params]), [['E063', 3, 1, { token: 'token.indent' }]]);
  });

  it('已有声明之后再缩进报 E052；小写关键词同样拒绝', () => {
    const { diagnostics } = parse('Module m.\n\nDefine P with v as Int.\n  define Q with w as Int.\n');
    assert.deepEqual(diagnostics.map((d) => [d.code, d.span.start.line]), [['E052', 4]]);
  });

  it('恢复不吞掉后面的类型别名，后续错误照常报告', () => {
    const ok = parse('Module m.\n\n  Type A as Text.\nType B as Text.\n');
    assert.deepEqual([...(ok.ast.typeAliases ?? [])], ['A', 'B']);
    const bad = parse('Module m.\n\n  Define P with v as Int.\nType B as @x.\n');
    assert.deepEqual(bad.diagnostics.map((d) => [d.code, d.span.start.line]), [['E063', 3], ['E056', 4]]);
    assert.deepEqual(bad.ast.decls.map((d) => d.kind), ['Data']);
  });

  it('续行缩进的字段与块体不受影响', () => {
    const { diagnostics } = parse('Module m.\n\nDefine P with\n  a as Int.\n\nRule f given p as P, produce Int:\n  Return p.a.\n');
    assert.deepEqual(diagnostics, []);
  });
});
