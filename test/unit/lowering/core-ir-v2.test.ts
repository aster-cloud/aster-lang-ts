/**
 * Core IR v2 lowering（ADR 0055 #2–#19；实施计划 Task T2，与 core CoreLoweringV2Test 同名同断言）。
 * 每条用例编译一段源码，再断言 IR 形状；最后都经 readCoreIr 严格读回，保证输出满足 schema 与不变式。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileAndTypecheck } from '../../../src/browser.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import { readCoreIr } from '../../../src/core/read-core-ir.js';
import { serializeCoreIr } from '../../../src/core/serialize-core-ir.js';
import type { Core } from '../../../src/types.js';

function lower(source: string, lexicon?: Lexicon): Core.Module {
  const result = compile(source, lexicon ? { lexicon } : {});
  assert.equal(result.success, true, JSON.stringify(result.parseErrors));
  const core = result.core!;
  // 每份 lowering 输出都必须能被严格读方读回（schema + 不变式）
  readCoreIr(serializeCoreIr(core));
  return core;
}

function func(m: Core.Module, name: string): Core.Func {
  const f = m.decls.find((d): d is Core.Func => d.kind === 'Func' && d.name === name);
  assert.ok(f, `缺少函数 ${name}`);
  return f;
}

function patterns(f: Core.Func): Core.Pattern[] {
  const match = f.body.statements.find((s): s is Core.Match => s.kind === 'Match');
  assert.ok(match, `${f.name} 中没有 Match`);
  return match.cases.map((c) => c.pattern);
}

function parseErrorCodes(source: string): string[] {
  const result = compile(source, {});
  return (result.parseErrors ?? []).map((e) => String((e as { code?: string }).code));
}

/** 遍历 IR 中所有带 kind 的节点（含类型节点、约束、模式）。 */
function* nodes(x: unknown): Generator<{ kind: string; origin: Core.Origin }> {
  if (Array.isArray(x)) {
    for (const c of x) yield* nodes(c);
    return;
  }
  if (x === null || typeof x !== 'object') return;
  const o = x as Record<string, unknown>;
  if (typeof o.kind === 'string') yield o as unknown as { kind: string; origin: Core.Origin };
  for (const [k, v] of Object.entries(o)) if (k !== 'origin') yield* nodes(v);
}

describe('Core IR v2 lowering', () => {
  it('annotations_preserve_source_order', () => {
    const m = lower('Module m.\n\n@control("B")\n@id("X")\nRule f given x as Int, produce Int:\n  Return x.\n');
    assert.deepEqual(func(m, 'f').annotations.map((a) => a.name), ['control', 'id']);
  });

  it('annotation_args_preserve_source_order', () => {
    const m = lower('Module m.\n\n@sensitive("a", level: "L2", "b")\nRule f given x as Int, produce Int:\n  Return x.\n');
    const ann = func(m, 'f').annotations[0]!;
    assert.deepEqual(ann.args, [
      { name: '$0', value: 'a' },
      { name: 'level', value: 'L2' },
      { name: '$1', value: 'b' },
    ]);
  });

  it('field_required_and_between_lowered', () => {
    const m = lower('Module m.\n\nDefine P has age as Int required between 0 and 120.\n');
    const data = m.decls.find((d): d is Core.Data => d.kind === 'Data')!;
    const constraints = data.fields[0]!.constraints;
    assert.deepEqual(constraints.map((c) => c.kind), ['Required', 'Range']);
    const range = constraints[1] as Core.ConstraintRange;
    assert.equal(range.min, '0');
    assert.equal(range.max, '120');
    assert.ok(range.origin.start.line > 0, '约束必带 origin');
  });

  it('param_matching_lowered', () => {
    const m = lower('Module m.\n\nRule f given code as Text matching "^[A-Z]+$", produce Text:\n  Return code.\n');
    const [c] = func(m, 'f').params[0]!.constraints;
    assert.equal(c?.kind, 'Pattern');
    assert.equal((c as Core.ConstraintPattern).regexp, '^[A-Z]+$');
  });

  it('range_bounds_are_canonical_decimal_strings', () => {
    const m = lower('Module m.\n\nDefine P has rate as Double between 0.50 and 2.0.\n');
    const data = m.decls.find((d): d is Core.Data => d.kind === 'Data')!;
    const range = data.fields[0]!.constraints[0] as Core.ConstraintRange;
    assert.deepEqual([range.min, range.max], ['0.5', '2']);
  });

  it('effects_lowercased', () => {
    const m = lower('Module m.\n\nRule f given x as Int, produce Int. It performs IO:\n  Return x.\n');
    assert.deepEqual(func(m, 'f').effects, ['io']);
  });

  it('effects_keep_only_authorizing_names_and_declared_vars_deduplicated', () => {
    const m = lower(
      'Module m.\n\nRule f <E> given x as Int, produce Int. It performs io with E:\n  Return x.\n\n'
      + 'Rule g given x as Int, produce Int. It performs pure:\n  Return x.\n\n'
      + 'Rule h given x as Int, produce Int. It performs IO and CPU:\n  Return x.\n'
    );
    assert.deepEqual(func(m, 'f').effects, ['io', 'E']);
    assert.deepEqual(func(m, 'f').effectParams, ['E']);
    assert.deepEqual(func(m, 'g').effects, [], 'pure 不授权任何效应，不写入');
    assert.deepEqual(func(m, 'h').effects, ['io', 'cpu']);
  });

  it('effect_var_in_effect_position_accepted_and_undeclared_is_e210', () => {
    const m = lower('Module m.\n\nRule f <E> given x as Int, produce Int. It performs E:\n  Return x.\n');
    assert.deepEqual(func(m, 'f').effects, ['E']);
    // 与 Java 一致：效应位置上未声明的大写名字在解析期报 E210，IR 中不会出现未声明的效应变量
    assert.deepEqual(parseErrorCodes('Module m.\n\nRule f given x as Int, produce Int. It performs F:\n  Return x.\n'), ['E210']);
  });

  it('one_sided_range_and_matching_pattern_lowered', () => {
    const m = lower('Module m.\n\nDefine P has a as Int at least 5, b as Int at most 9.5, c as Text matching pattern "^x$".\n');
    const data = m.decls.find((d): d is Core.Data => d.kind === 'Data')!;
    const [a, b, c] = data.fields.map((f) => f.constraints[0]!);
    assert.deepEqual([(a as Core.ConstraintRange).min, (a as Core.ConstraintRange).max], ['5', null]);
    assert.deepEqual([(b as Core.ConstraintRange).min, (b as Core.ConstraintRange).max], [null, '9.5']);
    assert.deepEqual([c?.kind, (c as Core.ConstraintPattern).regexp], ['Pattern', '^x$']);
    for (const k of [a, b, c]) assert.ok(k!.origin.start.line > 0);
  });

  it('effect_param_shadowing_builtin_rejected', () => {
    for (const name of ['IO', 'Cpu', 'Pure', 'Async']) {
      const r = compileAndTypecheck(`Module m.\n\nRule g <${name}> given x as Int, produce Int:\n  Return x.\n`, {});
      const codes = (r.typeErrors ?? []).filter((d) => d.severity === 'error').map((d) => d.code);
      assert.ok(codes.includes('E213' as never), `<${name}> 应报 E213：${JSON.stringify(codes)}`);
    }
    const ok = compileAndTypecheck('Module m.\n\nRule f <E> given x as Int, produce Int. It performs io with E:\n  Return x.\n', {});
    assert.deepEqual((ok.typeErrors ?? []).filter((d) => d.code === ('E213' as never) || d.code === ('E005' as never)), []);
  });

  it('every_node_has_origin', () => {
    const m = lower(
      'Module m.\n\nUse risk.Scoring version 2 as Score.\n\nDefine P has age as Int between 0 and 120, tags as List of Text.\n\n'
      + 'Define Color as one of Red, Green.\n\n'
      + 'Rule pick given c as Color, xs as List of Int, produce Int:\n  Match c:\n    When Red, Return 1.\n    When Green, Return 2.\n\n'
      + 'Rule apply given n as Int, produce Int:\n  Let f be function with v as Int, produce Int:\n    Return v.\n  Return f(n).\n'
    );
    const all = [...nodes(m)];
    assert.ok(all.some((n) => n.kind === 'TypeName'));
    assert.ok(all.some((n) => n.kind === 'Lambda'));
    const missing = all.filter((n) => !n.origin || n.origin.start.line < 1).map((n) => n.kind);
    assert.deepEqual(missing, []);
  });

  it('func_type_has_origin', () => {
    const m = lower('Module m.\n\nRule run given f as (Int) -> Int, produce Int:\n  Return f(1).\n');
    const t = func(m, 'run').params[0]!.type;
    assert.equal(t.kind, 'FuncType');
    assert.ok(t.origin.start.line > 0);
    for (const p of (t as Core.FuncType).params) assert.ok(p.origin.start.line > 0);
  });

  it('import_uses_path_alias', () => {
    const m = lower('Module m.\n\nUse risk.Scoring version 2 as Score.\n\nUse Http.\n\nRule f given x as Int, produce Int:\n  Return x.\n');
    const imports = m.decls.filter((d): d is Core.Import => d.kind === 'Import');
    assert.deepEqual(imports.map(({ path, alias, version }) => ({ path, alias, version })), [
      { path: 'risk.Scoring', alias: 'Score', version: 2 },
      { path: 'Http', alias: null, version: null },
    ]);
  });

  it('patctor_uses_args_not_names', () => {
    const m = lower('Module m.\n\nRule f given r as Result of Int and Text, produce Int:\n  Match r:\n    When Ok(v), Return v.\n    When Err(e), Return 0.\n');
    const [ok] = patterns(func(m, 'f'));
    assert.equal(ok?.kind, 'PatCtor');
    assert.equal('names' in ok!, false);
    assert.deepEqual((ok as Core.PatCtor).args.map((a) => [a.kind, (a as Core.PatName).name]), [['PatName', 'v']]);
  });

  it('cjk_enum_variant_lowers_to_patctor', () => {
    const source = '模块 探针.样例。\n\n定义 结论 为以下之一 批准、拒绝、待定。\n\n'
      + '规则 打分 给定 c 作为 结论，产出 整数：\n  匹配于 c：\n    当 批准，返回 1。\n    当 拒绝，返回 2。\n    当 待定，返回 3。\n';
    const ps = patterns(func(lower(source, ZH_CN), '打分'));
    assert.deepEqual(ps.map((p) => [p.kind, (p as Core.PatCtor).args]), [['PatCtor', []], ['PatCtor', []], ['PatCtor', []]]);
  });

  it('ascii_enum_variant_lowers_to_patctor_and_binding_stays_patname', () => {
    const m = lower('Module m.\n\nDefine Color as one of Red, Green.\n\nRule f given c as Color, produce Int:\n  Match c:\n    When Red, Return 1.\n    When other, Return 2.\n');
    const [red, other] = patterns(func(m, 'f'));
    assert.deepEqual([red?.kind, (red as Core.PatCtor).typeName, (red as Core.PatCtor).args], ['PatCtor', 'Red', []]);
    assert.deepEqual([other?.kind, (other as Core.PatName).name], ['PatName', 'other']);
  });

  it('bare_none_pattern_is_patctor', () => {
    const m = lower('Module m.\n\nRule f given x as Int?, produce Int:\n  Match x:\n    When None, Return 0.\n    When Some(v), Return v.\n');
    const [none] = patterns(func(m, 'f'));
    assert.deepEqual([none?.kind, (none as Core.PatCtor).typeName, (none as Core.PatCtor).args], ['PatCtor', 'None', []]);
  });

  it('double_from_lexeme_not_double', () => {
    const m = lower('Module m.\n\nRule f, produce Double:\n  Return 123456789012345678901.5.\n');
    const ret = func(m, 'f').body.statements[0] as Core.Return;
    assert.deepEqual([ret.expr.kind, (ret.expr as Core.Double).value], ['Double', '123456789012345678901.5']);
  });

  it('double_literal_trailing_zeros_canonicalized', () => {
    const m = lower('Module m.\n\nRule f, produce Double:\n  Return 2.50.\n');
    assert.equal(((func(m, 'f').body.statements[0] as Core.Return).expr as Core.Double).value, '2.5');
  });

  it('annotation_value_float_is_diagnostic', () => {
    // 与 Java AstBuilder 同码同参数：浮点、Long 与 null → E067（construct token.annotationArgumentValue）
    for (const [value, code] of [['1.5', 'E067'], ['5L', 'E067'], ['null', 'E067']] as const) {
      const result = compile(`Module m.\n\n@x(${value})\nRule f given x as Int, produce Int:\n  Return x.\n`, {});
      const [err] = (result.parseErrors ?? []) as { code?: string; params?: Record<string, unknown> }[];
      assert.equal(err?.code, code, `@x(${value})`);
      if (code === 'E067') {
        assert.deepEqual(err?.params, { construct: 'token.annotationArgumentValue', value, allowed: 'string, Int or Bool' });
      }
    }
    // 字符串、Int32、布尔仍然接受
    const m = lower('Module m.\n\n@x("s", n: 2147483647, b: true)\nRule f given x as Int, produce Int:\n  Return x.\n');
    assert.deepEqual(func(m, 'f').annotations[0]!.args.map((a) => a.value), ['s', 2147483647, true]);
  });

  it('duplicate_annotation_arg_is_e900', () => {
    assert.deepEqual(parseErrorCodes('Module m.\n\n@x(level: "a", level: "b")\nRule f given x as Int, produce Int:\n  Return x.\n'), ['E900']);
  });

  it('no_phantom_type_params', () => {
    const m = lower('Module m.\n\nRule f given x as Int:\n  Return x.\n\nRule g given x:\n  Return x.\n');
    assert.deepEqual(func(m, 'f').typeParams, []);
    assert.equal(func(m, 'f').retTypeInferred, true);
    assert.deepEqual(func(m, 'g').typeParams, []);
  });

  it('empty_fields_emitted', () => {
    const m = lower('Module m.\n\nDefine P has age as Int.\n\nRule f given x as Int, produce Int:\n  Return x.\n');
    const bytes = serializeCoreIr(m);
    for (const fragment of ['"schemaVersion":2', '"profile":null', '"annotations":[]', '"retAnnotations":[]', '"constraints":[]',
      '"typeInferred":false', '"retTypeInferred":false', '"inputRefs":null', '"effectParams":[]', '"written":null', '"role":null']) {
      assert.ok(bytes.includes(fragment), fragment);
    }
    for (const gone of ['"declaredEffects"', '"piiLevel"', '"piiCategories"', '"names"', '"retType"', '"asName"']) {
      assert.equal(bytes.includes(gone), false, gone);
    }
  });

  it('inferred_param_and_field_types_marked', () => {
    const m = lower('Module m.\n\nDefine P has name.\n\nRule f given name, produce Text:\n  Return name.\n');
    const data = m.decls.find((d): d is Core.Data => d.kind === 'Data')!;
    assert.equal(data.fields[0]!.typeInferred, true);
    assert.equal(func(m, 'f').params[0]!.typeInferred, true);
  });
});
