/**
 * @module test/unit/core/resolve-typed-references.test
 *
 * R2 类型驱动解析（ADR 0051 §4 三态表、§6.2 期望枚举跨层裁决）。
 * 除特别注明外均为 解析器 → R1 → lower → R2 端到端。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parseWithLexicon } from '../../../src/parser.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import { buildVocabularyScopes } from '../../../src/config/lexicons/identifiers/scopes.js';
import { IdentifierKind } from '../../../src/config/lexicons/identifiers/types.js';
import type { DomainVocabulary, IdentifierMapping } from '../../../src/config/lexicons/identifiers/types.js';
import { resolveDeclarations } from '../../../src/frontend/resolve-declarations.js';
import { NO_IMPORTS } from '../../../src/frontend/resolution-context.js';
import type { ResolutionContext } from '../../../src/frontend/resolution-context.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { resolveTypedReferences } from '../../../src/core/resolve-typed-references.js';
import { resolutionMarkOf } from '../../../src/core/resolution-mark.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import type * as AST from '../../../src/types.js';
import type { Core, TypecheckDiagnostic } from '../../../src/types.js';

function parse(source: string, lexicon: Lexicon = DE_DE): AST.Module {
  const tokens = lex(canonicalize(source, lexicon), lexicon);
  const result = parseWithLexicon(tokens, lexicon);
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  return result.ast;
}

const struct = (canonical: string, localized: string): IdentifierMapping => ({
  canonical, localized, kind: IdentifierKind.STRUCT,
});
const field = (parent: string, canonical: string, localized: string): IdentifierMapping => ({
  canonical, localized, kind: IdentifierKind.FIELD, parent,
});
const member = (parent: string, canonical: string, localized: string): IdentifierMapping => ({
  canonical, localized, kind: IdentifierKind.ENUM_VALUE, parent,
});
const fn = (canonical: string, localized: string): IdentifierMapping => ({
  canonical, localized, kind: IdentifierKind.FUNCTION,
});

function ctxOf(mappings: IdentifierMapping[]): ResolutionContext {
  const vocab: DomainVocabulary = {
    id: 't', name: 't', locale: 'de-DE', version: '1',
    structs: mappings.filter((m) => m.kind === IdentifierKind.STRUCT),
    fields: mappings.filter((m) => m.kind === IdentifierKind.FIELD),
    functions: mappings.filter((m) => m.kind === IdentifierKind.FUNCTION),
    enumValues: mappings.filter((m) => m.kind === IdentifierKind.ENUM_VALUE),
  };
  return { scopes: buildVocabularyScopes(vocab), imports: NO_IMPORTS };
}

interface Run {
  readonly module: Core.Module;
  readonly r1: readonly TypecheckDiagnostic[];
  readonly r2: readonly TypecheckDiagnostic[];
}

/** 解析器 → R1 → lower → R2；edit 用于改写解析器无法直接产出的 AST 形状。 */
function run(
  source: string,
  mappings: IdentifierMapping[],
  lexicon: Lexicon = DE_DE,
  edit: (m: AST.Module) => AST.Module = (m) => m
): Run {
  const ctx = ctxOf(mappings);
  const r1 = resolveDeclarations(edit(parse(source, lexicon)), ctx);
  const r2 = resolveTypedReferences(lowerModule(r1.module), ctx);
  return { module: r2.module, r1: r1.diagnostics, r2: r2.diagnostics };
}

const codes = (ds: readonly TypecheckDiagnostic[]): string[] => ds.map((d) => d.code);

function func(m: Core.Module, name: string): Core.Func {
  const f = m.decls.find((d): d is Core.Func => d.kind === 'Func' && d.name === name);
  assert.ok(f, `函数 ${name} 不存在`);
  return f;
}

function stmt<K extends Core.Statement['kind']>(f: Core.Func, i: number, kind: K): Extract<Core.Statement, { kind: K }> {
  const s = f.body.statements[i];
  assert.ok(s && s.kind === kind, `body[${i}] 应为 ${kind}，实为 ${s?.kind}`);
  return s as Extract<Core.Statement, { kind: K }>;
}

function returned(f: Core.Func, i: number): Core.Expression {
  return stmt(f, i, 'Return').expr;
}

function nameOf(e: Core.Expression): Core.Name {
  assert.equal(e.kind, 'Name');
  return e as Core.Name;
}

const MODULE = 'Modul m.\n\n';
const DRIVER_DECL = 'Definiere Fahrer hat alter als Ganzzahl.\n\n';
const LEVEL_DECL = 'Definiere Stufe als eines von Hoch, Niedrig.\n\n';
const DRIVER = [struct('Driver', 'Fahrer'), field('Driver', 'age', 'alter')];
const LEVEL = [struct('Level', 'Stufe'), member('Level', 'High', 'Hoch'), member('Level', 'Low', 'Niedrig')];

describe('resolveTypedReferences（R2）', () => {
  describe('FIELD_REF：点分后续段与 Set 目标', () => {
    it('x 为 Fahrer 参数：x.alter → x.age，origin 记原写法与角色', () => {
      const { module, r1, r2 } = run(
        MODULE + DRIVER_DECL + 'Regel f gegeben x als Fahrer, liefert Ganzzahl:\n  gib zurueck x.alter.\n',
        DRIVER
      );
      assert.deepEqual([...codes(r1), ...codes(r2)], []);
      const n = nameOf(returned(func(module, 'f'), 0));
      assert.equal(n.name, 'x.age');
      assert.equal(n.origin?.written, 'x.alter');
      assert.equal(n.origin?.role, 'FIELD_REF');
    });

    it('多段路径按每段的声明类型解析', () => {
      const { module, r2 } = run(
        MODULE +
          'Definiere Halter hat fahrer als Fahrer.\n\n' + DRIVER_DECL +
          'Regel f gegeben h als Halter, liefert Ganzzahl:\n  gib zurueck h.fahrer.alter.\n',
        [...DRIVER, struct('Owner', 'Halter'), field('Owner', 'driver', 'fahrer')]
      );
      assert.deepEqual(codes(r2), []);
      assert.equal(nameOf(returned(func(module, 'f'), 0)).name, 'h.driver.age');
    });

    it('Set x.alter → x.age（解析器只接受单段 Set 目标，AST 中改写为点分名）', () => {
      const toDotted = (m: AST.Module): AST.Module => ({
        ...m,
        decls: m.decls.map((d) =>
          d.kind === 'Func' && d.body
            ? {
                ...d,
                body: {
                  ...d.body,
                  statements: d.body.statements.map((s) => (s.kind === 'Set' ? { ...s, name: 'x.alter' } : s)),
                },
              }
            : d
        ),
      });
      const { module, r2 } = run(
        MODULE + DRIVER_DECL + 'Regel f gegeben x als Fahrer, liefert Ganzzahl:\n  setze x auf 5.\n  gib zurueck 1.\n',
        DRIVER,
        DE_DE,
        toDotted
      );
      assert.deepEqual(codes(r2), []);
      const set = stmt(func(module, 'f'), 0, 'Set');
      assert.equal(set.name, 'x.age');
      assert.equal(set.origin?.written, 'x.alter');
      assert.equal(set.origin?.role, 'FIELD_REF');
    });

    it('类型已知但字段不存在 → E801', () => {
      const { r2 } = run(
        MODULE + DRIVER_DECL + 'Regel f gegeben x als Fahrer, liefert Ganzzahl:\n  gib zurueck x.gewicht.\n',
        DRIVER
      );
      assert.deepEqual(codes(r2), [ErrorCode.UNRESOLVED_FIELD]);
    });

    it('首段不是局部名（限定调用的命名空间）→ 原样保留，不报错', () => {
      const { module, r2 } = run(
        'Module m.\n\nRule f given t as Text, produce Int:\n  Return Text.length(t).\n',
        [],
        EN_US
      );
      assert.deepEqual(codes(r2), []);
      const call = returned(func(module, 'f'), 0) as Core.Call;
      assert.equal(nameOf(call.target).name, 'Text.length');
    });
  });

  describe('Let 无注解右侧：只用显式声明类型', () => {
    const lets: Array<[string, string]> = [
      ['字面量', '1'],
      ['ListLiteral', '[x]'],
      ['Some', 'einige von x'],
      ['IfExpr', 'wenn wahr dann x sonst x'],
    ];
    for (const [label, rhs] of lets) {
      it(`右侧为${label} → 类型未知，全局唯一候选采用 + W801`, () => {
        const { module, r2 } = run(
          MODULE + DRIVER_DECL +
            `Regel f gegeben x als Fahrer, liefert Ganzzahl:\n  sei y gleich ${rhs}.\n  gib zurueck y.alter.\n`,
          DRIVER
        );
        assert.deepEqual(codes(r2), [ErrorCode.RESOLVED_WITHOUT_TYPE]);
        assert.equal(r2[0]!.severity, 'warning');
        assert.equal(nameOf(returned(func(module, 'f'), 1)).name, 'y.age');
      });
    }

    it('右侧为构造 X with … → 类型为 X，无 W801', () => {
      const { module, r2 } = run(
        MODULE + DRIVER_DECL +
          'Regel f gegeben x als Ganzzahl, liefert Ganzzahl:\n  sei y gleich Fahrer mit alter setze auf x.\n  gib zurueck y.alter.\n',
        DRIVER
      );
      assert.deepEqual(codes(r2), []);
      assert.equal(nameOf(returned(func(module, 'f'), 1)).name, 'y.age');
    });

    it('右侧为对源码函数的直接调用 → 声明返回类型，无 W801', () => {
      const { module, r2 } = run(
        MODULE + DRIVER_DECL +
          'Regel neu gegeben x als Ganzzahl, liefert Fahrer:\n  gib zurueck Fahrer mit alter setze auf x.\n\n' +
          'Regel f gegeben x als Ganzzahl, liefert Ganzzahl:\n  sei y gleich neu(x).\n  gib zurueck y.alter.\n',
        DRIVER
      );
      assert.deepEqual(codes(r2), []);
      assert.equal(nameOf(returned(func(module, 'f'), 1)).name, 'y.age');
    });

    it('类型未知且多个结构体各有 alter → E805', () => {
      const { r2 } = run(
        MODULE + DRIVER_DECL + 'Definiere Halter hat alter als Ganzzahl.\n\n' +
          'Regel f gegeben x als Ganzzahl, liefert Ganzzahl:\n  sei y gleich 1.\n  gib zurueck y.alter.\n',
        [...DRIVER, struct('Owner', 'Halter'), field('Owner', 'years', 'alter')]
      );
      assert.deepEqual(codes(r2), [ErrorCode.AMBIGUOUS_FIELD]);
    });

    it('类型未知且零候选 → E801', () => {
      const { r2 } = run(
        MODULE + DRIVER_DECL +
          'Regel f gegeben x als Ganzzahl, liefert Ganzzahl:\n  sei y gleich 1.\n  gib zurueck y.gewicht.\n',
        DRIVER
      );
      assert.deepEqual(codes(r2), [ErrorCode.UNRESOLVED_FIELD]);
    });
  });

  describe('期望类型为枚举时的裸单段名', () => {
    it('Return Hoch（返回类型 Stufe）→ Level.High', () => {
      const { module, r1, r2 } = run(
        MODULE + LEVEL_DECL + 'Regel f gegeben x als Ganzzahl, liefert Stufe:\n  gib zurueck Hoch.\n',
        LEVEL
      );
      assert.deepEqual([...codes(r1), ...codes(r2)], []);
      const n = nameOf(returned(func(module, 'f'), 0));
      assert.equal(n.name, 'Level.High');
      assert.equal(n.origin?.written, 'Hoch');
      assert.equal(n.origin?.role, 'MEMBER_REF');
    });

    it('规则 hoch 同时存在 → E804（不静默择一）', () => {
      const { r2 } = run(
        MODULE + LEVEL_DECL +
          'Regel hoch gegeben x als Ganzzahl, liefert Ganzzahl:\n  gib zurueck x.\n\n' +
          'Regel f gegeben x als Ganzzahl, liefert Stufe:\n  gib zurueck Hoch.\n',
        LEVEL
      );
      assert.deepEqual(codes(r2), [ErrorCode.AMBIGUOUS_NAME]);
      assert.match(r2[0]!.message, /Level\.High|High/);
    });

    it('词汇函数同写法 → E804', () => {
      const { r2 } = run(
        MODULE + LEVEL_DECL + 'Regel f gegeben x als Ganzzahl, liefert Stufe:\n  gib zurueck Hoch.\n',
        [...LEVEL, fn('raise', 'hoch')]
      );
      assert.deepEqual(codes(r2), [ErrorCode.AMBIGUOUS_NAME]);
    });

    it('局部名命中 → 取局部名并报 W800', () => {
      const { module, r2 } = run(
        MODULE + LEVEL_DECL + 'Regel f gegeben hoch als Stufe, liefert Stufe:\n  gib zurueck Hoch.\n',
        LEVEL
      );
      assert.deepEqual(codes(r2), [ErrorCode.SHADOWED_VOCABULARY]);
      assert.equal(nameOf(returned(func(module, 'f'), 0)).name, 'hoch');
    });

    it('调用实参按被调函数参数类型解析', () => {
      const { module, r2 } = run(
        MODULE + LEVEL_DECL +
          'Regel g gegeben s als Stufe, liefert Stufe:\n  gib zurueck s.\n\n' +
          'Regel f gegeben x als Ganzzahl, liefert Stufe:\n  gib zurueck g(Niedrig).\n',
        LEVEL
      );
      assert.deepEqual(codes(r2), []);
      const call = returned(func(module, 'f'), 0) as Core.Call;
      assert.equal(nameOf(call.args[0]!).name, 'Level.Low');
    });

    it('ConstructField 按字段声明类型解析', () => {
      const { module, r2 } = run(
        MODULE + LEVEL_DECL + 'Definiere Fahrer hat stufe als Stufe.\n\n' +
          'Regel f gegeben x als Ganzzahl, liefert Fahrer:\n  gib zurueck Fahrer mit stufe setze auf Hoch.\n',
        [...LEVEL, struct('Driver', 'Fahrer'), field('Driver', 'level', 'stufe')]
      );
      assert.deepEqual(codes(r2), []);
      const c = returned(func(module, 'f'), 0) as Core.Construct;
      assert.equal(c.typeName, 'Driver');
      assert.equal(c.fields[0]!.name, 'level');
      assert.equal(nameOf(c.fields[0]!.expr).name, 'Level.High');
    });

    it('无期望类型的裸成员名不按枚举解析 → E802', () => {
      const { r2 } = run(
        MODULE + LEVEL_DECL +
          'Regel f gegeben x als Ganzzahl, liefert Ganzzahl:\n  sei y gleich Hoch.\n  gib zurueck x.\n',
        LEVEL
      );
      assert.deepEqual(codes(r2), [ErrorCode.UNRESOLVED_NAME]);
    });

    it('无期望类型的未知裸名 → E802；运算符与 R1 已解析的名字不报', () => {
      const { r2 } = run(
        MODULE + 'Regel f gegeben x als Ganzzahl, liefert Ganzzahl:\n  gib zurueck x plus unbekannt.\n',
        []
      );
      assert.deepEqual(codes(r2), [ErrorCode.UNRESOLVED_NAME]);
      assert.match(r2[0]!.message, /unbekannt/);
    });
  });

  describe('模式匹配', () => {
    it('主语为参数：bei Hoch（PatternName）按主语枚举解析为成员', () => {
      const { module, r2 } = run(
        MODULE + LEVEL_DECL +
          'Regel f gegeben s als Stufe, liefert Ganzzahl:\n  pruefe s:\n    bei Hoch, gib zurueck 1.\n    bei andere, gib zurueck 2.\n',
        LEVEL
      );
      assert.deepEqual(codes(r2), []);
      const cases = stmt(func(module, 'f'), 0, 'Match').cases;
      const first = cases[0]!.pattern as Core.PatName;
      assert.equal(first.name, 'High');
      assert.equal(first.origin?.written, 'Hoch');
      assert.equal(first.origin?.role, 'MEMBER_REF');
      assert.equal((cases[1]!.pattern as Core.PatName).name, 'andere');
    });

    it('主语为构造得到的 Let：bei Fahrer(a) 按主语类型解析', () => {
      const { module, r2 } = run(
        MODULE + DRIVER_DECL +
          'Regel f gegeben x als Ganzzahl, liefert Ganzzahl:\n  sei d gleich Fahrer mit alter setze auf x.\n' +
          '  pruefe d:\n    bei Fahrer(a), gib zurueck a.\n',
        DRIVER
      );
      assert.deepEqual(codes(r2), []);
      const pat = stmt(func(module, 'f'), 1, 'Match').cases[0]!.pattern as Core.PatCtor;
      assert.equal(pat.typeName, 'Driver');
      assert.deepEqual(pat.names, ['a']);
    });

    it('主语未知、全部枚举成员与构造器中唯一 → 采用 + W801', () => {
      const { module, r2 } = run(
        MODULE + LEVEL_DECL +
          'Regel f gegeben x als Ganzzahl, liefert Ganzzahl:\n  sei s gleich 1.\n' +
          '  pruefe s:\n    bei Hoch(), gib zurueck 1.\n    bei Niedrig, gib zurueck 2.\n',
        LEVEL
      );
      assert.deepEqual(codes(r2), [ErrorCode.RESOLVED_WITHOUT_TYPE, ErrorCode.RESOLVED_WITHOUT_TYPE]);
      const cases = stmt(func(module, 'f'), 1, 'Match').cases;
      assert.equal((cases[0]!.pattern as Core.PatCtor).typeName, 'High');
      assert.equal((cases[1]!.pattern as Core.PatName).name, 'Low');
    });

    it('主语未知、多个候选 → E806', () => {
      const { r2 } = run(
        MODULE + LEVEL_DECL + 'Definiere Rang als eines von Hoch, Mittel.\n\n' +
          'Regel f gegeben x als Ganzzahl, liefert Ganzzahl:\n  sei s gleich 1.\n' +
          '  pruefe s:\n    bei Hoch(), gib zurueck 1.\n    bei Hoch, gib zurueck 2.\n',
        [...LEVEL, struct('Priority', 'Rang'), member('Priority', 'Top', 'Hoch'), member('Priority', 'Mid', 'Mittel')]
      );
      assert.deepEqual(codes(r2), [ErrorCode.AMBIGUOUS_PATTERN, ErrorCode.AMBIGUOUS_PATTERN]);
    });

    it('主语未知、零候选 → 构造器 E803；小写模式名仍为绑定', () => {
      const { module, r2 } = run(
        MODULE + 'Regel f gegeben x als Ganzzahl, liefert Ganzzahl:\n  sei s gleich 1.\n' +
          '  pruefe s:\n    bei Riesig(), gib zurueck 1.\n    bei wert, gib zurueck wert.\n',
        []
      );
      assert.deepEqual(codes(r2), [ErrorCode.UNRESOLVED_PATTERN]);
      const cases = stmt(func(module, 'f'), 1, 'Match').cases;
      assert.equal((cases[1]!.pattern as Core.PatName).name, 'wert');
    });
  });

  describe('其它位置', () => {
    it('UFCS：x.berechne() 的方法名按函数解析', () => {
      const { module, r2 } = run(
        MODULE + DRIVER_DECL +
          'Regel berechne gegeben d als Fahrer, liefert Ganzzahl:\n  gib zurueck d.alter.\n\n' +
          'Regel f gegeben x als Fahrer, liefert Ganzzahl:\n  gib zurueck x.berechne().\n',
        [...DRIVER, fn('compute', 'berechne')]
      );
      assert.deepEqual(codes(r2), []);
      const call = returned(func(module, 'f'), 0) as Core.Call;
      assert.equal(nameOf(call.target).name, 'compute');
      assert.equal(nameOf(call.args[0]!).name, 'x');
    });

    it('限定调用：首段折叠命中局部名也不按字段路径解析；UFCS 接收者为命名空间时不报 E802', () => {
      const { module, r2 } = run(
        'Module m.\n\nRule f given action as Text, produce Bool. It performs io:\n' +
          '  Let x be io.get(action).\n  Return Action.equals(action, "a").\n',
        [],
        EN_US
      );
      assert.deepEqual(codes(r2), []);
      const call = returned(func(module, 'f'), 1) as Core.Call;
      assert.equal(nameOf(call.target).name, 'Action.equals');
      const ufcs = stmt(func(module, 'f'), 0, 'Let').expr as Core.Call;
      assert.deepEqual([nameOf(ufcs.target).name, nameOf(ufcs.args[0]!).name], ['get', 'io']);
    });

    it('lambda：期望类型取 lambda 声明返回类型，捕获列表随解析结果改写', () => {
      const { module, r2 } = run(
        'Module m.\n\nDefine Stufe as one of Hoch, Niedrig.\n\n' +
          'Rule f given outer as Int, produce Int:\n' +
          '  Let g be function with x as Int, produce Stufe:\n' +
          '    Let unused be outer.\n' +
          '    Return Hoch.\n' +
          '  Return outer.\n',
        LEVEL,
        EN_US
      );
      assert.deepEqual(codes(r2), []);
      const lambda = stmt(func(module, 'f'), 0, 'Let').expr as Core.Lambda;
      const ret = lambda.body.statements[1] as Core.Return;
      assert.equal(nameOf(ret.expr).name, 'Level.High');
      assert.deepEqual(lambda.captures, ['outer']);
    });
  });

  describe('Core 不变量', () => {
    const SOURCE =
      MODULE + LEVEL_DECL + 'Definiere Fahrer hat alter als Ganzzahl, stufe als Stufe.\n\n' +
      'Regel bewerten gegeben fahrer als Fahrer, liefert Stufe:\n' +
      '  sei a gleich fahrer.alter.\n' +
      '  pruefe fahrer.stufe:\n    bei Hoch, gib zurueck Niedrig.\n    bei Niedrig, gib zurueck Hoch.\n';
    const VOCAB = [...LEVEL, ...DRIVER, field('Driver', 'level', 'stufe'), fn('check', 'bewerten')];
    const LOCALIZED = ['Stufe', 'Hoch', 'Niedrig', 'Fahrer', 'alter', 'stufe', 'bewerten'];

    function collect(node: unknown, names: string[], origins: Core.CoreNode['origin'][]): void {
      if (Array.isArray(node)) return node.forEach((x) => collect(x, names, origins));
      if (!node || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node)) {
        if (k === 'origin') origins.push(v as Core.CoreNode['origin']);
        else if (typeof v === 'string' && ['name', 'typeName', 'base'].includes(k)) names.push(...v.split('.'));
        else if (k === 'variants' || k === 'names') names.push(...(v as string[]));
        else collect(v, names, origins);
      }
    }

    it('解析后 Core 中无本地化名；origin.written/role 仅在 written !== canonical 时出现', () => {
      const { module, r1, r2 } = run(SOURCE, VOCAB);
      assert.deepEqual([...codes(r1), ...codes(r2)], []);
      const names: string[] = [];
      const origins: Core.CoreNode['origin'][] = [];
      collect(module, names, origins);
      assert.deepEqual(names.filter((n) => LOCALIZED.includes(n)), []);
      for (const o of origins) {
        if (o?.written === undefined && o?.role === undefined) continue;
        assert.ok(o.written !== undefined && o.role !== undefined, '两者同时出现');
      }
      const withWritten = origins.filter((o) => o?.written !== undefined).map((o) => o!.written);
      assert.ok(withWritten.includes('fahrer.alter'));
      assert.ok(withWritten.includes('Hoch'));
      const f = func(module, 'check');
      assert.equal(f.origin?.written, 'bewerten');
      assert.equal(f.origin?.role, 'FUNC_DECL');
      // 局部名 fahrer 未改写：其节点 origin 不带 written
      const let0 = stmt(f, 0, 'Let');
      assert.equal(let0.origin?.written, undefined);
    });

    it('规范名直写的源码：origin 不带 written/role', () => {
      const { module, r2 } = run(
        'Module m.\n\nDefine Driver has age as Int.\n\nRule f given d as Driver, produce Int:\n  Return d.age.\n',
        DRIVER,
        EN_US
      );
      assert.deepEqual(codes(r2), []);
      const origins: Core.CoreNode['origin'][] = [];
      collect(module, [], origins);
      assert.deepEqual(origins.filter((o) => o?.written !== undefined || o?.role !== undefined), []);
    });

    it('任一 E8xx 时 diagnostics 非空（调用方据此不发出 IR）', () => {
      const { r2 } = run(
        MODULE + DRIVER_DECL + 'Regel f gegeben x als Fahrer, liefert Ganzzahl:\n  gib zurueck x.gewicht.\n',
        DRIVER
      );
      assert.ok(r2.some((d) => d.severity === 'error' && d.code.startsWith('E80')));
    });

    it('R2 消费标记：输出中不再携带 ResolutionMark，输入 Core 不被修改', () => {
      const ctx = ctxOf(DRIVER);
      const r1 = resolveDeclarations(
        parse(MODULE + DRIVER_DECL + 'Regel f gegeben x als Fahrer, liefert Ganzzahl:\n  gib zurueck x.alter.\n'),
        ctx
      );
      const core = lowerModule(r1.module);
      const before = nameOf(returned(func(core, 'f'), 0));
      assert.equal(before.name, 'x.alter');
      assert.ok(resolutionMarkOf(before));
      const out = resolveTypedReferences(core, ctx).module;
      assert.equal(before.name, 'x.alter');
      assert.equal(resolutionMarkOf(nameOf(returned(func(out, 'f'), 0))), undefined);
    });
  });

  describe('lower 在未运行 R1 时行为不变', () => {
    it('无 resolved 的 AST：名字保持原写法，origin 不带 written/role', () => {
      const ast = parse(MODULE + DRIVER_DECL + 'Regel f gegeben x als Fahrer, liefert Ganzzahl:\n  gib zurueck x.alter.\n');
      const core = lowerModule(ast);
      const json = JSON.stringify(core);
      assert.ok(!json.includes('"written"'));
      assert.ok(!json.includes('"role"'));
      assert.equal(nameOf(returned(func(core, 'f'), 0)).name, 'x.alter');
      assert.equal((core.decls[0] as Core.Data).name, 'Fahrer');
    });
  });
});
