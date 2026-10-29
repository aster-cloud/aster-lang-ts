/**
 * @module test/unit/frontend/resolve-declarations.test
 *
 * R1 声明与类型位置名称解析（ADR 0051 §5、§6.1、§6.2 第 1/2/4/5 步）。
 * 源码在无词汇替换的情况下解析，再直接调用 resolveDeclarations。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parseWithLexicon } from '../../../src/parser.js';
import { Node } from '../../../src/ast/ast.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import { buildVocabularyScopes } from '../../../src/config/lexicons/identifiers/scopes.js';
import { IdentifierKind } from '../../../src/config/lexicons/identifiers/types.js';
import type { DomainVocabulary, IdentifierMapping } from '../../../src/config/lexicons/identifiers/types.js';
import { resolveDeclarations } from '../../../src/frontend/resolve-declarations.js';
import { NO_IMPORTS } from '../../../src/frontend/resolution-context.js';
import type { ImportedDeclarations, ResolutionContext } from '../../../src/frontend/resolution-context.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import type * as AST from '../../../src/types.js';

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

function ctxOf(mappings: IdentifierMapping[], imports: ImportedDeclarations = NO_IMPORTS): ResolutionContext {
  const vocab: DomainVocabulary = {
    id: 't', name: 't', locale: 'de-DE', version: '1',
    structs: mappings.filter((m) => m.kind === IdentifierKind.STRUCT),
    fields: mappings.filter((m) => m.kind === IdentifierKind.FIELD),
    functions: mappings.filter((m) => m.kind === IdentifierKind.FUNCTION),
    enumValues: mappings.filter((m) => m.kind === IdentifierKind.ENUM_VALUE),
  };
  return { scopes: buildVocabularyScopes(vocab), imports };
}

const DRIVER = [struct('Driver', 'Fahrer'), field('Driver', 'age', 'alter')];
const LEVEL = [
  struct('Level', 'Stufe'),
  field('Driver', 'level', 'stufe'),
  member('Level', 'High', 'Hoch'),
  member('Level', 'Low', 'Niedrig'),
];

function decl<K extends AST.Declaration['kind']>(m: AST.Module, i: number, kind: K): Extract<AST.Declaration, { kind: K }> {
  const d = m.decls[i];
  assert.ok(d && d.kind === kind, `decls[${i}] 应为 ${kind}`);
  return d as Extract<AST.Declaration, { kind: K }>;
}

function bodyStmt(f: AST.Func, i: number): AST.Statement {
  const s = f.body?.statements[i];
  assert.ok(s, `body[${i}] 不存在`);
  return s;
}

const codes = (r: { diagnostics: readonly { code: string }[] }): string[] => r.diagnostics.map((d) => d.code);

describe('resolveDeclarations（R1）', () => {
  it('Definiere Fahrer hat alter → Data Driver，字段 age', () => {
    const m = parse('Modul m.\n\nDefiniere Fahrer hat alter als Ganzzahl.\n');
    const r = resolveDeclarations(m, ctxOf(DRIVER));
    const data = decl(r.module, 0, 'Data');
    assert.equal(data.name, 'Fahrer', '原写法保持');
    assert.deepEqual(data.resolved, { canonical: 'Driver', role: 'TYPE_DECL', written: 'Fahrer' });
    assert.deepEqual(data.fields[0]!.resolved, { canonical: 'age', role: 'FIELD_DECL', written: 'alter' });
    assert.deepEqual(codes(r), []);
  });

  it('struct Stufe↔Level 与 field stufe↔level 并存 → 类型位置 Level、字段声明 level', () => {
    const m = parse(
      'Modul m.\n\nDefiniere Stufe als eines von Hoch, Niedrig.\n\nDefiniere Fahrer hat stufe als Stufe.\n'
    );
    const r = resolveDeclarations(m, ctxOf([...DRIVER, ...LEVEL]));
    const en = decl(r.module, 0, 'Enum');
    assert.equal(en.resolved?.canonical, 'Level');
    assert.deepEqual(
      en.resolvedVariants?.map((v) => [v.canonical, v.role]),
      [['High', 'MEMBER_DECL'], ['Low', 'MEMBER_DECL']]
    );
    const data = decl(r.module, 1, 'Data');
    const f = data.fields[0]!;
    assert.deepEqual(f.resolved, { canonical: 'level', role: 'FIELD_DECL', written: 'stufe' });
    assert.equal(f.type.kind, 'TypeName');
    assert.deepEqual((f.type as AST.TypeName).resolved, { canonical: 'Level', role: 'TYPE', written: 'Stufe' });
    assert.deepEqual(codes(r), []);
  });

  it('参数 fahrer als Fahrer → 参数名保持 fahrer（LOCAL），类型 Driver', () => {
    const m = parse(
      'Modul m.\n\nDefiniere Fahrer hat alter als Ganzzahl.\n\n' +
        'Regel f gegeben fahrer als Fahrer, liefert Fahrer:\n  gib zurueck fahrer.\n'
    );
    const r = resolveDeclarations(m, ctxOf(DRIVER));
    const f = decl(r.module, 1, 'Func');
    const p = f.params[0]!;
    assert.equal(p.name, 'fahrer');
    assert.deepEqual(p.resolved, { canonical: 'fahrer', role: 'LOCAL', written: 'fahrer' });
    assert.equal((p.type as AST.TypeName).resolved?.canonical, 'Driver');
    assert.equal((f.retType as AST.TypeName).resolved?.canonical, 'Driver');
    const ret = bodyStmt(f, 0) as AST.Return;
    assert.deepEqual((ret.expr as AST.Name).resolved, { canonical: 'fahrer', role: 'LOCAL', written: 'fahrer' });
    assert.deepEqual(codes(r), [], '折叠命中词汇不构成遮蔽');
  });

  it('list of / Result of / Map 嵌套类型参数全部解析为 Driver', () => {
    const m = parse(
      'Module m.\n\nDefine Fahrer has freunde as list of Fahrer, index as map Text to Fahrer.\n\n' +
        'Rule f given fahrer as Fahrer, produce Result of Fahrer or Text:\n  Return ok of fahrer.\n',
      EN_US
    );
    const r = resolveDeclarations(m, ctxOf(DRIVER));
    const data = decl(r.module, 0, 'Data');
    const list = data.fields[0]!.type as AST.List;
    assert.equal((list.type as AST.TypeName).resolved?.canonical, 'Driver');
    const map = data.fields[1]!.type as AST.Map;
    assert.equal((map.val as AST.TypeName).resolved?.canonical, 'Driver');
    assert.equal((map.key as AST.TypeName).resolved?.canonical, 'Text');
    const f = decl(r.module, 1, 'Func');
    const res = f.retType as AST.Result;
    assert.equal((res.ok as AST.TypeName).resolved?.canonical, 'Driver');
    assert.equal((res.err as AST.TypeName).resolved?.canonical, 'Text');
  });

  it('FuncType 参数与返回、TypeApp 参数、TypePii 内层解析为 Driver', () => {
    const fahrer = (): AST.TypeName => Node.TypeName('Fahrer');
    const funcType: AST.FuncType = {
      kind: 'FuncType', params: [fahrer()], ret: Node.Maybe(fahrer()), span: Node.TypeName('x').span,
    };
    const m = Node.Module('m', null, [
      Node.Data('Fahrer', []),
      Node.Func(
        'f',
        [],
        [
          { name: 'cb', type: funcType, span: funcType.span },
          { name: 'box', type: Node.TypeApp('Fahrer', [fahrer()]), span: funcType.span },
          { name: 'pii', type: Node.TypePii(fahrer(), 'L2', 'name'), span: funcType.span },
        ],
        Node.Option(fahrer()),
        [], [], false, null
      ),
    ]);
    const r = resolveDeclarations(m, ctxOf(DRIVER));
    const f = decl(r.module, 1, 'Func');
    const ft = f.params[0]!.type as AST.FuncType;
    assert.equal((ft.params[0] as AST.TypeName).resolved?.canonical, 'Driver');
    assert.equal(((ft.ret as AST.Maybe).type as AST.TypeName).resolved?.canonical, 'Driver');
    const app = f.params[1]!.type as AST.TypeApp;
    assert.deepEqual(app.resolved, { canonical: 'Driver', role: 'TYPE', written: 'Fahrer' });
    assert.equal((app.args[0] as AST.TypeName).resolved?.canonical, 'Driver');
    assert.equal(((f.params[2]!.type as AST.TypePii).baseType as AST.TypeName).resolved?.canonical, 'Driver');
    assert.equal(((f.retType as AST.Option).type as AST.TypeName).resolved?.canonical, 'Driver');
  });

  it('同 struct 字段 Alter / alter 映射到不同规范字段 → 各自精确命中', () => {
    // 解析器的字段名须为小写起始标识符，故直接构造 AST
    const m = Node.Module('m', null, [
      Node.Data('Fahrer', [
        { name: 'alter', type: Node.TypeName('Int'), span: Node.TypeName('x').span },
        { name: 'Alter', type: Node.TypeName('Text'), span: Node.TypeName('x').span },
      ]),
    ]);
    const r = resolveDeclarations(m, ctxOf([...DRIVER, field('Driver', 'ageGroup', 'Alter')]));
    const data = decl(r.module, 0, 'Data');
    assert.equal(data.fields[0]!.resolved?.canonical, 'age');
    assert.equal(data.fields[1]!.resolved?.canonical, 'ageGroup');
    assert.deepEqual(codes(r), []);
  });

  it('导入模块声明 Fahrer 与词汇同名 → 取导入声明，并提示遮蔽', () => {
    const m = parse('Modul m.\n\nRegel f gegeben x als Fahrer, liefert Fahrer:\n  gib zurueck x.\n');
    const imports: ImportedDeclarations = { ...NO_IMPORTS, types: ['Fahrer'] };
    const r = resolveDeclarations(m, ctxOf(DRIVER, imports));
    const f = decl(r.module, 0, 'Func');
    assert.equal((f.params[0]!.type as AST.TypeName).resolved?.canonical, 'Fahrer');
    assert.equal((f.retType as AST.TypeName).resolved?.canonical, 'Fahrer');
    assert.ok(codes(r).every((c) => c === ErrorCode.SHADOWED_VOCABULARY));
    assert.ok(codes(r).length > 0, '应有 W800');
  });

  it('Stufe.Hoch → MEMBER_REF Level.High', () => {
    const m = parse(
      'Modul m.\n\nDefiniere Stufe als eines von Hoch, Niedrig.\n\n' +
        'Regel f gegeben x als Ganzzahl, liefert Stufe:\n  gib zurueck Stufe.Hoch.\n'
    );
    const r = resolveDeclarations(m, ctxOf(LEVEL));
    const ret = bodyStmt(decl(r.module, 1, 'Func'), 0) as AST.Return;
    const name = ret.expr as AST.Name;
    assert.equal(name.name, 'Stufe.Hoch');
    assert.deepEqual(name.resolved, { canonical: 'Level.High', role: 'MEMBER_REF', written: 'Stufe.Hoch' });
    assert.deepEqual(codes(r), []);
  });

  it('函数声明、调用目标与构造表达式（类型名与字段名）', () => {
    const m = parse(
      'Module m.\n\nDefine Fahrer has alter as Int.\n\n' +
        'Rule pruefe given n as Int, produce Fahrer:\n  Return Fahrer with alter set to n.\n\n' +
        'Rule g given n as Int, produce Fahrer:\n  Return pruefe(n).\n',
      EN_US
    );
    const r = resolveDeclarations(m, ctxOf([...DRIVER, fn('check', 'pruefe')]));
    const f = decl(r.module, 1, 'Func');
    assert.deepEqual(f.resolved, { canonical: 'check', role: 'FUNC_DECL', written: 'pruefe' });
    const ctor = (bodyStmt(f, 0) as AST.Return).expr as AST.Construct;
    assert.deepEqual(ctor.resolved, { canonical: 'Driver', role: 'TYPE', written: 'Fahrer' });
    assert.deepEqual(ctor.fields[0]!.resolved, { canonical: 'age', role: 'FIELD_REF', written: 'alter' });
    const call = (bodyStmt(decl(r.module, 2, 'Func'), 0) as AST.Return).expr as AST.Call;
    assert.deepEqual((call.target as AST.Name).resolved, { canonical: 'check', role: 'FUNC_REF', written: 'pruefe' });
    assert.deepEqual((call.args[0] as AST.Name).resolved?.role, 'LOCAL');
  });

  it('两个声明解析到同一规范名 → E807', () => {
    const m = parse(
      'Modul m.\n\nDefiniere Fahrer hat alter als Ganzzahl.\n\nDefiniere Driver hat age als Ganzzahl.\n'
    );
    const r = resolveDeclarations(m, ctxOf(DRIVER));
    assert.deepEqual(codes(r), [ErrorCode.DUPLICATE_DECLARATION]);
    const d = r.diagnostics[0]!;
    assert.match(d.message, /Driver/);
    assert.equal(d.severity, 'error');
  });

  it('折叠后多候选且无精确命中 → E804', () => {
    const m = parse('Modul m.\n\nDefiniere Fahrer hat alter als Ganzzahl.\n');
    const vocab = [struct('Driver', 'Fahrer'), field('Driver', 'ageGroup', 'Alter'), field('Driver', 'maxAge', 'ALTER')];
    const r = resolveDeclarations(m, ctxOf(vocab));
    assert.deepEqual(codes(r), [ErrorCode.AMBIGUOUS_NAME]);
    assert.match(r.diagnostics[0]!.message, /ageGroup/);
    assert.match(r.diagnostics[0]!.message, /maxAge/);
  });

  it('精确命中优先于折叠命中', () => {
    const m = parse('Modul m.\n\nDefiniere Fahrer hat alter als Ganzzahl.\n');
    const vocab = [...DRIVER, field('Driver', 'ageGroup', 'Alter'), field('Driver', 'maxAge', 'ALTER')];
    const r = resolveDeclarations(m, ctxOf(vocab));
    assert.equal(decl(r.module, 0, 'Data').fields[0]!.resolved?.canonical, 'age');
    assert.deepEqual(codes(r), []);
  });

  it('局部名与词汇同写法 → 局部名胜出并发 W800', () => {
    const m = parse(
      'Module m.\n\nRule f given pruefe as Int, produce Int:\n  Return pruefe.\n',
      EN_US
    );
    const r = resolveDeclarations(m, ctxOf([fn('check', 'pruefe')]));
    const ret = bodyStmt(decl(r.module, 0, 'Func'), 0) as AST.Return;
    assert.equal((ret.expr as AST.Name).resolved?.role, 'LOCAL');
    assert.deepEqual(codes(r), [ErrorCode.SHADOWED_VOCABULARY]);
  });

  it('Module 路径、TypeVar、workflow / step 名、注解参数不被改写', () => {
    const src =
      'Module fahrer.pruefe.\n\n@id("Fahrer")\nRule run, produce. It performs io:\n' +
      '  workflow:\n    step pruefe:\n      Return ok of 1.\n\n  .\n';
    const m = parse(src, EN_US);
    const ctx = ctxOf([...DRIVER, fn('check', 'pruefe')]);
    const r = resolveDeclarations(m, ctx);
    assert.equal(r.module.name, 'fahrer.pruefe');
    assert.equal('resolved' in r.module, false);
    const f = decl(r.module, 0, 'Func');
    assert.deepEqual(f.annotations, [{ name: 'id', args: [{ name: '$0', value: 'Fahrer' }] }]);
    const wf = bodyStmt(f, 0) as AST.WorkflowStmt;
    assert.equal(wf.steps[0]!.name, 'pruefe');
    assert.equal('resolved' in wf.steps[0]!, false);

  });

  it('主语为已知 Data 类型参数时 PatternCtor 按 TYPE 解析，绑定名为局部名', () => {
    const m = parse(
      'Module m.\n\nDefine Fahrer has alter as Int.\n\n' +
        'Rule f given fahrer as Fahrer, produce Int:\n  Match fahrer:\n    When Fahrer(a), Return a.\n',
      EN_US
    );
    const r = resolveDeclarations(m, ctxOf(DRIVER));
    const match = bodyStmt(decl(r.module, 1, 'Func'), 0) as AST.Match;
    const pat = match.cases[0]!.pattern as AST.PatternCtor;
    assert.deepEqual(pat.resolved, { canonical: 'Driver', role: 'TYPE', written: 'Fahrer' });
    const ret = match.cases[0]!.body as AST.Return;
    assert.equal((ret.expr as AST.Name).resolved?.role, 'LOCAL');
  });

  it('期望枚举下的裸名留给 R2：不写 resolved、不报错', () => {
    const m = parse(
      'Modul m.\n\nDefiniere Stufe als eines von Hoch, Niedrig.\n\n' +
        'Regel f gegeben x als Ganzzahl, liefert Stufe:\n  gib zurueck Hoch.\n'
    );
    const r = resolveDeclarations(m, ctxOf(LEVEL));
    const ret = bodyStmt(decl(r.module, 1, 'Func'), 0) as AST.Return;
    assert.equal('resolved' in ret.expr, false);
    assert.deepEqual(codes(r), []);
  });

  describe('隐式类型参数（裁决 R13）', () => {
    it('隐式推断的类型参数命中词汇 → 从 typeParams 移除并按 TYPE 解析', () => {
      const m = parse('Modul m.\n\nRegel f gegeben x als Fahrer, liefert Fahrer:\n  gib zurueck x.\n');
      assert.deepEqual(decl(m, 0, 'Func').typeParams, ['Fahrer'], '前提：解析器把 Fahrer 推断为类型参数');
      const r = resolveDeclarations(m, ctxOf(DRIVER));
      const f = decl(r.module, 0, 'Func');
      assert.deepEqual(f.typeParams, []);
      assert.equal((f.params[0]!.type as AST.TypeName).resolved?.canonical, 'Driver');
      assert.deepEqual(codes(r), []);
    });

    it('隐式推断且全部未命中 → 保留为类型参数，使用处不写 TYPE resolved、不报 E800', () => {
      const m = parse('Modul m.\n\nRegel f gegeben x als Element, liefert Element:\n  gib zurueck x.\n');
      const r = resolveDeclarations(m, ctxOf(DRIVER));
      const f = decl(r.module, 0, 'Func');
      assert.deepEqual(f.typeParams, ['Element']);
      assert.equal('resolved' in f.params[0]!.type, false);
      assert.equal('resolved' in f.retType, false);
      assert.deepEqual(codes(r), []);
    });

    it('隐式参数在词汇中折叠歧义 → 报 E804 并保留为类型参数', () => {
      const m = parse('Modul m.\n\nRegel f gegeben x als FaHrer, liefert Ganzzahl:\n  gib zurueck 1.\n');
      assert.deepEqual(decl(m, 0, 'Func').typeParams, ['FaHrer'], '前提：解析器推断为类型参数');
      const r = resolveDeclarations(m, ctxOf([struct('Driver', 'Fahrer'), struct('Pilot', 'FAHRER')]));
      assert.deepEqual(codes(r), [ErrorCode.AMBIGUOUS_NAME]);
      assert.deepEqual(decl(r.module, 0, 'Func').typeParams, ['FaHrer']);
    });

    it('显式 of T → 保留，TypeVar 不查词汇', () => {
      const m = parse('Modul m.\n\nRegel f of Fahrer gegeben x als Fahrer, liefert Fahrer:\n  gib zurueck x.\n');
      const r = resolveDeclarations(m, ctxOf(DRIVER));
      const f = decl(r.module, 0, 'Func');
      assert.deepEqual(f.typeParams, ['Fahrer']);
      assert.deepEqual(f.params[0]!.type, decl(m, 0, 'Func').params[0]!.type);
      assert.equal(f.params[0]!.type.kind, 'TypeVar');
      assert.deepEqual(codes(r), []);
    });
  });

  describe('未解析诊断（裁决 R14）', () => {
    it('TYPE 位置在声明 / 导入 / 词汇 / 内置中均未命中 → E800', () => {
      const m = parse('Modul m.\n\nDefiniere Fahrer hat alter als Unbekannt.\n');
      const r = resolveDeclarations(m, ctxOf(DRIVER));
      assert.deepEqual(codes(r), [ErrorCode.UNRESOLVED_TYPE]);
      assert.match(r.diagnostics[0]!.message, /Unbekannt/);
    });

    it('已声明、内置、导入、词汇类型不报 E800', () => {
      const m = parse(
        'Modul m.\n\nDefiniere Stufe als eines von Hoch, Niedrig.\n\n' +
          'Definiere Fahrer hat alter als Ganzzahl, stufe als Stufe, konto als Konto, name als Text, ' +
          'betrag als Decimal, frei als Boolesch, freund als Driver.\n'
      );
      const imports: ImportedDeclarations = { ...NO_IMPORTS, types: ['Konto'] };
      const r = resolveDeclarations(m, ctxOf([...DRIVER, ...LEVEL], imports));
      assert.deepEqual(codes(r), []);
    });

    it('DateTime 为内置类型，不报 E800', () => {
      const m = parse('Modul m.\n\nDefiniere Fahrer hat seit als DateTime.\n');
      assert.deepEqual(codes(resolveDeclarations(m, ctxOf(DRIVER))), []);
    });

    it('构造类型未解析（E800）时不再对字段逐个报 E801', () => {
      const m = parse(
        'Modul m.\n\nRegel f gegeben x als Ganzzahl, liefert Ganzzahl:\n' +
          '  sei p gleich Unbekannt mit a setze auf x, b setze auf x.\n  gib zurueck x.\n'
      );
      const r = resolveDeclarations(m, ctxOf(DRIVER));
      assert.deepEqual(codes(r), [ErrorCode.UNRESOLVED_TYPE]);
    });

    it('构造字段未命中 → E801', () => {
      const m = parse(
        'Modul m.\n\nDefiniere Fahrer hat alter als Ganzzahl.\n\n' +
          'Regel f gegeben x als Ganzzahl, liefert Fahrer:\n  gib zurueck Fahrer mit gewicht setze auf x.\n'
      );
      const r = resolveDeclarations(m, ctxOf(DRIVER));
      assert.deepEqual(codes(r), [ErrorCode.UNRESOLVED_FIELD]);
      assert.match(r.diagnostics[0]!.message, /gewicht/);
    });

    it('构造字段折叠后多候选 → E805', () => {
      const m = parse(
        'Modul m.\n\nRegel f gegeben x als Ganzzahl, liefert Driver:\n  gib zurueck Driver mit alter setze auf x.\n'
      );
      const imports: ImportedDeclarations = { ...NO_IMPORTS, types: ['Driver'], fields: new Map([['Driver', ['age']]]) };
      const vocab = [struct('Driver', 'Fahrer'), field('Driver', 'ageGroup', 'Alter'), field('Driver', 'maxAge', 'ALTER')];
      const r = resolveDeclarations(m, ctxOf(vocab, imports));
      assert.deepEqual(codes(r), [ErrorCode.AMBIGUOUS_FIELD]);
    });

    it('E.M 成员未命中 → E802（MEMBER_REF）', () => {
      const m = parse(
        'Modul m.\n\nDefiniere Stufe als eines von Hoch, Niedrig.\n\n' +
          'Regel f gegeben x als Ganzzahl, liefert Stufe:\n  gib zurueck Stufe.Mittel.\n'
      );
      const r = resolveDeclarations(m, ctxOf(LEVEL));
      assert.deepEqual(codes(r), [ErrorCode.UNRESOLVED_NAME]);
      assert.match(r.diagnostics[0]!.message, /Mittel/);
      assert.match(r.diagnostics[0]!.message, /MEMBER_REF/);
    });

    it('主语为已知枚举时 PatternCtor 成员未命中 → E803', () => {
      const span = Node.TypeName('x').span;
      const m = Node.Module('m', null, [
        Node.Enum('Stufe', ['Hoch']),
        Node.Func('f', [], [{ name: 's', type: Node.TypeName('Stufe'), span }], Node.TypeName('Int'), [], [], false,
          Node.Block([Node.Match(Node.Name('s'), [Node.Case(Node.PatternCtor('Mittel', []), Node.Return(Node.Int(1)))])])),
      ]);
      const r = resolveDeclarations(m, ctxOf(LEVEL));
      assert.deepEqual(codes(r), [ErrorCode.UNRESOLVED_PATTERN]);
    });

    it('值位置未命中的单段名不报 E802（留给 R2）', () => {
      const m = parse('Modul m.\n\nRegel f gegeben x als Ganzzahl, liefert Ganzzahl:\n  gib zurueck unbekannt.\n');
      assert.deepEqual(codes(resolveDeclarations(m, ctxOf(DRIVER))), []);
    });

    it('点分首段静默探测：非枚举首段不产生诊断；词汇函数首段不按 E.M 解析', () => {
      const src =
        'Modul m.\n\nDefiniere Stufe als eines von Hoch, Niedrig.\n\n' +
        'Regel f gegeben x als Text, liefert Stufe:\n  sei n gleich Unbekannt.laenge.\n  gib zurueck Stufe.Hoch.\n';
      const r = resolveDeclarations(parse(src), ctxOf([...LEVEL, fn('grade', 'Stufe')]));
      assert.deepEqual(codes(r), []);
      const f = decl(r.module, 1, 'Func');
      assert.equal('resolved' in ((bodyStmt(f, 0) as AST.Let).expr), false);
      assert.equal('resolved' in ((bodyStmt(f, 1) as AST.Return).expr), false);
    });
  });

  describe('类型别名（裁决 R15）', () => {
    it('引用类型别名不报 E800，按别名声明解析', () => {
      const m = parse(
        'Module m.\n\nType Score as Int.\n\nDefine Fahrer has punkte as Score.\n\n' +
          'Rule f given s as Score, produce Score:\n  Return s.\n',
        EN_US
      );
      const r = resolveDeclarations(m, ctxOf(DRIVER));
      assert.deepEqual(codes(r), []);
      assert.deepEqual(r.module.resolvedTypeAliases, [{ canonical: 'Score', role: 'TYPE_DECL', written: 'Score' }]);
      const f = decl(r.module, 1, 'Func');
      assert.deepEqual(f.typeParams, []);
      assert.equal((f.params[0]!.type as AST.TypeName).resolved?.canonical, 'Score');
      assert.equal((decl(r.module, 0, 'Data').fields[0]!.type as AST.TypeName).resolved?.canonical, 'Score');
    });

    it('别名声明命中词汇 → 取规范名，引用随之解析', () => {
      const m = parse(
        'Module m.\n\nType Punktzahl as Int.\n\nDefine Fahrer has punkte as Punktzahl.\n',
        EN_US
      );
      const r = resolveDeclarations(m, ctxOf([...DRIVER, struct('Score', 'Punktzahl')]));
      assert.deepEqual(codes(r), []);
      assert.deepEqual(r.module.typeAliases, ['Punktzahl'], '原写法保留');
      assert.deepEqual(r.module.resolvedTypeAliases, [{ canonical: 'Score', role: 'TYPE_DECL', written: 'Punktzahl' }]);
      const t = decl(r.module, 0, 'Data').fields[0]!.type as AST.TypeName;
      assert.deepEqual(t.resolved, { canonical: 'Score', role: 'TYPE', written: 'Punktzahl' });
    });

    it('别名与 Data 解析到同一规范名 → E807', () => {
      const m = parse('Module m.\n\nType Fahrer as Int.\n\nDefine Driver has age as Int.\n', EN_US);
      const r = resolveDeclarations(m, ctxOf(DRIVER));
      assert.deepEqual(codes(r), [ErrorCode.DUPLICATE_DECLARATION]);
    });

    it('★两个同名别名 → E807 落在后一个别名声明上（#248，旧实现为 0:0）', () => {
      const m = parse('Module m.\n\nType Score as Int.\n\nType Score as Text.\n', EN_US);
      const r = resolveDeclarations(m, ctxOf([]));
      assert.deepEqual(codes(r), [ErrorCode.DUPLICATE_DECLARATION]);
      assert.deepEqual(r.diagnostics[0]!.span, { start: { line: 5, col: 1 }, end: { line: 5, col: 20 } });
    });

    it('★Define 在前、同名别名在后 → E807 落在后出现的别名上，而非 Data', () => {
      const m = parse('Module m.\n\nDefine Score has v as Int.\n\nType Score as Int.\n', EN_US);
      const r = resolveDeclarations(m, ctxOf([]));
      assert.deepEqual(codes(r), [ErrorCode.DUPLICATE_DECLARATION]);
      assert.equal(r.diagnostics[0]!.span?.start.line, 5);
    });

    it('别名在前、同名 Define 在后 → E807 落在 Define 上', () => {
      const m = parse('Module m.\n\nType Score as Int.\n\nDefine Score has v as Int.\n', EN_US);
      const r = resolveDeclarations(m, ctxOf([]));
      assert.deepEqual(codes(r), [ErrorCode.DUPLICATE_DECLARATION]);
      assert.equal(r.diagnostics[0]!.span?.start.line, 5);
    });
  });

  it('不修改输入 AST', () => {
    const m = parse('Modul m.\n\nDefiniere Fahrer hat alter als Ganzzahl.\n');
    const before = JSON.stringify(m);
    resolveDeclarations(m, ctxOf(DRIVER));
    assert.equal(JSON.stringify(m), before);
  });

  it('无词汇时声明与类型取原写法', () => {
    const m = parse('Modul m.\n\nDefiniere Fahrer hat alter als Ganzzahl.\n');
    const r = resolveDeclarations(m, { imports: NO_IMPORTS });
    const data = decl(r.module, 0, 'Data');
    assert.equal(data.resolved?.canonical, 'Fahrer');
    assert.equal(data.fields[0]!.resolved?.canonical, 'alter');
    assert.equal((data.fields[0]!.type as AST.TypeName).resolved?.canonical, 'Int');
  });
});
