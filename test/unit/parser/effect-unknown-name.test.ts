/**
 * 未知效果名（aster-lang-ts#304）：与 aster-lang-core 一致——
 * 解析接受 `It performs <任意名>`，lowering 不报 E601，名字原样保留在 IR 的 effects 中，
 * 检查阶段按 pure 处理（core EffectChecker.Effect.fromString 把未知名映射为 PURE）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule } from '../../../src/typecheck.js';
import { compile } from '../../../src/browser.js';
import type { Core, Func, Module as AstModule } from '../../../src/types.js';

function parseSrc(src: string): { ast: AstModule; diagnostics: readonly unknown[] } {
  const parsed = parse(lex(canonicalize(src)));
  return { ast: parsed.ast as AstModule, diagnostics: parsed.diagnostics };
}

function lowerSrc(src: string): Core.Module {
  const { ast, diagnostics } = parseSrc(src);
  assert.deepEqual(diagnostics, [], '源码必须无诊断解析');
  return lowerModule(ast);
}

function firstFunc(core: Core.Module): Core.Func {
  return core.decls.find((d) => d.kind === 'Func') as Core.Func;
}

/** 只比较诊断的码、级别与参数，与 span 无关（两种写法的效果子句长度不同）。 */
function typecheckShape(src: string): Array<{ code: string; severity: string; data: unknown }> {
  return typecheckModule(lowerSrc(src))
    .map((d) => ({ code: String(d.code), severity: String(d.severity), data: d.data ?? null }))
    .sort((a, b) => (a.code + JSON.stringify(a.data)).localeCompare(b.code + JSON.stringify(b.data)));
}

const pureBody = (effects: string): string =>
  `Module m.\n\nRule f given x as Int, produce Int. It performs${effects}:\n  Return x.\n`;
const ioBody = (effects: string): string =>
  `Module m.\n\nRule g given u as Text, produce Text. It performs${effects}:\n  Return Http.get(u).\n`;

describe('未知效果名（#304）', () => {
  it('`It performs teleport` 解析成功，AST 保留效果名且不当作能力', () => {
    const { ast, diagnostics } = parseSrc(pureBody(' teleport'));
    assert.deepEqual(diagnostics, []);
    const f = ast.decls.find((d) => d.kind === 'Func') as Func;
    assert.deepEqual(f.effects, ['teleport']);
    assert.deepEqual(f.effectCaps, []);
    assert.equal(f.effectCapsExplicit, false);
  });

  it('lowering 不报 E601，IR 的 effects / declaredEffects 原样保留效果名', () => {
    const fn = firstFunc(lowerSrc(pureBody(' teleport')));
    assert.deepEqual(fn.effects, ['teleport']);
    assert.deepEqual((fn as { declaredEffects?: unknown }).declaredEffects, ['teleport']);
    assert.deepEqual(fn.effectCaps, []);
    assert.equal(fn.effectCapsExplicit, false);
  });

  it('compile() 成功且无 lowering 诊断', () => {
    const result = compile(pureBody(' teleport'));
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(result.loweringDiagnostics, undefined);
    assert.equal(result.parseErrors, undefined);
  });

  it('带能力列表时效果名与能力分别保留', () => {
    const fn = firstFunc(lowerSrc(ioBody(' teleport [Http]')));
    assert.deepEqual(fn.effects, ['teleport']);
    assert.deepEqual(fn.effectCaps, ['Http']);
    assert.equal(fn.effectCapsExplicit, true);
  });

  it('类型检查结果与 `It performs`（无效果）相同：纯函数体', () => {
    assert.deepEqual(typecheckShape(pureBody(' teleport')), typecheckShape(pureBody('')));
  });

  it('类型检查按 pure 处理：调用 IO 时与无效果声明一样报缺少 @io', () => {
    const unknown = typecheckShape(ioBody(' teleport'));
    assert.deepEqual(unknown, typecheckShape(ioBody('')));
    assert.ok(unknown.some((d) => d.severity === 'error'), JSON.stringify(unknown));
  });

  it('已知效果不受影响：`It performs io` 仍是 IO', () => {
    const fn = firstFunc(lowerSrc(ioBody(' io')));
    assert.deepEqual(fn.effects, ['IO']);
  });
});
