/**
 * ADR 0056 §3.1 / §3.3 / §4.3（V1 返回类型 + V4 origin）：推断类型节点的锚点。
 * - 源码没写返回类型的 Func / Lambda：返回类型是占位 Unknown，锚定在 produce 关键词；
 *   省略 produce 时取形参列表及其后可选逗号之后的第一个 token。
 * - 推断的形参 / 字段类型锚定在名字 token。
 * 与 aster-lang-core InferredTypeAnchorTest 的用例、行列号逐一对应。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import type { Module as AstModule, Func, Data, Lambda, Return, Call, Span } from '../../../src/types.js';

function parseSrc(src: string): AstModule {
  const parsed = parse(lex(canonicalize(src)));
  assert.deepEqual(parsed.diagnostics, [], '源码必须无诊断解析');
  return parsed.ast as AstModule;
}

const at = (node: { span?: Span }): string => {
  const s = node.span!;
  return `${s.start.line}:${s.start.col}-${s.end.line}:${s.end.col}`;
};

describe('推断类型节点的锚点（ADR 0056 §3.3）', () => {
  it('推断返回类型锚定在 produce 关键词', () => {
    const f = parseSrc('Module m.\n\nRule decide given x as Int, produce:\n  Let y be x.\n  Return y.\n').decls[0] as Func;
    assert.equal(f.retTypeInferred, true);
    assert.equal((f.retType as { name: string }).name, 'Unknown');
    assert.equal(at(f.retType), '3:29-3:36');
  });

  it('省略 produce：锚定在形参之后的第一个 token；形参后的逗号被跳过', () => {
    const colon = parseSrc('Module m.\n\nRule greet given name as Text:\n  Return name.\n').decls[0] as Func;
    assert.equal(at(colon.retType), '3:30-3:31');
    const dot = parseSrc('Module m.\n\nRule greet given name as Text. It performs io:\n  Return name.\n').decls[0] as Func;
    assert.equal(at(dot.retType), '3:30-3:31');
    const comma = parseSrc('Module m.\n\nRule greet given name as Text, produce:\n  Return name.\n').decls[0] as Func;
    assert.equal(at(comma.retType), '3:32-3:39');
  });

  it('Lambda 推断返回类型锚定在 produce 关键词（不是其后的冒号）', () => {
    const f = parseSrc(
      'Module m.\n\nRule f given xs as List of Int, produce List of Int:\n' +
        '  Return List.map(xs, function with x as Int, produce:\n' +
        '    Let y be x plus 1.\n' +
        '    Return y.\n' +
        '  ).\n'
    ).decls[0] as Func;
    const call = (f.body!.statements[0] as Return).expr as Call;
    const lambda = call.args[1] as Lambda;
    assert.equal((lambda.retType as { name: string }).name, 'Unknown');
    assert.equal(at(lambda.retType), '4:47-4:54');
  });

  it('Let 绑定的块形 Lambda 同样锚定在 produce', () => {
    const f = parseSrc(
      'Module m.\n\nRule f given n as Int, produce Int:\n' +
        '  Let inc be function with x as Int, produce:\n' +
        '    Return x plus n.\n' +
        '  Return inc(1).\n'
    ).decls[0] as Func;
    const let0 = f.body!.statements[0] as unknown as { expr: Lambda };
    assert.equal(let0.expr.kind, 'Lambda');
    assert.equal(at(let0.expr.retType), '4:38-4:45');
  });

  it('推断的形参 / 字段类型锚定在名字 token，不含其后的约束', () => {
    const m = parseSrc(
      'Module m.\n\nDefine Applicant has creditScore, approved, age required.\n\n' +
        'Rule f given applicant, amount between 1 and 10, produce Int:\n  Return 1.\n'
    );
    const data = m.decls[0] as Data;
    assert.deepEqual(data.fields.map((x) => at(x.type)), ['3:22-3:33', '3:35-3:43', '3:45-3:48']);
    const f = m.decls[1] as Func;
    assert.deepEqual(f.params.map((x) => at(x.type)), ['5:14-5:23', '5:25-5:31']);
  });
});
