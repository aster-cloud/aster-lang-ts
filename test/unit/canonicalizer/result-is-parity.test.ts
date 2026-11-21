/**
 * `The result is` / `Ergebnis ist` / `结果为` 与英语所有格（aster-lang-core#298，Wave C N1/D2）。
 *
 * Java 清单对 en-US / de-DE / zh-CN 启用 `english-possessive` 与 `result-is`；本引擎此前没有对 en-US / de-DE 启用，
 * 编辑器与 CLI 拒绝生产接受的写法。共享夹具 shared/result_is_parity.json 与 aster-lang-core
 * src/test/resources/diagnostics/result_is_parity.json 逐字节相同，core ResultIsParityTest 按同一夹具断言。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileSource, positionFreeSha256 } from '../../../src/policy-package/compile-source.js';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parseWithLexicon } from '../../../src/parser.js';
import { DiagnosticError } from '../../../src/diagnostics/diagnostics.js';
import { applyTransformers, getTransformer } from '../../../src/frontend/transformers.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';

interface ResultIsCase {
  readonly name: string;
  readonly lexicon: string;
  readonly source: string;
  readonly equivalent?: string;
  readonly reject?: boolean;
  readonly errorLine?: number;
}

const FIXTURE = resolve(process.cwd(), 'shared', 'result_is_parity.json');
const CASES = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: ResultIsCase[] }).cases;
const LEXICONS: Readonly<Record<string, Lexicon>> = { 'en-US': EN_US, 'de-DE': DE_DE, 'zh-CN': ZH_CN };

/** 第一条解析错误的行号；能解析时返回 null。 */
function firstErrorLine(c: ResultIsCase): number | null {
  const lexicon = LEXICONS[c.lexicon];
  assert.ok(lexicon, `未知 lexicon ${c.lexicon}`);
  try {
    const parsed = parseWithLexicon(lex(canonicalize(c.source, lexicon), lexicon), lexicon);
    const first = parsed.diagnostics.find((d) => d.severity === 'error');
    return first ? first.span.start.line : null;
  } catch (e) {
    if (e instanceof DiagnosticError) return e.diagnostic.span.start.line;
    throw e;
  }
}

describe('result-is / english-possessive 共享夹具（ts 侧）', () => {
  it('共享夹具共 43 例', () => assert.equal(CASES.length, 43));

  for (const c of CASES) {
    it(c.name, () => {
      if (c.reject) {
        assert.equal(firstErrorLine(c), c.errorLine);
        assert.throws(() => compileSource(c.source, { locale: c.lexicon }));
        return;
      }
      assert.ok(c.equivalent !== undefined, '正例须带 equivalent');
      const ir = compileSource(c.source, { locale: c.lexicon });
      assert.equal(positionFreeSha256(ir), positionFreeSha256(compileSource(c.equivalent, { locale: c.lexicon })));
    });
  }
});

describe('result-is 变换器按词法表拼写改写', () => {
  const rewrite = (source: string, lexicon?: Lexicon): string =>
    applyTransformers(source, ['result-is'], { open: '"', close: '"' }, lexicon);

  it('en-US / de-DE / zh-CN：行首与逗号之后', () => {
    assert.equal(rewrite('  The result is x', EN_US), '  Return x');
    assert.equal(rewrite('    When 1, the result is 2', EN_US), '    When 1, Return 2');
    assert.equal(rewrite('  Ergebnis ist x', DE_DE), '  Return x');
    assert.equal(rewrite('    bei 1,Ergebnis ist 2', DE_DE), '    bei 1,Return 2');
    assert.equal(rewrite('　结果为　x', ZH_CN), '　Return x');
  });

  it('任何词法表下也认英文规范拼写（Java 先翻译成英文再改写）', () => {
    assert.equal(rewrite('  The result is x', DE_DE), '  Return x');
    assert.equal(rewrite('  the result is x', ZH_CN), '  Return x');
  });

  it('不传词法表时按英文（兼容旧调用）', () => {
    assert.equal(getTransformer('result-is')!.transform('  The result is 5'), '  Return 5');
  });

  it('分隔符不跨行、不认 VT / FF / 其他 Unicode 空白；非 zh-CN 不认 U+3000', () => {
    for (const ws of ['\n', '\r\n', '\u000B', '\f', ' ', ' ', '\u0085', '　']) {
      const input = `  The result is${ws}x`;
      assert.equal(rewrite(input, EN_US), input, JSON.stringify(ws));
    }
    assert.equal(rewrite('    When 1, the result is\nx', EN_US), '    When 1, the result is\nx');
  });

  it('只做 ASCII 大小写折叠（同 Java CASE_INSENSITIVE）：ſ / K 不当 s / k', () => {
    assert.equal(rewrite('  The reſult is x', EN_US), '  The reſult is x');
  });

  it('行中间与字符串里不改写', () => {
    for (const input of ['  Let y be the result is x', '  Return "The result is x"']) {
      assert.equal(rewrite(input, EN_US), input);
    }
  });
});

describe('canonicalize：多词关键词打标记之前改写（否则启用了也静默无效）', () => {
  it('en-US 与 de-DE 的规范化文本不再残留 RESULT_IS', () => {
    assert.equal(canonicalize('Module p.\n\nRule f given x as Int, produce Int:\n  The result is x.\n', EN_US).includes('result is'), false);
    assert.equal(canonicalize('Modul p.\n\nRegel f gegeben x als Ganzzahl, liefert Ganzzahl:\n  Ergebnis ist x.\n', DE_DE).toLowerCase().includes('ergebnis ist'), false);
  });

  it('行中间的 the result is 仍按多词关键词保护（不被冠词移除改写）', () => {
    const out = canonicalize('Module p.\n\nRule f given x as Int, produce Int:\n  Let y be the result is x.\n', EN_US);
    assert.ok(out.includes('the result is'), out);
  });
});
