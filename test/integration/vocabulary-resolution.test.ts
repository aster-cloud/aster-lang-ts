/**
 * 领域词汇按位置解析接入编译流水线（ADR 0051 §1、§4、§8）。
 *
 * 端到端：canonicalize（只做关键词 / 字面量宏）→ 解析 → R1 → lower → R2 → typecheck → 解释执行。
 * 覆盖 §1 四个生产复现、解析前标识符替换已删除、空词汇 IR 逐字节不变、E8xx 不产出 IR，
 * 以及 resolvePolicyTypes 与包入口导出。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  compile,
  compileAndTypecheck,
  evaluate,
  resolvePolicyTypes,
  DE_DE,
  EN_US,
  IdentifierKind,
  buildIdentifierIndex,
  vocabularyRegistry,
} from '../../src/browser.js';
import * as browserEntry from '../../src/browser.js';
import * as packageEntry from '../../src/index.js';
import { SemanticTokenKind } from '../../src/config/token-kind.js';
import type { DomainVocabulary, IdentifierMapping } from '../../src/config/lexicons/identifiers/types.js';
import type { Core } from '../../src/types.js';

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
const literal = (content: string, trigger: string): IdentifierMapping => ({
  canonical: content, localized: trigger, kind: IdentifierKind.LITERAL,
});

function vocabularyOf(mappings: IdentifierMapping[], locale = 'de-DE'): DomainVocabulary {
  const of = (kind: IdentifierKind): IdentifierMapping[] => mappings.filter((m) => m.kind === kind);
  return {
    id: 'test.vocab', name: 'test', locale, version: '1',
    structs: of(IdentifierKind.STRUCT),
    fields: of(IdentifierKind.FIELD),
    functions: of(IdentifierKind.FUNCTION),
    enumValues: of(IdentifierKind.ENUM_VALUE),
    literals: of(IdentifierKind.LITERAL),
  };
}

/** 编译 + 类型检查必须完全干净（无解析 / 名称解析 / 类型错误），返回 Core。 */
function compileClean(source: string, vocabulary: DomainVocabulary, lexicon = DE_DE): Core.Module {
  const result = compileAndTypecheck(source, { lexicon, vocabulary });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual(result.typeErrors.filter((d) => d.severity === 'error'), []);
  assert.deepEqual((result.resolutionDiagnostics ?? []).filter((d) => d.severity === 'error'), []);
  return result.core!;
}

function run(core: Core.Module, func: string, input: Record<string, unknown>): unknown {
  const r = evaluate(core, func, input);
  assert.equal(r.success, true, r.error);
  return r.value;
}

const withoutOrigin = (m: Core.Module): string => JSON.stringify(m, (k, v) => (k === 'origin' ? undefined : v));

function dataOf(core: Core.Module, name: string): Core.Data {
  const d = core.decls.find((x): x is Core.Data => x.kind === 'Data' && x.name === name);
  assert.ok(d, `缺少 Data ${name}：${core.decls.map((x) => x.name).join(', ')}`);
  return d;
}

// §1 复现 1 + 3：类型 Stufe 与字段 stufe 并存；参数 fahrer 与类型 Fahrer 同词
const LEVEL_FIELD_SOURCE =
  'Modul versicherung.\n\n' +
  'Definiere Stufe hat punkte als Ganzzahl.\n\n' +
  'Definiere Fahrer hat stufe als Stufe, alter als Ganzzahl.\n\n' +
  'Regel bewerten gegeben fahrer als Fahrer, liefert Ganzzahl:\n' +
  '  gib zurueck fahrer.stufe.punkte plus fahrer.alter.\n';

const LEVEL_FIELD_VOCAB = vocabularyOf([
  struct('Level', 'Stufe'),
  struct('Driver', 'Fahrer'),
  field('Level', 'points', 'punkte'),
  field('Driver', 'level', 'stufe'),
  field('Driver', 'age', 'alter'),
]);

// §1 复现 2：规则 hoch 与枚举成员 Hoch 并存，限定写法 Stufe.Hoch
const ENUM_SOURCE = (ret: string): string =>
  'Modul versicherung.\n\n' +
  'Definiere Stufe als eines von Hoch, Niedrig.\n\n' +
  'Regel hoch gegeben x als Ganzzahl, liefert Ganzzahl:\n' +
  '  gib zurueck x.\n\n' +
  'Regel einstufen gegeben x als Ganzzahl, liefert Stufe:\n' +
  `  gib zurueck ${ret}.\n`;

const ENUM_VOCAB = vocabularyOf([
  struct('Level', 'Stufe'),
  member('Level', 'High', 'Hoch'),
  member('Level', 'Low', 'Niedrig'),
  fn('high', 'hoch'),
]);

// §1 复现 4：同一本地化字段名 alter 在两个 struct 中对应不同规范字段
const SAME_FIELD_SOURCE =
  'Modul versicherung.\n\n' +
  'Definiere Fahrer hat alter als Ganzzahl.\n\n' +
  'Definiere Fahrzeug hat alter als Ganzzahl.\n\n' +
  'Regel summe gegeben fahrer als Fahrer, wagen als Fahrzeug, liefert Ganzzahl:\n' +
  '  gib zurueck fahrer.alter plus wagen.alter.\n';

const SAME_FIELD_VOCAB = vocabularyOf([
  struct('Driver', 'Fahrer'),
  struct('Vehicle', 'Fahrzeug'),
  field('Driver', 'age', 'alter'),
  field('Vehicle', 'vehicleAge', 'alter'),
]);

describe('ADR 0051 §1 生产复现端到端', () => {
  it('类型 Stufe / 字段 stufe 并存，参数 fahrer 不被改写', () => {
    const core = compileClean(LEVEL_FIELD_SOURCE, LEVEL_FIELD_VOCAB);
    assert.deepEqual(dataOf(core, 'Driver').fields.map((f) => f.name), ['level', 'age']);
    assert.deepEqual(dataOf(core, 'Level').fields.map((f) => f.name), ['points']);
    const func = core.decls.find((d): d is Core.Func => d.kind === 'Func')!;
    assert.deepEqual(func.params.map((p) => p.name), ['fahrer']);
    assert.equal(run(core, 'bewerten', { fahrer: { level: { points: 3 }, age: 40 } }), 43);
  });

  it('本地化源码与规范名拼写的对照程序产出相同 Core（去 origin）', () => {
    const localized = compileClean(LEVEL_FIELD_SOURCE, LEVEL_FIELD_VOCAB);
    const canonical = compileClean(
      'Module versicherung.\n\n' +
        'Define Level has points as Int.\n\n' +
        'Define Driver has level as Level, age as Int.\n\n' +
        'Rule bewerten given fahrer as Driver, produce Int:\n' +
        '  Return fahrer.level.points plus fahrer.age.\n',
      vocabularyOf([], 'en-US'),
      EN_US
    );
    assert.equal(withoutOrigin(localized), withoutOrigin(canonical));
  });

  it('规则 hoch 与成员 Hoch 并存：限定写法 Stufe.Hoch 编译、类型检查并求值', () => {
    const core = compileClean(ENUM_SOURCE('Stufe.Hoch'), ENUM_VOCAB);
    assert.ok(core.decls.some((d) => d.kind === 'Func' && d.name === 'high'));
    const value = run(core, 'einstufen', { x: 1 });
    assert.deepEqual(value, { __type: '?', _enum: 'Level', value: 'High', variant: 'High', args: [] });
  });

  it('规则 hoch 与成员 Hoch 并存：裸写 Hoch 报 E804，编译失败且无 Core', () => {
    const result = compile(ENUM_SOURCE('Hoch'), { lexicon: DE_DE, vocabulary: ENUM_VOCAB });
    assert.equal(result.success, false);
    assert.equal(result.core, undefined);
    assert.ok(result.resolutionDiagnostics?.some((d) => d.code === 'E804'), JSON.stringify(result));
    const checked = compileAndTypecheck(ENUM_SOURCE('Hoch'), { lexicon: DE_DE, vocabulary: ENUM_VOCAB });
    assert.equal(checked.success, false);
    assert.equal(checked.core, undefined);
  });

  it('经注册中心引用词汇（domain + tenantId）与直接传入 vocabulary 结果相同', () => {
    vocabularyRegistry.registerCustom('t-adr0051', { ...LEVEL_FIELD_VOCAB, id: 'adr0051.domain' });
    const viaRegistry = compile(LEVEL_FIELD_SOURCE, { lexicon: DE_DE, domain: 'adr0051.domain', tenantId: 't-adr0051' });
    const direct = compile(LEVEL_FIELD_SOURCE, { lexicon: DE_DE, vocabulary: LEVEL_FIELD_VOCAB });
    assert.equal(viaRegistry.success, true, JSON.stringify(viaRegistry));
    assert.equal(JSON.stringify(viaRegistry), JSON.stringify(direct));
    assert.equal(vocabularyRegistry.unregisterCustom('t-adr0051', 'adr0051.domain', 'de-DE'), true);
  });

  it('同名本地化字段按所属 struct 解析到不同规范字段', () => {
    const core = compileClean(SAME_FIELD_SOURCE, SAME_FIELD_VOCAB);
    assert.deepEqual(dataOf(core, 'Driver').fields.map((f) => f.name), ['age']);
    assert.deepEqual(dataOf(core, 'Vehicle').fields.map((f) => f.name), ['vehicleAge']);
    assert.equal(run(core, 'summe', { fahrer: { age: 30 }, wagen: { vehicleAge: 5 } }), 35);
  });
});

describe('E8xx / W8xx 与编译结果', () => {
  it('任一 E8xx：compile 返回 success:false 且不产出 core', () => {
    const src =
      'Modul m.\n\nDefiniere Fahrer hat alter als Ganzzahl.\n\n' +
      'Regel f gegeben x als Fahrer, liefert Ganzzahl:\n  gib zurueck x.gewicht.\n';
    const result = compile(src, { lexicon: DE_DE, vocabulary: vocabularyOf([]) });
    assert.equal(result.success, false);
    assert.equal(result.core, undefined);
    assert.ok((result.resolutionDiagnostics ?? []).some((d) => d.severity === 'error' && d.code.startsWith('E80')));
  });

  it('W8xx 不阻塞：编译成功并随结果返回警告', () => {
    const src =
      'Modul m.\n\nDefiniere Stufe als eines von Hoch, Niedrig.\n\n' +
      'Regel f gegeben hoch als Stufe, liefert Stufe:\n  gib zurueck Hoch.\n';
    const result = compile(src, { lexicon: DE_DE, vocabulary: ENUM_VOCAB });
    assert.equal(result.success, true, JSON.stringify(result));
    assert.ok(result.core);
    assert.ok(result.resolutionDiagnostics?.some((d) => d.code === 'W800'), JSON.stringify(result.resolutionDiagnostics));
  });

  it('经导入别名限定的调用（MODULE 段）不需要导入声明，不报 E8xx', () => {
    const src =
      'Module m.\n\nUse mock.remote as R.\n\n' +
      'Rule f given x as Int, produce Int:\n  Return R.calc(x).\n';
    const result = compile(src, { lexicon: EN_US, vocabulary: vocabularyOf([fn('compute', 'calc')], 'en-US') });
    assert.equal(result.success, true, JSON.stringify(result));
    assert.deepEqual(result.resolutionDiagnostics ?? [], []);
    assert.ok(JSON.stringify(result.core).includes('"R.calc"'));
  });
});

describe('解析前标识符替换已删除', () => {
  it('src/ 中不再有 translateIdentifiers 与 toCanonical', () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.ts$/.test(entry.name) && /translateIdentifiers|toCanonical\b/.test(fs.readFileSync(p, 'utf8'))) hits.push(p);
      }
    };
    walk(path.resolve(process.cwd(), 'src'));
    assert.deepEqual(hits, []);
  });

  it('IdentifierIndex 不再提供 toCanonical', () => {
    const index = buildIdentifierIndex(LEVEL_FIELD_VOCAB);
    assert.equal('toCanonical' in index, false);
  });

  it('词汇不再做全局文本替换：未登记位置的同形词保持原写法', () => {
    // 局部名 stufe 与类型 Stufe 同词：旧的全局替换会把它改成 Level/level
    const src =
      'Modul m.\n\nRegel f gegeben stufe als Ganzzahl, liefert Ganzzahl:\n  gib zurueck stufe.\n';
    const core = compileClean(src, LEVEL_FIELD_VOCAB);
    const func = core.decls.find((d): d is Core.Func => d.kind === 'Func')!;
    assert.deepEqual(func.params.map((p) => p.name), ['stufe']);
    assert.equal(run(core, 'f', { stufe: 4 }), 4);
  });
});

describe('Review Focus 3：空词汇或只含字面量宏时 IR 与无词汇逐字节相同', () => {
  const SOURCES = [LEVEL_FIELD_SOURCE, SAME_FIELD_SOURCE, ENUM_SOURCE('Stufe.Hoch')];

  for (const [i, src] of SOURCES.entries()) {
    it(`样例 ${i + 1}`, () => {
      const none = compile(src, { lexicon: DE_DE });
      assert.equal(none.success, true, JSON.stringify(none));
      const empty = compile(src, { lexicon: DE_DE, vocabulary: vocabularyOf([]) });
      const literalsOnly = compile(src, { lexicon: DE_DE, vocabulary: vocabularyOf([literal('Hallo Welt', 'gruss')]) });
      assert.equal(JSON.stringify(empty), JSON.stringify(none));
      assert.equal(JSON.stringify(literalsOnly), JSON.stringify(none));
    });
  }

  it('字面量宏仍在 canonicalize 中展开为字符串字面量', () => {
    const src = 'Modul m.\n\nRegel f gegeben x als Ganzzahl, liefert Text:\n  gib zurueck gruss.\n';
    const core = compileClean(src, vocabularyOf([literal('Hallo Welt', 'gruss')]));
    assert.equal(run(core, 'f', { x: 1 }), 'Hallo Welt');
  });
});

describe('resolvePolicyTypes', () => {
  it('返回已解析的 struct / enum / 函数及其原写法', () => {
    const r = resolvePolicyTypes(LEVEL_FIELD_SOURCE, { locale: 'de-DE', vocabulary: LEVEL_FIELD_VOCAB });
    assert.equal(r.ok, true, JSON.stringify(r));
    if (!r.ok) return;
    const driver = r.types.structs.find((s) => s.canonical === 'Driver');
    assert.deepEqual(driver, {
      canonical: 'Driver',
      written: 'Fahrer',
      fields: [
        { canonical: 'level', written: 'stufe', type: { kind: 'TypeName', name: 'Level' } },
        { canonical: 'age', written: 'alter', type: { kind: 'TypeName', name: 'Int' } },
      ],
    });
    assert.deepEqual(r.types.functions, [
      {
        canonical: 'bewerten',
        written: 'bewerten',
        params: [{ name: 'fahrer', type: { kind: 'TypeName', name: 'Driver' } }],
        returnType: { kind: 'TypeName', name: 'Int' },
      },
    ]);
    assert.deepEqual(r.types.enums, []);
  });

  it('枚举成员带原写法', () => {
    const r = resolvePolicyTypes(ENUM_SOURCE('Stufe.Hoch'), { locale: 'de-DE', vocabulary: ENUM_VOCAB });
    assert.equal(r.ok, true, JSON.stringify(r));
    if (!r.ok) return;
    assert.deepEqual(r.types.enums, [
      {
        canonical: 'Level',
        written: 'Stufe',
        members: [
          { canonical: 'High', written: 'Hoch' },
          { canonical: 'Low', written: 'Niedrig' },
        ],
      },
    ]);
    assert.deepEqual(r.types.functions.map((f) => [f.canonical, f.written]), [['high', 'hoch'], ['einstufen', 'einstufen']]);
  });

  it('E8xx 时返回 ok:false 与诊断', () => {
    const r = resolvePolicyTypes(ENUM_SOURCE('Hoch'), { locale: 'de-DE', vocabulary: ENUM_VOCAB });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.ok(r.diagnostics.some((d) => d.code === 'E804'));
  });

  it('语法错误时返回 ok:false', () => {
    const r = resolvePolicyTypes('Modul m.\n\nRegel f gegeben', { locale: 'de-DE' });
    assert.equal(r.ok, false);
  });

  it('aliasSet 并入 lexicon 关键词别名后解析', () => {
    const src = 'Module m.\n\nPolicy f given x as Int, produce Int:\n  Return x.\n';
    assert.equal(resolvePolicyTypes(src, { locale: 'en-US' }).ok, false);
    const r = resolvePolicyTypes(src, { locale: 'en-US', aliasSet: { [SemanticTokenKind.FUNC_TO]: ['Policy'] } });
    assert.equal(r.ok, true, JSON.stringify(r));
  });
});

describe('包入口导出', () => {
  for (const [name, entry] of [['browser', browserEntry], ['index', packageEntry]] as const) {
    it(`${name} 导出 buildVocabularyScopes / canonicalScopesJson / foldKey / resolvePolicyTypes`, () => {
      const e = entry as Record<string, unknown>;
      for (const fnName of ['buildVocabularyScopes', 'canonicalScopesJson', 'foldKey', 'resolvePolicyTypes']) {
        assert.equal(typeof e[fnName], 'function', fnName);
      }
      const scopes = (e.buildVocabularyScopes as (v: DomainVocabulary) => unknown)(LEVEL_FIELD_VOCAB);
      assert.equal(typeof (e.canonicalScopesJson as (s: unknown) => string)(scopes), 'string');
    });
  }
});
