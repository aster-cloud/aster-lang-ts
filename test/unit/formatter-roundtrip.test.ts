/**
 * 格式化器往返：格式化输出须能重新编译，且 Core IR 与原文相同（去掉 origin 后）。
 *
 * 夹具取自 aster-lang-test 的语法糖/长写法样本与 aster-cloud 的信贷试点 v3（en/zh/de）。
 * 格式化器一律输出英文 CNL，语法糖按长写法输出（ADR 0046 §5），故重新编译统一用 en-US。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalize } from '../../src/frontend/canonicalizer.js';
import { lex } from '../../src/frontend/lexer.js';
import { parseWithLexicon } from '../../src/parser.js';
import { lowerModule } from '../../src/lower_to_core.js';
import { formatCNL } from '../../src/formatter.js';
import { EN_US } from '../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../src/config/lexicons/de-DE.js';
import type { Lexicon } from '../../src/config/lexicons/types.js';
import type { Core, Module } from '../../src/types.js';
import { parseSource, resolveAndLower } from '../../src/compile-pipeline.js';
import { buildVocabularyScopes } from '../../src/config/lexicons/identifiers/scopes.js';
import { IdentifierKind } from '../../src/config/lexicons/identifiers/types.js';

// 编译后从 dist/test/unit 运行：上溯 3 级到仓库根，夹具在 test/fixtures 下
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixtureDir = join(repoRoot, 'test', 'fixtures', 'formatter-roundtrip');

function toCore(source: string, lexicon: Lexicon = EN_US): Core.Module {
  const tokens = lex(canonicalize(source, lexicon), lexicon);
  const result = parseWithLexicon(tokens, lexicon);
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((d) => d.message).join('\n') + '\n---\n' + source);
  return lowerModule(result.ast);
}

function stripOrigins(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(stripOrigins);
  if (!o || typeof o !== 'object') return o;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k !== 'origin') out[k] = stripOrigins(v);
  }
  return out;
}

// 格式化 → 用 en-US 重新编译 → 与原文 IR 比对；返回格式化输出供进一步断言
function assertRoundTrip(source: string, lexicon: Lexicon = EN_US): string {
  const formatted = formatCNL(source, { lexicon });
  assert.deepEqual(stripOrigins(toCore(formatted)), stripOrigins(toCore(source, lexicon)), formatted);
  return formatted;
}

const FIXTURES: ReadonlyArray<readonly [string, Lexicon]> = [
  ['governance-sugar.aster', EN_US],
  ['governance-sugar-long.aster', EN_US],
  ['credit-pilot-v3.en.aster', EN_US],
  ['credit-pilot-v3.zh.aster', ZH_CN],
  ['credit-pilot-v3.de.aster', DE_DE],
  ['type-aliases.aster', EN_US],
];

describe('格式化器往返（Core IR 不变）', () => {
  for (const [file, lexicon] of FIXTURES) {
    test(file, () => {
      const formatted = assertRoundTrip(readFileSync(join(fixtureDir, file), 'utf8'), lexicon);
      assert.doesNotMatch(formatted, /,:/);
      assert.doesNotMatch(formatted, /(>=|<=|[<>*+]|\band)\(/);
      assert.equal(formatCNL(formatted), formatted, '格式化须幂等');
      // Core IR 看不到只在 AST 中的构造（类型别名），再比对源码 AST
      assert.deepEqual(astOf(formatted), astOf(readFileSync(join(fixtureDir, file), 'utf8'), lexicon));
    });
  }

  test('If 与 Otherwise 块头不带逗号', () => {
    const src = ['Module m.', '', 'Rule r given n as Int, produce Int:', '  If n at least 1:',
      '    Return 1.', '  Otherwise:', '    Return 0.', ''].join('\n');
    const formatted = assertRoundTrip(src);
    assert.match(formatted, /\n {2}If n at least 1:\n/);
    assert.match(formatted, /\n {2}Otherwise:\n/);
  });

  test('数值字面量极值按普通十进制输出并原值往返', () => {
    const literals: ReadonlyArray<readonly [string, string, unknown]> = [
      // [源文写法, 返回类型, 期望 Core 字面量值]
      ['0.0000001', 'Double', 1e-7],
      ['123456789012345678901234.5', 'Double', 123456789012345678901234.5],
      ['0.5', 'Double', 0.5],
      ['3.0', 'Double', 3],
      ['2147483647', 'Int', 2147483647],
      ['0', 'Int', 0],
      ['9223372036854775807L', 'Long', '9223372036854775807'],
    ];
    for (const [literal, ret, value] of literals) {
      const src = `Module m.\n\nRule r, produce ${ret}:\n  Return ${literal}.\n`;
      const formatted = assertRoundTrip(src);
      assert.doesNotMatch(formatted, /\d[eE][+-]?\d/, formatted);
      const ret0 = (toCore(formatted).decls[0] as Core.Func).body.statements[0] as Core.Return;
      assert.equal((ret0.expr as { value: unknown }).value, value, literal);
    }
  });

  test('构造字段以逗号分隔，只在会贪婪吞并后续字段时加括号', () => {
    const src = ['Module m.', '', 'Define Inner has x as Int, y as Int.', '',
      'Define Outer has inner as Inner, wrapped as Option of Inner, n as Int, ok as Bool.', '',
      'Rule r given k as Int, produce Outer:',
      '  Return Outer with inner set to (Inner with x set to 1, y set to 2), ' +
        'wrapped set to some of (Inner with x set to k plus 1, y set to 4), n set to k plus 1, ok set to k at least 1 and true.',
      ''].join('\n');
    const formatted = assertRoundTrip(src);
    assert.match(formatted, /inner set to \(Inner with x set to 1, y set to 2\), wrapped set to \(some of Inner with x set to k plus 1, y set to 4\), n set to k plus 1, ok set to k at least 1 and true\./);
  });

  test('运算符按中缀输出，括号保持结合与优先级', () => {
    const body = [
      'Return (a plus b) times c.',
      'Return a minus (b minus c).',
      'Return a minus b minus c.',
      'Return a divided by (b times c).',
      'Return a integer divided by b modulo c.',
      'Return (a plus b) at least c.',
      'Return not (p and q).',
      'Return not p and q.',
      'Return p or q and r.',
      'Return (p or q) and r.',
      'Return a less than b or a greater than c.',
      'Return a equals to b and a not equal to c.',
      'Return a at most (if p then b else c).',
    ];
    const funcs = body.map((line, i) =>
      `Rule f${i} given a as Int, b as Int, c as Int, p as Bool, q as Bool, r as Bool, produce Int:\n  ${line}`);
    const formatted = assertRoundTrip(['Module m.', '', ...funcs, ''].join('\n\n'));
    assert.match(formatted, /Return \(a plus b\) times c\./);
    assert.match(formatted, /Return a minus \(b minus c\)\./);
    assert.match(formatted, /Return a minus b minus c\./);
    assert.match(formatted, /Return not \(p and q\)\./);
  });
});

/** 去掉位置信息后的源码 AST：Core IR 看不到只存在于 AST 的构造（如类型别名），须直接比对 AST */
function astOf(source: string, lexicon: Lexicon = EN_US): unknown {
  const result = parseWithLexicon(lex(canonicalize(source, lexicon), lexicon), lexicon);
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((d) => d.message).join('\n') + '\n---\n' + source);
  // span / nameSpan / variantSpans 等位置字段随排版变化，不属于源码语义
  return JSON.parse(JSON.stringify(result.ast, (k, v) => (/^(span|origin)$|Spans?$/.test(k) ? undefined : v)));
}

// 格式化 → 重新解析 → 与原文 AST 比对（去掉 span）；同时检查幂等
function assertSourceRoundTrip(source: string, lexicon: Lexicon = EN_US, opts: Parameters<typeof formatCNL>[1] = {}): string {
  const formatted = formatCNL(source, { lexicon, ...opts });
  assert.deepEqual(astOf(formatted), astOf(source, lexicon), formatted);
  assert.equal(formatCNL(formatted, opts), formatted, '格式化须幂等');
  return formatted;
}

describe('格式化器往返（源码 AST 不变，#246）', () => {
  test('★类型别名在默认档与 normalize 档都保留', () => {
    const src = 'Module m.\n\nType Score as Int.\n\nDefine D has p as Score.\n\nRule f given x as Score, produce Score:\n  Return x.\n';
    for (const opts of [{}, { mode: 'normalize' as const }]) {
      const formatted = assertSourceRoundTrip(src, EN_US, opts);
      assert.match(formatted, /^Type Score as Int\.$/m);
    }
  });

  test('多个别名按出现顺序前置，目标含 list / Maybe / Map / 注解', () => {
    const src = ['Module m.', '', 'Rule f given x as Score, produce Score:', '  Return x.', '',
      'Type Score as Int.', '', 'Type Tags as list of Text.', '', 'Type MaybeName as Text?.', '',
      'Type Index as map Text to Int.', '', 'Type Secret as @pii(L2, email) Text.', ''].join('\n');
    const formatted = assertSourceRoundTrip(src);
    const aliases = formatted.split('\n').filter((l) => l.startsWith('Type '));
    assert.deepEqual(aliases, ['Type Score as Int.', 'Type Tags as list of Text.', 'Type MaybeName as Text?.',
      'Type Index as map Text to Int.', 'Type Secret as @pii(L2, email) Text.']);
    assert.ok(formatted.indexOf('Type Secret') < formatted.indexOf('Rule f'), '别名统一前置于其余声明');
  });

  test('只有别名、没有模块头也保留', () => {
    const formatted = assertSourceRoundTrip('Type Score as Int.\n');
    assert.equal(formatted, 'Type Score as Int.\n');
  });

  test('de-DE 源文的别名以英文 CNL 输出且 AST 不变', () => {
    const src = 'Modul m.\n\ntype Punktzahl as Ganzzahl.\n\nRegel f gegeben x als Punktzahl, liefert Punktzahl:\n  gib zurueck x plus 1.\n';
    const formatted = assertSourceRoundTrip(src, DE_DE);
    assert.match(formatted, /^Type Punktzahl as Int\.$/m);
  });

  test('与 preserveComments 同用时别名仍保留', () => {
    const src = 'Module m.\n\n// 分数\nType Score as Int.\n\nRule f given x as Score, produce Score:\n  Return x.\n';
    const formatted = formatCNL(src, { preserveComments: true, preserveStandaloneComments: true });
    assert.match(formatted, /^Type Score as Int\.$/m);
    assert.deepEqual(astOf(formatted), astOf(src));
  });

  test('★带词汇的 R1 诊断与函数类型参数在格式化前后一致（别名丢失会让 Score 变成 E800 或隐式类型参数）', () => {
    const scopes = buildVocabularyScopes({
      id: 't', name: 't', locale: 'en-US', version: '1',
      structs: [{ canonical: 'Driver', localized: 'Fahrer', kind: IdentifierKind.STRUCT }],
      fields: [], functions: [], enumValues: [],
    });
    const view = (source: string) => {
      const r = resolveAndLower(parseSource(source).ast as Module, scopes);
      return {
        codes: r.diagnostics.map((d) => d.code),
        typeParams: (r.core?.decls ?? []).filter((d): d is Core.Func => d.kind === 'Func').map((d) => d.typeParams),
      };
    };
    for (const body of ['Define D has p as Score.\n\n', '']) {
      const src = `Module m.\n\nType Score as Int.\n\n${body}Rule f given x as Score, produce Score:\n  Return x.\n`;
      assert.deepEqual(view(formatCNL(src)), view(src));
      assert.deepEqual(view(src), { codes: [], typeParams: [[]] });
    }
  });
});
