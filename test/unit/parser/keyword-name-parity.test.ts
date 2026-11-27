/**
 * 关键词当名字（ADR 0056 修订 A6，产品裁决 2026-11-22）：
 * - K1 结构关键词（If / Return / Rule…及其本地化拼写）当名字，两引擎都报 E901；
 * - K2 声明用词 version / type / given 等当名字，两引擎都接受；
 * - K3 其它内置关键词的本地化拼写当名字，解析不变（取关键词的英文拼写），两引擎同码同文发出 W802。
 *
 * 共享夹具 shared/keyword_name_parity.json 与 aster-lang-core src/test/resources/diagnostics/keyword_name_parity.json 逐字节相同，
 * core KeywordNameParityTest 按同一夹具断言。
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
import { collisionWords, checkKeywordNames } from '../../../src/frontend/keyword-name-guard.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import { HI_IN } from '../../../src/config/lexicons/hi-IN.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';

interface KeywordNameCase {
  readonly name: string;
  readonly lexicon: string;
  readonly source: string;
  readonly reject?: readonly [string, number];
  readonly params?: Readonly<Record<string, string>>;
  readonly message?: string;
  readonly names?: readonly string[];
  readonly warnings?: readonly (readonly [string, number])[];
}

interface Fixture {
  readonly collisionWords: Readonly<Record<string, readonly string[]>>;
  readonly cases: readonly KeywordNameCase[];
}

const REPO_ROOT = process.cwd();
const FIXTURE = resolve(REPO_ROOT, 'shared', 'keyword_name_parity.json');
const DATA = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;
const LEXICONS: Readonly<Record<string, Lexicon>> = { 'en-US': EN_US, 'zh-CN': ZH_CN, 'de-DE': DE_DE, 'hi-IN': HI_IN };

function lexiconOf(id: string): Lexicon {
  const lexicon = LEXICONS[id];
  assert.ok(lexicon, `未知 lexicon ${id}`);
  return lexicon;
}

interface FirstError {
  readonly code: string;
  readonly line: number;
  readonly params: unknown;
  readonly message: string;
}

/** 第一条解析错误；能解析时返回 null。 */
function firstError(c: KeywordNameCase): FirstError | null {
  const lexicon = lexiconOf(c.lexicon);
  try {
    const parsed = parseWithLexicon(lex(canonicalize(c.source, lexicon), lexicon), lexicon);
    const first = parsed.diagnostics.find((d) => d.severity === 'error');
    return first ? { code: first.code, line: first.span.start.line, params: first.params, message: first.message } : null;
  } catch (e) {
    if (e instanceof DiagnosticError) {
      const d = e.diagnostic;
      return { code: d.code, line: d.span.start.line, params: d.params, message: d.message };
    }
    throw e;
  }
}

/** 第一条解析错误的 [码, 行]；能解析时返回 null。 */
function firstParseError(c: KeywordNameCase): [string, number] | null {
  const first = firstError(c);
  return first ? [first.code, first.line] : null;
}

describe('关键词当名字共享夹具（ts 侧）', () => {
  it('共享夹具共 80 例，四个语言包都有', () => {
    assert.equal(DATA.cases.length, 80);
    assert.deepEqual([...new Set(DATA.cases.map((c) => c.lexicon))].sort(), ['de-DE', 'en-US', 'hi-IN', 'zh-CN']);
  });

  for (const id of Object.keys(LEXICONS)) {
    it(`${id}：W802 判据集合与夹具相同`, () => {
      const words = [...collisionWords(lexiconOf(id)).keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      assert.deepEqual(words, DATA.collisionWords[id]);
    });
  }

  for (const c of DATA.cases) {
    it(c.name, () => {
      const lexicon = lexiconOf(c.lexicon);
      if (c.reject) {
        assert.deepEqual(firstParseError(c), c.reject);
        if (c.params) assert.deepEqual(firstError(c)?.params, c.params);
        if (c.message) assert.equal(firstError(c)?.message, c.message);
        assert.equal(compile(c.source, { lexicon }).success, false);
        return;
      }
      assert.equal(firstParseError(c), null);
      const result = compile(c.source, { lexicon });
      assert.ok(result.success, `编译失败：${JSON.stringify(result.parseErrors ?? result.resolutionDiagnostics)}`);
      for (const n of c.names ?? []) assert.ok(result.coreJson?.includes(`"${n}"`), `Core IR 含名字 ${n}`);
      const warnings = (result.resolutionDiagnostics ?? [])
        .filter((d) => d.code === 'W802')
        .map((d) => [d.code, d.span?.start.line ?? 0]);
      assert.deepEqual(warnings, c.warnings ?? []);
    });
  }

  it('W802 的消息与参数：zh 字段 版本', () => {
    const c = DATA.cases.find((x) => x.name.startsWith('zh-CN 字段 版本'))!;
    const parsed = parseWithLexicon(lex(canonicalize(c.source, ZH_CN), ZH_CN), ZH_CN);
    const [first] = checkKeywordNames(parsed.ast, ZH_CN, c.source);
    assert.deepEqual(first?.data, { name: 'version', keyword: '版本', kind: 'IMPORT_VERSION' });
    assert.equal(first?.message, "'版本' is read as the keyword IMPORT_VERSION: the name becomes 'version'");
    assert.equal(first?.severity, 'warning');
  });

  it('E901 的参数与英文消息：zh 形参 当', () => {
    const lexicon = ZH_CN;
    const c = DATA.cases.find((x) => x.name === 'zh-CN 形参名 当')!;
    try {
      const parsed = parseWithLexicon(lex(canonicalize(c.source, lexicon), lexicon), lexicon);
      const first = parsed.diagnostics.find((d) => d.severity === 'error');
      assert.ok(first);
      assert.deepEqual(first.params, { keyword: 'kw.when', kind: 'WHEN' });
      assert.equal(first.message, "'当' is the keyword WHEN and cannot be used as a name; write it in backticks to use it as a name");
    } catch (e) {
      assert.ok(e instanceof DiagnosticError, String(e));
      assert.deepEqual(e.diagnostic.params, { keyword: 'kw.when', kind: 'WHEN' });
      assert.equal(e.diagnostic.message, "'当' is the keyword WHEN and cannot be used as a name; write it in backticks to use it as a name");
    }
  });

  it('ts 夹具与 aster-lang-core 副本 byte-identical（跨仓同源）', () => {
    // 与 parse-diagnostics-parity 同口径：CI 中兄弟仓必须存在（fail-closed），本地未并列 checkout 时跳过。
    const RELATIVE = 'src/test/resources/diagnostics/keyword_name_parity.json';
    const candidates = [resolve(REPO_ROOT, '..', 'aster-lang-core', RELATIVE), resolve(REPO_ROOT, 'aster-lang-core', RELATIVE)];
    const inCi =
      process.env.CI === 'true' ||
      process.env.GITHUB_ACTIONS === 'true' ||
      process.env.ASTER_ERROR_CODES_PARITY_REQUIRED === 'true';
    let javaBytes: Buffer | undefined;
    for (const candidate of candidates) {
      try {
        javaBytes = readFileSync(candidate);
        break;
      } catch {
        // 试下一个候选路径
      }
    }
    if (!javaBytes) {
      if (inCi) assert.fail(`CI 中必须 checkout aster-lang-core 才能校验 parity 夹具同源：\n${candidates.join('\n')}`);
      return;
    }
    assert.ok(readFileSync(FIXTURE).equals(javaBytes), 'keyword_name_parity.json 与 aster-lang-core 副本必须 byte-identical');
  });
});
