/**
 * Lambda 的闭包捕获（ADR 0056 §4.2），与 aster-lang-core `LambdaCaptures` 逐步相同。
 *
 * 名字 n 进入 lambda L 的 captures，当且仅当：
 * 1. n 作为 `Name` 节点（值位置或调用目标）出现在 L 体内，含 L 内嵌套 lambda 的体内；
 * 2. 该出现处 n 没有被 L 内部的绑定遮蔽（L 的形参、此前的 Let / Start、Match 模式绑定、嵌套 lambda 的形参）；
 * 3. n 是 L 外层的局部绑定（外层函数形参、L 之前的 Let / Start、外层 Match 模式绑定、外层 lambda 形参）。
 *
 * 判定在已降级的 Core IR 上进行，方法调用已改写为「方法名作调用目标、接收者作首参」；方法名、效应关键词、
 * 运算符、模块声明、导入与内建函数都不是外层局部，不进 captures。顺序按首次引用的源码位置（行、列）升序，去重。
 */
import type { Core } from '../types.js';

export function collectLambdaCaptures(
  params: readonly string[],
  body: Core.Block,
  outerLocals: ReadonlySet<string>,
): string[] {
  const bound: Set<string>[] = [new Set(params)];
  // 名字 → [行, 列, 遍历序]
  const first = new Map<string, [number, number, number]>();
  let seq = 0;
  const isBound = (n: string): boolean => bound.some((s) => s.has(n));

  const inScope = (names: Iterable<string>, fn: () => void): void => {
    bound.push(new Set(names));
    try {
      fn();
    } finally {
      bound.pop();
    }
  };

  const block = (statements: readonly Core.Statement[] | null | undefined): void => {
    if (!statements) return;
    inScope([], () => statements.forEach(stmt));
  };

  const name = (n: Core.Name): void => {
    const id = n.name;
    if (id.includes('.') || isBound(id) || !outerLocals.has(id)) return;
    const pos: [number, number, number] = [
      n.origin?.start?.line ?? Number.MAX_SAFE_INTEGER,
      n.origin?.start?.col ?? Number.MAX_SAFE_INTEGER,
      seq++,
    ];
    const prev = first.get(id);
    if (prev === undefined || compare(pos, prev) < 0) first.set(id, pos);
  };

  function stmt(s: Core.Statement): void {
    switch (s.kind) {
      case 'Let':
        // 先看右侧再绑定：`Let x be x plus 1` 右侧的 x 指外层
        expr(s.expr);
        bound[bound.length - 1]!.add(s.name);
        return;
      case 'Set':
      case 'Return':
        expr(s.expr);
        return;
      case 'Start':
        // 与 R1 一致：任务名先绑定
        bound[bound.length - 1]!.add(s.name);
        expr(s.expr);
        return;
      case 'If':
        expr(s.cond);
        block(s.thenBlock.statements);
        block(s.elseBlock?.statements);
        return;
      case 'Match':
        expr(s.expr);
        for (const c of s.cases) {
          inScope(patternBindings(c.pattern), () => stmt(c.body));
        }
        return;
      case 'Scope':
      case 'Block':
        block(s.statements);
        return;
      case 'workflow':
        for (const step of s.steps) {
          block(step.body.statements);
          block(step.compensate?.statements);
        }
        return;
      case 'Wait':
        return;
    }
  }

  function expr(e: Core.Expression): void {
    switch (e.kind) {
      case 'Name':
        name(e);
        return;
      case 'Call':
        expr(e.target);
        e.args.forEach(expr);
        return;
      case 'Construct':
        e.fields.forEach((f) => expr(f.expr));
        return;
      case 'Ok':
      case 'Err':
      case 'Some':
      case 'Await':
        expr(e.expr);
        return;
      case 'IfExpr':
        expr(e.cond);
        expr(e.thenE);
        expr(e.elseE);
        return;
      case 'ListLit':
        e.elements.forEach(expr);
        return;
      case 'Lambda':
        // 嵌套 lambda：内层形参只在内层有效；内层引用的外层局部穿透记到本 lambda
        inScope(e.params.map((p) => p.name), () => block(e.body.statements));
        return;
      default:
        return;
    }
  }

  block(body.statements);
  return [...first.entries()].sort((a, b) => compare(a[1], b[1])).map(([n]) => n);
}

function compare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    if (d !== 0) return d;
  }
  return 0;
}

/** IR 模式引入的绑定：PatName 绑定自身名字，PatCtor 递归 args。 */
function patternBindings(p: Core.Pattern): string[] {
  if (p.kind === 'PatName') return [p.name];
  if (p.kind === 'PatCtor') return p.args.flatMap(patternBindings);
  return [];
}
