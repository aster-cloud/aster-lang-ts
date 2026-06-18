import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import type { Module, Statement } from '../../../src/types.js';

/**
 * ADR 0019 G2a：语句级内联 if（`if cond then return X else return Y`）。
 *
 * 文档（aster-lang.dev）大量使用此写法（含 then 换行缩进、else-if 链、else/否则），
 * 但 TS 引擎此前只有块式 if。内联 if 降级为与块式相同的 If 节点——单语句 return 包成
 * 单元素 Block，else-if 链右递归成嵌套 If 的 else 分支。
 */
function parseSource(source: string): Module {
  const result = parse(lex(canonicalize(source)));
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  assert.equal(errors.length, 0, `不应有解析错误，得到: ${JSON.stringify(errors[0])}`);
  return result.ast;
}

function firstStmt(module: Module): Statement {
  const func = module.decls.find((d) => d.kind === 'Func') as { body?: { statements: Statement[] } } | undefined;
  assert.ok(func?.body, '应有函数体');
  assert.equal(func!.body!.statements.length, 1, '内联 if 规则体应只有一个 If 语句');
  return func!.body!.statements[0]!;
}

describe('ADR 0019 G2a — 语句级内联 if', () => {
  test('简单 if/then/else', () => {
    const m = parseSource(
      'Module m.\nRule r given amount:\n  if amount is greater than 10000 then return "large"\n  else return "small".'
    );
    const stmt = firstStmt(m);
    assert.equal(stmt.kind, 'If');
    if (stmt.kind === 'If') {
      assert.equal(stmt.thenBlock.statements.length, 1);
      assert.equal(stmt.thenBlock.statements[0]!.kind, 'Return');
      assert.ok(stmt.elseBlock, '应有 else 分支');
      assert.equal(stmt.elseBlock!.statements[0]!.kind, 'Return');
    }
  });

  test('if/then 无 else（else 分支为 null）', () => {
    const m = parseSource(
      'Module m.\nRule r given amount:\n  if amount is greater than 10000 then return "large".'
    );
    const stmt = firstStmt(m);
    assert.equal(stmt.kind, 'If');
    if (stmt.kind === 'If') {
      assert.equal(stmt.elseBlock, null, '无 else 时 elseBlock 应为 null');
    }
  });

  test('else if 链降级为嵌套 If', () => {
    const m = parseSource(
      'Module m.\nRule r given amount:\n  if amount is greater than 10000 then return "large"\n  else if amount is greater than 1000 then return "medium"\n  else return "small".'
    );
    const stmt = firstStmt(m);
    assert.equal(stmt.kind, 'If');
    if (stmt.kind === 'If') {
      assert.ok(stmt.elseBlock);
      const nested = stmt.elseBlock!.statements[0]!;
      assert.equal(nested.kind, 'If', 'else if 应降级为嵌套 If');
    }
  });

  test('then 换行缩进（文档写法）', () => {
    const m = parseSource(
      'Module m.\nRule r given age:\n  if age is less than 25\n    then return 500\n  else return 300.'
    );
    assert.equal(firstStmt(m).kind, 'If');
  });

  test('then 换行缩进 + else-if 链（doc overview 形态）', () => {
    const m = parseSource(
      'Module m.\nRule r given amount, tier:\n  if tier is equal to "gold"\n    then return amount times 80 divided by 100\n  else if amount is greater than 100\n    then return amount times 90 divided by 100\n  else return amount.'
    );
    assert.equal(firstStmt(m).kind, 'If');
  });

  test('else 与 otherwise 都接受（与 core ELSE: Else|Otherwise 对齐）', () => {
    // 内联 if 用 else
    assert.equal(
      firstStmt(
        parseSource('Module m.\nRule r given n:\n  if n is greater than 0 then return "p" else return "z".')
      ).kind,
      'If'
    );
    // 块式 if 现也接受 else（此前只接受 Otherwise）
    assert.equal(
      firstStmt(
        parseSource('Module m.\nRule r given n, produce Text:\n  If n is greater than 0:\n    Return "p".\n  Else:\n    Return "z".')
      ).kind,
      'If'
    );
  });
});
