/**
 * 未知效果名（aster-lang-ts#304）：与 aster-lang-core 一致——
 * 解析接受 `It performs <任意名>`，lowering 不报 E601，名字原样保留在 IR 的 effects 中，
 * 检查阶段按 pure 处理（core EffectChecker.Effect.fromString 把未知名映射为 PURE）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse, parseWithLexicon } from '../../../src/parser.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
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

  // core 词法把这些词识别为关键词 token，`IT PERFORMS IDENT` 拒绝；ts 必须同样拒绝（#304 审查 F1）
  for (const word of ['return', 'to', 'async', 'with', 'and', 'if', 'performs']) {
    it(`core 保留词不能当效果名：It performs ${word}`, () => {
      const { diagnostics } = parseSrc(pureBody(` ${word}`));
      assert.ok(diagnostics.length > 0, `${word} 应解析失败`);
    });
  }

  it('core 不保留的软关键词照常接受（maybe 在 core 是 IDENT）', () => {
    const { ast, diagnostics } = parseSrc(pureBody(' maybe'));
    assert.deepEqual(diagnostics, []);
    assert.deepEqual((ast.decls.find((d) => d.kind === 'Func') as Func).effects, ['maybe']);
  });

  const parseIn = (src: string, lexicon: Lexicon): readonly unknown[] =>
    parseWithLexicon(lex(canonicalize(src, lexicon), lexicon), lexicon).diagnostics;

  it('zh-CN / de-DE 的关键词（翻译为同一保留词）同样被拒绝，普通名字照常接受', () => {
    assert.ok(parseIn('模块 m。\n\n规则 f 给定 x 作为 整数，产出 整数。执行 异步：\n  返回 x。\n', ZH_CN).length > 0);
    const de = (eff: string): string =>
      `Modul m.\n\nRegel f gegeben x als Ganzzahl, liefert Ganzzahl. fuehrt aus ${eff}:\n  gib zurueck x.\n`;
    assert.ok(parseIn(de('asynchron'), DE_DE).length > 0);
    assert.ok(parseIn(de('gib zurueck'), DE_DE).length > 0);
    assert.deepEqual(parseIn(de('teleport'), DE_DE), []);
  });
});
