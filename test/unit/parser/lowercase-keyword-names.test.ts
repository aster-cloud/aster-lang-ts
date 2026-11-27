/**
 * 产品裁决 D4（eco-1.0.57）与 ADR 0056 修订 A8：小写关键词不能作名字。夹具 test/fixtures/keyword-case/lowercase_keyword_names.json：
 * reject 的每例 ts 报 E055（码、行、列、参数与夹具相同，消息带转义提示），core 同样拒绝（夹具的 core 字段记录 aster-lang-core
 * 的第一条诊断）；accept 的每例 ts 能编译（转义名、首字母大写与混合拼写的同形词、含这些词的长名字、不翻译成这些关键词的
 * zh 词、限定名里 core 放行的段），core 编译出同一 Core IR；dot 的每例是点之后的 not / set（修订 A8：点是语句结尾，照 core 读法），
 * coreIr 行 ts 的位置无关 Core IR 哈希等于夹具记录的 core 哈希，reject 行 ts 与 core 都拒绝。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from '../../../src/browser.js';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parseWithLexicon } from '../../../src/parser.js';
import { DiagnosticError } from '../../../src/diagnostics/diagnostics.js';
import { CompileFailure, compileSource, positionFreeSha256 } from '../../../src/policy-package/compile-source.js';
import { LOWERCASE_KEYWORD_NAMES } from '../../../src/parser/parse-issue.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';

interface RejectCase {
  readonly name: string;
  readonly lexicon: string;
  readonly source: string;
  readonly reject: readonly [string, number, number];
  readonly params: Readonly<Record<string, string>>;
  readonly core: readonly [string, number];
}

interface AcceptCase {
  readonly name: string;
  readonly lexicon: string;
  readonly source: string;
}

/** 点之后的 not / set（修订 A8）：coreIr 与 reject 二者恰有其一。 */
interface DotCase {
  readonly name: string;
  readonly lexicon: string;
  readonly source: string;
  readonly coreIr?: string;
  readonly reject?: readonly [string, number, number];
  readonly core?: readonly [string, number];
}

interface Fixture {
  readonly reject: readonly RejectCase[];
  readonly accept: readonly AcceptCase[];
  readonly dot: readonly DotCase[];
}

const FIXTURE = resolve(process.cwd(), 'test', 'fixtures', 'keyword-case', 'lowercase_keyword_names.json');
const DATA = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;
const LEXICONS: Readonly<Record<string, Lexicon>> = { 'en-US': EN_US, 'zh-CN': ZH_CN, 'de-DE': DE_DE };

function lexiconOf(id: string): Lexicon {
  const lexicon = LEXICONS[id];
  assert.ok(lexicon, `未知 lexicon ${id}`);
  return lexicon;
}

/** 第一条解析错误；能解析时返回 null。 */
function firstError(source: string, lexicon: Lexicon): { code: string; line: number; col: number; params: unknown; message: string } | null {
  try {
    const parsed = parseWithLexicon(lex(canonicalize(source, lexicon), lexicon), lexicon);
    const first = parsed.diagnostics.find((d) => d.severity === 'error');
    return first
      ? { code: first.code, line: first.span.start.line, col: first.span.start.col, params: first.params, message: first.message }
      : null;
  } catch (e) {
    if (e instanceof DiagnosticError) {
      const d = e.diagnostic;
      return { code: d.code, line: d.span.start.line, col: d.span.start.col, params: d.params, message: d.message };
    }
    throw e;
  }
}

/** 整条编译（含降级与名字解析）：能编译时给出位置无关哈希，否则给出第一条诊断的 [码, 行, 列]。 */
function compileOutcome(source: string, locale: string): { pf: string } | { diag: [string, number, number] } {
  try {
    return { pf: positionFreeSha256(compileSource(source, { locale })) };
  } catch (e) {
    if (!(e instanceof CompileFailure)) throw e;
    const d = JSON.parse(e.diagnostics[0]!) as { code: string; span: { start: { line: number; col: number } } };
    return { diag: [d.code, d.span.start.line, d.span.start.col] };
  }
}

describe('小写关键词不能作名字（产品裁决 D4、ADR 0056 修订 A8）', () => {
  it('夹具覆盖名单里的每个词与三个语言包', () => {
    const words = new Set(DATA.reject.map((c) => c.name.split('/')[1]));
    for (const w of LOWERCASE_KEYWORD_NAMES) assert.ok(words.has(w), `夹具缺少 ${w}`);
    assert.deepEqual([...new Set(DATA.reject.map((c) => c.lexicon))].sort(), ['de-DE', 'en-US', 'zh-CN']);
    assert.equal(DATA.reject.length, 862);
    assert.equal(DATA.accept.length, 151);
    assert.equal(DATA.dot.length, 43);
    assert.equal(DATA.dot.filter((c) => c.coreIr !== undefined).length, 24);
  });

  for (const c of DATA.reject) {
    it(`拒绝 ${c.lexicon} ${c.name}`, () => {
      const first = firstError(c.source, lexiconOf(c.lexicon));
      assert.ok(first, '应报解析错误');
      assert.deepEqual([first.code, first.line, first.col], [...c.reject]);
      assert.deepEqual(first.params, c.params);
      // 英文源码给出具体的转义写法；非英文源码的记号是翻译后的拼写，只提示用反引号
      assert.match(first.message, c.lexicon === 'en-US'
        ? /^'[a-z]+' is a keyword and cannot be used as a name; write it in backticks \(`[a-z]+`\) to use it as a name$/
        : /is a keyword and cannot be used as a name; write the name in backticks to use it as a name$/);
      assert.ok(c.core[0].startsWith('E0'), 'core 同样拒绝');
    });
  }

  // 修订 A8：点之后的 not / set 照 core 读作语句结尾（`Return v.not(1).` = `Return v.` + `not(1).`），Core IR 与 core 相同
  for (const c of DATA.dot) {
    it(`点之后的关键词照 core 读法 ${c.lexicon} ${c.name}`, () => {
      assert.ok((c.coreIr === undefined) !== (c.reject === undefined), '夹具行须恰有 coreIr 或 reject 之一');
      const outcome = compileOutcome(c.source, c.lexicon);
      if (c.coreIr !== undefined) {
        assert.ok('pf' in outcome, `应能编译：${JSON.stringify(outcome)}`);
        assert.equal(outcome.pf, c.coreIr, '位置无关 Core IR 哈希应等于 core');
      } else {
        assert.ok('diag' in outcome, '应拒绝');
        assert.deepEqual(outcome.diag, [...c.reject!]);
        assert.ok(c.core![0].startsWith('E'), 'core 同样拒绝');
      }
    });
  }

  for (const c of DATA.accept) {
    it(`照旧接受 ${c.lexicon} ${c.name}`, () => {
      const result = compile(c.source, { lexicon: lexiconOf(c.lexicon) });
      assert.ok(result.success, `应能编译：${JSON.stringify(result.parseErrors ?? result.loweringErrors ?? [])}`);
    });
  }
});
