/**
 * @module test/unit/core/caseless-pattern-name.test
 *
 * 无大小写文字（中文等）的裸模式名（ADR 0051 裁决 R55，aster-lang-core#227）。
 *
 * 成员还是绑定由 R2 按 R12 判定（主语为枚举时查该枚举的成员，主语类型未知时查全部枚举成员的精确写法，
 * 其余为绑定），两引擎一致；R2 再按判定结果给出统一的 IR 形态：成员为无参数 PatCtor，绑定为 PatName。
 * Core IR v2（ADR 0055 #16）起不再看首字母大小写：ASCII 大写、de 变音开头与小写 ASCII 成员一律产出 PatCtor。用例与 aster-lang-core 的 CaselessPatternNameTest 同输入同断言，
 * 另加解释器求值（core 没有解释器，求值由 truffle 与 aster-lang-test 的 tier1 样本覆盖）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { compileAndTypecheck } from '../../../src/browser.js';
import { evaluate } from '../../../src/core/interpreter.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import type { Core } from '../../../src/types.js';

const ENUM_ZH = '模块 探针.样例。\n\n定义 状态 为以下之一 待处理、进行中、已删除。\n\n';

function compileClean(source: string, lexicon?: Lexicon): Core.Module {
  const result = compileAndTypecheck(source, lexicon ? { lexicon } : {});
  assert.equal(result.success, true, JSON.stringify(result.parseErrors));
  const errors = (result.typeErrors ?? []).filter((d) => d.severity === 'error');
  assert.deepEqual(errors, [], '类型检查');
  return result.core!;
}

function patterns(core: Core.Module, func: string): Core.Pattern[] {
  const fn = core.decls.find((d): d is Core.Func => d.kind === 'Func' && d.name === func);
  assert.ok(fn, `缺少规则 ${func}`);
  const match = fn.body.statements.find((s): s is Core.Match => s.kind === 'Match');
  assert.ok(match, `${func} 中没有 匹配于`);
  return match.cases.map((c) => c.pattern);
}

function assertVariant(name: string, p: Core.Pattern | undefined): void {
  assert.equal(p?.kind, 'PatCtor', `成员应为无参数 PatCtor：${name}`);
  const ctor = p as Core.PatCtor;
  assert.equal(ctor.typeName, name);
  assert.deepEqual([...ctor.args], []);
}

function assertBinding(name: string, p: Core.Pattern | undefined): void {
  assert.equal(p?.kind, 'PatName', `绑定应为 PatName：${name}`);
  assert.equal((p as Core.PatName).name, name);
}

function run(core: Core.Module, entry: string, context: Record<string, unknown>): unknown {
  const result = evaluate(core, entry, context);
  assert.equal(result.success, true, result.error);
  return result.value;
}

describe('无大小写文字的裸模式名（R55）', () => {
  const describeSource = ENUM_ZH
    + '规则 描述 给定 s 作为 状态，产出 整数：\n  匹配于 s：\n    当 待处理，返回 1。\n    当 进行中，返回 2。\n'
    + '    当 其余，返回 9。\n\n'
    + '规则 删除后，产出 整数：\n  返回 描述(已删除)。\n\n'
    + '规则 进行时，产出 整数：\n  返回 描述(进行中)。\n';

  it('主语枚举的成员是变体，其余名字是绑定', () => {
    const ps = patterns(compileClean(describeSource, ZH_CN), '描述');
    assertVariant('待处理', ps[0]);
    assertVariant('进行中', ps[1]);
    assertBinding('其余', ps[2]);
  });

  it('变体只匹配同名成员，绑定兜底其余成员', () => {
    const core = compileClean(describeSource, ZH_CN);
    assert.equal(run(core, '进行时', {}), 2);
    assert.equal(run(core, '删除后', {}), 9);
  });

  it('非枚举主语下的名字是绑定', () => {
    const core = compileClean(ENUM_ZH
      + '规则 分类 给定 n 作为 整数，产出 整数：\n  匹配于 n：\n    当 0，返回 100。\n    当 其他，返回 其他 加上 1。\n', ZH_CN);
    assertBinding('其他', patterns(core, '分类')[1]);
    assert.equal(run(core, '分类', { n: 5 }), 6);
    assert.equal(run(core, '分类', { n: 0 }), 100);
  });

  it('非枚举主语下与枚举成员同名的名字仍是绑定', () => {
    const core = compileClean(ENUM_ZH
      + '规则 分类 给定 n 作为 整数，产出 整数：\n  匹配于 n：\n    当 待处理，返回 待处理 加上 1。\n', ZH_CN);
    assertBinding('待处理', patterns(core, '分类')[0]);
  });

  it('主语类型未知时精确命中的成员是变体，其余是绑定', () => {
    const ps = patterns(compileClean(ENUM_ZH
      + '规则 选择 给定 s，产出 整数：\n  匹配于 s：\n    当 已删除，返回 1。\n    当 别的，返回 2。\n', ZH_CN), '选择');
    assertVariant('已删除', ps[0]);
    assertBinding('别的', ps[1]);
  });

  it('de 变音字母开头的成员是变体，非成员是绑定', () => {
    const core = compileClean('Modul probe.de.\n\nDefiniere Laune als eines von Übel, Gut, Ärger.\n\n'
      + 'Regel wert gegeben l als Laune, liefert Ganzzahl:\n  pruefe l:\n    bei Übel, gib zurueck 1.\n'
      + '    bei Gut, gib zurueck 2.\n    bei rest, gib zurueck 9.\n\n'
      + 'Regel wAerger, liefert Ganzzahl:\n  gib zurueck wert(Laune.Ärger).\n\n'
      + 'Regel bind gegeben n als Ganzzahl, liefert Ganzzahl:\n  pruefe n:\n    bei 0, gib zurueck 100.\n'
      + '    bei Ärger, gib zurueck Ärger.\n', DE_DE);
    const ps = patterns(core, 'wert');
    assertVariant('Übel', ps[0]);
    assertVariant('Gut', ps[1]);
    assertBinding('rest', ps[2]);
    assertBinding('Ärger', patterns(core, 'bind')[1]);
    assert.equal(run(core, 'wAerger', {}), 9);
    assert.equal(run(core, 'bind', { n: 7 }), 7);
  });

  it('小写 ASCII 枚举成员是变体（本仓接受的写法）', () => {
    const core = compileClean('Module probe.lc.\n\nDefine Color as one of red, Green.\n\n'
      + 'Rule f given c as Color, produce Int:\n  Match c:\n    When red, Return 1.\n    When Green, Return 2.\n\n'
      + 'Rule g, produce Int:\n  Return f(Color.Green).\n');
    assertVariant('red', patterns(core, 'f')[0]);
    assert.equal(run(core, 'g', {}), 2);
  });

  it('首字母为 ASCII 大写的成员同样是 0 参 PatCtor（ADR 0055 #16）', () => {
    // en：成员不再靠首字母大写表达，统一为 PatCtor{typeName, args:[]}；小写绑定仍为 PatName
    const ps = patterns(compileClean('Module demo.cased.\n\nDefine Color as one of Red, Green.\n\n'
      + 'Rule f given c as Color, produce Int:\n  Match c:\n    When Red, Return 1.\n    When other, Return 2.\n'), 'f');
    assertVariant('Red', ps[0]);
    assertBinding('other', ps[1]);
  });
});
