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
import type { Core } from '../../src/types.js';

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
];

describe('格式化器往返（Core IR 不变）', () => {
  for (const [file, lexicon] of FIXTURES) {
    test(file, () => {
      const formatted = assertRoundTrip(readFileSync(join(fixtureDir, file), 'utf8'), lexicon);
      assert.doesNotMatch(formatted, /,:/);
      assert.doesNotMatch(formatted, /(>=|<=|[<>*+]|\band)\(/);
      assert.equal(formatCNL(formatted), formatted, '格式化须幂等');
    });
  }

  test('If 与 Otherwise 块头不带逗号', () => {
    const src = ['Module m.', '', 'Rule r given n as Int, produce Int:', '  If n at least 1:',
      '    Return 1.', '  Otherwise:', '    Return 0.', ''].join('\n');
    const formatted = assertRoundTrip(src);
    assert.match(formatted, /\n {2}If n at least 1:\n/);
    assert.match(formatted, /\n {2}Otherwise:\n/);
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
