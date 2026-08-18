import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';

/**
 * Lambda 闭包捕获的表达式覆盖完整性（2026-08-17 审计修复）。
 *
 * 捕获收集靠 `DefaultAstVisitor.visitExpression` 逐变体递归（lowering 里的
 * `CaptureVisitor` 继承它）。漏掉任何一个**含子表达式**的变体，被该变体包裹的
 * 外部变量引用就收不进 `captures`。
 *
 * `captures` 不是元数据：Truffle 的 Loader 用它构造 FrameDescriptor，
 * LambdaRootNode 按位置传实参——捕获缺失 = 该变量在被调帧里根本没有槽位。
 *
 * 本轮实测出的分歧：`ListLit` 在 TS 侧没有 case，而 Java 侧
 * `CoreLowering.visitExpr` 一直处理 `Expr.ListLiteral`。于是
 * `Return [outer, x]` 里的 outer 在 TS 产出的 Core IR 里被静默丢弃——
 * 同一段源码、两个引擎的 IR 不同，且两侧都不报错。
 */

/** 取编译产物中第一个 Lambda 的 captures。 */
function capturesOf(body: string): string[] {
  const src =
    `Module probe.\n\nRule r given outer, produce:\n` +
    `  Let f be function with x, produce:\n` +
    `    Return ${body}.\n` +
    `  Return f(outer).\n`;
  const c = compile(src);
  assert.ok(c.core, `compile 失败: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
  const found: string[][] = [];
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    const node = n as { kind?: string; captures?: string[] };
    if (node.kind === 'Lambda' && Array.isArray(node.captures)) found.push(node.captures);
    for (const v of Object.values(n as Record<string, unknown>)) {
      if (Array.isArray(v)) v.forEach(walk);
      else walk(v);
    }
  };
  walk(c.core);
  assert.ok(found.length > 0, `源码里应至少有一个 Lambda：${body}`);
  return found[0]!;
}

describe('lambda 捕获：表达式变体覆盖完整性', () => {
  it('直接引用的外部变量被捕获（基线）', () => {
    assert.ok(capturesOf('outer').includes('outer'));
  });

  it('列表字面量里引用的外部变量被捕获', () => {
    // ★本次修复的核心：此前 visitExpression 没有 ListLit case，
    //   `[outer, x]` 直接 return 不递归元素 → outer 被静默丢弃。
    assert.ok(
      capturesOf('[outer, x]').includes('outer'),
      '列表字面量内引用的外部变量必须计入 captures',
    );
  });

  it('嵌套在列表字面量里的调用参数也被捕获', () => {
    // 递归深度而非只补一层。
    assert.ok(
      capturesOf('[List.get([outer], 0)]').includes('outer'),
      '嵌套列表字面量内的外部变量必须计入 captures',
    );
  });

  it('内联 if 的三个子表达式都被捕获（防回归）', () => {
    assert.ok(capturesOf('If x then outer else 0').includes('outer'));
    assert.ok(capturesOf('If outer then 1 else 0').includes('outer'));
  });

  it('lambda 体内 Let 声明的局部变量不得计入 captures', () => {
    // ★对抗性审查发现（2026-08-18）：此前 CaptureVisitor **没有作用域栈**，
    //   只排除当前 lambda 的形参，于是 Let 局部被当成捕获（over-capture）。
    //   同一段源码 Java 得 [outer]、TS 得 [outer, localA] —— 依然是双引擎分歧，
    //   只是从「少算」变成了「多算」。
    const src =
      `Module probe.\n\nRule r given outer, produce:\n` +
      `  Let f be function with x, produce:\n` +
      `    Let localA be 1.\n` +
      `    Return If x then outer else localA.\n` +
      `  Return f(outer).\n`;
    const c = compile(src);
    assert.ok(c.core, 'compile 失败');
    const found: string[][] = [];
    const walk = (n: unknown): void => {
      if (!n || typeof n !== 'object') return;
      const node = n as { kind?: string; captures?: string[] };
      if (node.kind === 'Lambda' && Array.isArray(node.captures)) found.push(node.captures);
      for (const v of Object.values(n as Record<string, unknown>)) {
        if (Array.isArray(v)) v.forEach(walk); else walk(v);
      }
    };
    walk(c.core);
    assert.deepEqual(found[0], ['outer'],
      `Let 局部 localA 不得计入 captures（Java 侧为 [outer]），实际=${JSON.stringify(found[0])}`);
  });

  it('嵌套 lambda 的名字与形参不得污染外层 captures', () => {
    // 内层 lambda 由 Let 绑定（名字 g），且有自己的形参 y。
    // 两者都不是外层的自由变量，都不得进外层 captures。
    const src =
      `Module probe.\n\nRule r given outer, produce:\n` +
      `  Let f be function with x, produce:\n` +
      `    Let g be function with y, produce:\n` +
      `      Return outer.\n` +
      `    Return [g(x)].\n` +
      `  Return f(outer).\n`;
    const c = compile(src);
    assert.ok(c.core, 'compile 失败');
    const found: string[][] = [];
    const walk = (n: unknown): void => {
      if (!n || typeof n !== 'object') return;
      const node = n as { kind?: string; captures?: string[] };
      if (node.kind === 'Lambda' && Array.isArray(node.captures)) found.push(node.captures);
      for (const v of Object.values(n as Record<string, unknown>)) {
        if (Array.isArray(v)) v.forEach(walk); else walk(v);
      }
    };
    walk(c.core);
    // Java 侧实测为 [[outer], [outer]]
    assert.deepEqual(found[0], ['outer'],
      `外层不得捕获 g/y，实际=${JSON.stringify(found[0])}`);
    assert.deepEqual(found[1], ['outer'],
      `内层应捕获 outer，实际=${JSON.stringify(found[1])}`);
  });

  it('Let 右侧引用同名外层变量时仍应捕获（先递归后绑定）', () => {
    // `Let outer be outer` 的右侧指的是**外层**的 outer——
    // 若实现先绑定再递归，会把它误判成已绑定而漏掉这次捕获。
    const src =
      `Module probe.\n\nRule r given outer, produce:\n` +
      `  Let f be function with x, produce:\n` +
      `    Let outer be outer.\n` +
      `    Return outer.\n` +
      `  Return f(outer).\n`;
    const c = compile(src);
    assert.ok(c.core, 'compile 失败');
    const found: string[][] = [];
    const walk = (n: unknown): void => {
      if (!n || typeof n !== 'object') return;
      const node = n as { kind?: string; captures?: string[] };
      if (node.kind === 'Lambda' && Array.isArray(node.captures)) found.push(node.captures);
      for (const v of Object.values(n as Record<string, unknown>)) {
        if (Array.isArray(v)) v.forEach(walk); else walk(v);
      }
    };
    walk(c.core);
    assert.ok(found[0]!.includes('outer'),
      `Let 右侧的外层 outer 必须被捕获，实际=${JSON.stringify(found[0])}`);
  });

  it('lambda 自身形参不得计入 captures（反向断言）', () => {
    // ★同等重要的一半：否则「把所有 Name 无条件塞进 captures」也能让上面全绿——
    //   那是假修复，且会给 Truffle 多造出无用槽位。
    assert.ok(!capturesOf('[outer, x]').includes('x'), '形参 x 是绑定变量，不得计入 captures');
  });
});
