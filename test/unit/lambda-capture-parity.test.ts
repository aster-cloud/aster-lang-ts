import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile, parseSource } from '../../src/browser.js';
import { lowerModule } from '../../src/lower_to_core.js';
import type { Core } from '../../src/types.js';

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

/** 取整段源码里全部 Lambda 的 captures（按遍历序，外层在前）。 */
function capturesOf2(src: string): string[][] {
  const c = compile(src);
  assert.ok(c.core, `compile 失败: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
  return lambdaCaptures(c.core);
}

function lambdaCaptures(core: Core.Module): string[][] {
  const found: string[][] = [];
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    const node = n as { kind?: string; captures?: string[] };
    if (node.kind === 'Lambda' && Array.isArray(node.captures)) found.push(node.captures);
    for (const v of Object.values(n as Record<string, unknown>)) {
      if (Array.isArray(v)) v.forEach(walk); else walk(v);
    }
  };
  walk(core);
  assert.ok(found.length > 0, '源码里应至少有一个 Lambda');
  return found;
}

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

  it('Match 模式绑定的名字不得计入 captures', () => {
    // ★复评发现（2026-08-18）：Java 的 CoreLowering:820-832 有 patternBindings，
    //   TS 的 CaptureVisitor 此前只递归 Match 的 case 体、**不绑定模式引入的名字**，
    //   于是 `When bound, Return bound.` 里的 bound 被误记成捕获：
    //     Java → []        TS（修前）→ ["bound"]
    //   上一轮声称「六个样例逐条一致」，而那六个样例恰好都不含 Match。
    const captures = capturesOf2(
      `Module probe.\n\nRule r given outer, produce:\n` +
      `  Let f be function with x, produce:\n` +
      `    Match x:\n` +
      `      When bound, Return bound.\n` +
      `  Return f(outer).\n`);
    assert.deepEqual(captures[0], [],
      `Match 绑定的 bound 不得计入 captures（Java 侧为 []），实际=${JSON.stringify(captures[0])}`);
  });

  it('Match case 体内引用的外部变量仍须捕获', () => {
    // ★反向断言：绑定模式名 ≠ 把整个 case 体屏蔽掉。
    //   否则「Match 分支一律不收集」也能让上面那条通过，那是假修复。
    const captures = capturesOf2(
      `Module probe.\n\nRule r given outer, produce:\n` +
      `  Let f be function with x, produce:\n` +
      `    Match x:\n` +
      `      When bound, Return If bound then outer else bound.\n` +
      `  Return f(outer).\n`);
    assert.deepEqual(captures[0], ['outer'],
      `case 体里的 outer 必须捕获、bound 不得（Java 侧为 [outer]），实际=${JSON.stringify(captures[0])}`);
  });

  it('Match 的被匹配表达式（scrutinee）位也须收集捕获', () => {
    // ★终审发现（变异 E）：Match 分支我自己重写了递归逻辑，若漏掉
    //   `this.visitExpression(s.expr, ctx)`，scrutinee 位的自由变量就收不到 ——
    //   实测该变异**既逃过 11 条单测、也逃过 124 条 golden**，
    //   而它造成真分歧：Java [outer] vs TS []。
    //   两个 case 都不引用 outer，使 scrutinee 成为 outer 的唯一来源。
    const captures = capturesOf2(
      `Module probe.\n\nRule r given outer, produce:\n` +
      `  Let f be function with x, produce:\n` +
      `    Match outer:\n` +
      `      When 1, Return x.\n` +
      `      When rest, Return x.\n` +
      `  Return f(outer).\n`);
    assert.ok(captures[0]!.includes('outer'),
      `scrutinee 位的 outer 必须捕获（Java 侧为 [outer]），实际=${JSON.stringify(captures[0])}`);
  });

  it('Match 各 case 的模式绑定不得泄漏到后续 case', () => {
    // ★终审发现（变异 H）：每个 case 用独立作用域（push/pop）。
    //   若不弹栈，前一个 case 绑定的 bound 会泄漏到后一个 case，
    //   使后者的 `Return bound` 被误判成已绑定而漏掉捕获。
    //   实测该变异同样逃过全部单测与 golden，造成 Java [bound] vs TS [] 的真分歧。
    //   第二个 case 的 bound 是**自由变量**（它自己绑的是 other）。
    const captures = capturesOf2(
      `Module probe.\n\nRule r given bound, produce:\n` +
      `  Let f be function with x, produce:\n` +
      `    Match x:\n` +
      `      When bound, Return bound.\n` +
      `      When other, Return bound.\n` +
      `  Return f(bound).\n`);
    assert.ok(captures[0]!.includes('bound'),
      `第二个 case 里的 bound 是自由变量、必须捕获（Java 侧为 [bound]），`
      + `实际=${JSON.stringify(captures[0])}`);
  });

  it('块级作用域：块内 Let 出块即失效，块外同名引用指外层局部', () => {
    // 鉴别 visitBlock 的 push/pop：块内 Let tmp 遮蔽外层形参 tmp；出块后的 `Return tmp` 指外层形参，
    // 必须捕获。删掉 push/pop 则块内的 tmp 仍算已绑定 → 不捕获 → 用例红。
    // ADR 0056 §4.2 之后，块外引用一个**未定义**名字不再进 captures（它不是外层局部）。core 同一用例见
    // LambdaCaptureParityTest.blockScopedLetDoesNotHideOuterLocalAfterTheBlock。
    const src =
      `Module probe.\n\nRule r given outer, tmp, produce:\n` +
      `  Let f be function with x, produce:\n` +
      `    If x:\n` +
      `      Let tmp be outer.\n` +
      `      Return tmp.\n` +
      `    Return tmp.\n` +
      `  Return f(outer).\n`;
    assert.deepEqual(capturesOf2(src)[0], ['outer', 'tmp']);
  });

  it('嵌套 lambda 的名字与形参不得污染外层 captures', () => {
    // 内层 lambda 由 Let 绑定（名字 g），且有自己的形参 y。
    // 两者都不是外层的自由变量，都不得进外层 captures。
    //
    // ★内层体必须**真的引用 y**（复评发现）：原写法内层体是 `Return outer.`，
    //   y 从未被引用，那条「y 不得污染外层」的断言恒真 —— 实测「内层形参不入栈」
    //   这个变异下 8 条用例仍全绿。与 core#106 上一轮修掉的空断言同型。
    const src =
      `Module probe.\n\nRule r given outer, produce:\n` +
      `  Let f be function with x, produce:\n` +
      `    Let g be function with y, produce:\n` +
      `      Return If y then outer else outer.\n` +
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

/**
 * ADR 0056 §4.2：captures 只列外层局部（外层函数形参、此前的 Let、外层 Match 模式绑定、外层 lambda 形参），
 * 在方法调用改写后的 IR 上判定，按首次引用的源码位置排序。用例与 core LambdaCaptureParityTest 逐一对应。
 */
describe('lambda 捕获：只列外层局部（ADR 0056）', () => {
  const rule = (params: string, ...lines: string[]): string =>
    'Module probe.\n\nRule helper given v, produce:\n  Return v.\n\n' +
    `Rule r given ${params}, produce:\n` + lines.map((l) => l + '\n').join('');

  it('方法调用改写后，方法名与非局部接收者不进 captures', () => {
    assert.deepEqual(
      capturesOf2(rule('outer', '  Let f be function with x, produce:', '    Return x.add(outer).', '  Return f(outer).'))[0],
      ['outer'],
    );
    assert.deepEqual(
      capturesOf2(rule('base',
        '  Let f be function with url, produce:',
        '    Return io.get(Text.concat(base, url)).',
        '  Return f("/x").'))[0],
      ['base'],
    );
  });

  it('模块规则、内建函数与运算符不进 captures', () => {
    assert.deepEqual(
      capturesOf2(rule('k',
        '  Let f be function with y, produce:',
        '    Return helper(y) plus k greater than 0.',
        '  Return f(k).'))[0],
      ['k'],
    );
  });

  it('按首次引用的源码位置排序', () => {
    assert.deepEqual(
      capturesOf2(rule('first, second, third',
        '  Let f be function with x, produce:',
        '    Return If second then first else third.',
        '  Return f(first).'))[0],
      ['second', 'first', 'third'],
    );
  });

  it('只有 lambda 之前绑定的局部才是外层局部', () => {
    // lambda 体内的 later 在 lambda 处未绑定，名称解析以 E802 拒绝整个程序；捕获是 lower 的性质，直接对解析结果 lower
    const lowerOnly = (src: string): string[][] => lambdaCaptures(lowerModule(parseSource(src).ast));
    assert.deepEqual(
      lowerOnly(rule('a',
        '  Let early be 1.',
        '  Let f be function with x, produce:',
        '    Return early plus later plus a.',
        '  Let later be 2.',
        '  Return f(a).'))[0],
      ['early', 'a'],
    );
  });

  it('外层 Match 模式绑定是外层局部', () => {
    assert.deepEqual(
      capturesOf2(rule('m',
        '  Match m:',
        '    When bound,',
        '      Let f be function with x, produce:',
        '        Return x plus bound.',
        '      Return f(1).'))[0],
      ['bound'],
    );
  });

  it('嵌套 lambda：遮蔽与穿透', () => {
    const caps = capturesOf2(rule('a, b, c',
      '  Let outer be function with x, produce:',
      '    Let a be x times 2.',
      '    Let inner be function with c, produce:',
      '      Return c plus b plus a.',
      '    Return inner(x).',
      '  Return outer(c).'));
    assert.deepEqual(caps[0], ['b']);
    assert.deepEqual(caps[1], ['b', 'a']);
  });

  it('Start 的任务名是局部绑定（与 R1 一致）', () => {
    const lowerOnly = (src: string): string[][] => lambdaCaptures(lowerModule(parseSource(src).ast));
    assert.deepEqual(
      lowerOnly(rule('v',
        '  Start task as async helper(v).',
        '  Let f be function with x, produce:',
        '    Return task.',
        '  Return f(v).'))[0],
      ['task'],
    );
    assert.deepEqual(
      lowerOnly(rule('v, task',
        '  Let f be function with x, produce:',
        '    Start task as async helper(x).',
        '    Return task.',
        '  Return f(v).'))[0],
      [],
    );
  });
});
