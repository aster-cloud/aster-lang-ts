/**
 * 全语料格式化往返：本仓与兄弟仓 aster-lang-test/corpus 下每个能编译的 .aster，
 * 格式化后重新编译，Core IR 须与原文相同（忽略 origin）。
 *
 * 源文的词法包取 .meta.json 的 lexicon，否则依次尝试 en-US / zh-CN / de-DE，取第一个能编译的；
 * 哪个都编译不了的（错误夹具、旧语法示例）不在往返范围内。格式化器输出英文 CNL，故一律用 en-US 重新编译。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
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

// 编译后从 dist/test/unit 运行：上溯 3 级到仓库根
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', '.ccg', 'aster-lang-test']);
const LEXICONS: Readonly<Record<string, Lexicon>> = { 'en-US': EN_US, 'zh-CN': ZH_CN, 'de-DE': DE_DE };

// 源文用中文标识符：格式化器只输出英文 CNL，而 en-US 词法不接受 CJK 标识符字符（lexer isLetter 英文模式），
// 英文重写后无法重新词法分析。路径相对兄弟仓 aster-lang-test 根。
const CJK_IDENTIFIERS = '中文标识符无法以英文 CNL 重写（en-US 词法不接受 CJK 标识符）';
const ALLOW_LIST: ReadonlyMap<string, string> = new Map([
  ['corpus/conformance/cjk-v2/01-punctuation-basic.aster', CJK_IDENTIFIERS],
  ['corpus/conformance/cjk-v2/02-string-preservation.aster', CJK_IDENTIFIERS],
  ['corpus/conformance/cjk-v2/04-identifier-no-collision.aster', CJK_IDENTIFIERS],
  ['corpus/tier3-fixtures/lexicon-i18n/01-hello__i18n-zh-CN.aster', CJK_IDENTIFIERS],
  ['corpus/tier3-fixtures/lexicon-i18n/02-types__i18n-zh-CN.aster', CJK_IDENTIFIERS],
  ['corpus/tier3-fixtures/lexicon-i18n/03-functions__i18n-zh-CN.aster', CJK_IDENTIFIERS],
  ['corpus/tier3-fixtures/lexicon-i18n/04-control-flow__i18n-zh-CN.aster', CJK_IDENTIFIERS],
  ['corpus/tier3-fixtures/lexicon-i18n/05-patterns__i18n-zh-CN.aster', CJK_IDENTIFIERS],
  ['corpus/tier3-fixtures/lexicon-i18n/06-operators__i18n-zh-CN.aster', CJK_IDENTIFIERS],
  ['corpus/tier3-fixtures/lexicon-i18n/user_greeting.aster', CJK_IDENTIFIERS],
]);

function asterFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) asterFiles(path, out);
    else if (path.endsWith('.aster')) out.push(path);
  }
  return out;
}

function siblingTestRepo(): string | undefined {
  return [join(repoRoot, '..', 'aster-lang-test'), join(repoRoot, 'aster-lang-test')]
    .find((c) => existsSync(join(c, 'corpus')));
}

function toCore(source: string, lexicon: Lexicon): Core.Module {
  const result = parseWithLexicon(lex(canonicalize(source, lexicon), lexicon), lexicon);
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new Error(errors[0]!.message);
  return lowerModule(result.ast);
}

function stripOrigins(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(stripOrigins);
  if (!o || typeof o !== 'object') return o;
  return Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'origin').map(([k, v]) => [k, stripOrigins(v)]));
}

function declaredLexicon(file: string): string | undefined {
  const meta = file.replace(/\.aster$/, '.meta.json');
  return existsSync(meta) ? (JSON.parse(readFileSync(meta, 'utf8')) as { lexicon?: string }).lexicon : undefined;
}

/** 返回能编译源文的词法包及其 Core IR；都不能编译时为 undefined */
function compileWithAnyLexicon(file: string, source: string): { lexicon: Lexicon; core: unknown } | undefined {
  const names = [declaredLexicon(file), 'en-US', 'zh-CN', 'de-DE'].filter((n): n is string => !!n && n in LEXICONS);
  for (const name of names) {
    try {
      return { lexicon: LEXICONS[name]!, core: stripOrigins(toCore(source, LEXICONS[name]!)) };
    } catch {
      // 换下一个词法包
    }
  }
  return undefined;
}

/** 格式化后重新编译与原文比对；返回失败原因，成功为 undefined */
function roundTripProblem(file: string): string | undefined {
  const source = readFileSync(file, 'utf8');
  const compiled = compileWithAnyLexicon(file, source);
  if (compiled === undefined) return undefined;
  const formatted = formatCNL(source, { lexicon: compiled.lexicon });
  try {
    assert.deepEqual(stripOrigins(toCore(formatted, EN_US)), compiled.core);
    return undefined;
  } catch (e) {
    return (e as Error).message.split('\n')[0];
  }
}

test('全语料格式化往返 Core IR 不变', (t) => {
  const sibling = siblingTestRepo();
  if (sibling === undefined) {
    assert.ok(!process.env.CI, 'CI 中须 checkout aster-lang-test（见 .github/workflows/ci.yml test job）');
    t.diagnostic('aster-lang-test 未并列 checkout，只检查本仓语料');
  }
  const files = [
    ...asterFiles(repoRoot).map((f) => ({ file: f, key: relative(repoRoot, f) })),
    ...(sibling ? asterFiles(join(sibling, 'corpus')).map((f) => ({ file: f, key: relative(sibling, f) })) : []),
  ];
  const failures = files
    .map(({ file, key }) => ({ key, problem: roundTripProblem(file) }))
    .filter(({ key, problem }) => problem !== undefined && !ALLOW_LIST.has(key));
  assert.deepEqual(failures, []);
});

test('允许清单中的条目确实仍不能往返（能往返的须移出清单）', (t) => {
  const sibling = siblingTestRepo();
  if (sibling === undefined) return t.skip('aster-lang-test 未并列 checkout');
  const stale = [...ALLOW_LIST.keys()].filter((key) => roundTripProblem(join(sibling, key)) === undefined);
  assert.deepEqual(stale, []);
});
