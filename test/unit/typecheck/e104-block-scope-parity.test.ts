/**
 * E104 块作用域与 Java TypeChecker 对齐（aster-lang-ts#231）。
 *
 * Java 端 BaseTypeChecker.checkBlock 不为 If 分支、函数体开新作用域，只有 Scope 语句、match 分支、
 * lambda 才开。TS 端曾为每个块开作用域，于是「If 分支里 Let 外层同名变量」在编辑器里显示可编译，
 * 而服务端保存门禁报 E104 拒绝（aster-cloud#560 的 Auto Insurance 模板即此情形）。
 * 夹具取自该模板修复前后的 en/zh/de 源码；行号即 Java 端报错的行号（L42、L44）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileAndTypecheck } from '../../../src/browser.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';

const FIXTURES = resolve(process.cwd(), 'test', 'fixtures', 'e104-shadowing');
// 中文夹具用 .txt：其 CJK 标识符无法经格式化器（只输出英文 CNL）往返，若用 .aster 会被
// formatter-corpus-roundtrip 的全仓扫描拾取而误报；en/de 夹具仍以 .aster 参与该扫描。
const LOCALES = [
  { locale: 'en', ext: 'aster', lexicon: undefined },
  { locale: 'zh', ext: 'txt', lexicon: ZH_CN },
  { locale: 'de', ext: 'aster', lexicon: DE_DE },
] as const;

function e104Lines(source: string, lexicon: (typeof LOCALES)[number]['lexicon']): number[] {
  const result = compileAndTypecheck(source, lexicon ? { lexicon } : undefined);
  return result.typeErrors
    .filter((d) => d.code === ErrorCode.DUPLICATE_SYMBOL)
    .map((d) => d.span?.start.line ?? -1)
    .sort((a, b) => a - b);
}

describe('E104：If 分支与外层共享作用域（与 Java 对齐）', () => {
  for (const { locale, ext, lexicon } of LOCALES) {
    it(`${locale}：分支内重绑定外层变量报 E104（L42、L44）`, () => {
      const source = readFileSync(resolve(FIXTURES, `auto-insurance.${locale}.${ext}`), 'utf8');
      assert.deepEqual(e104Lines(source, lexicon), [42, 44]);
    });

    it(`${locale}：改写为不重绑定后无 E104`, () => {
      const source = readFileSync(resolve(FIXTURES, `auto-insurance-fixed.${locale}.${ext}`), 'utf8');
      assert.deepEqual(e104Lines(source, lexicon), []);
    });
  }

  it('函数体与形参同一作用域：Let 与形参同名报 E104', () => {
    const source = [
      'Module m.',
      '',
      'Rule r given x as Int, produce Int:',
      '  Let x be 1.',
      '  Return x.',
      '',
    ].join('\n');
    assert.deepEqual(e104Lines(source, undefined), [4]);
  });

  it('可见性：分支内 Let 的变量在分支之后仍可见（与 Java 一致，不报未定义变量）', () => {
    const source = [
      'Module m.',
      '',
      'Rule r given x as Int, produce Int:',
      '  If x greater than 0',
      '    Let y be x plus 1.',
      '  Return y.',
      '',
    ].join('\n');
    const result = compileAndTypecheck(source);
    const errors = result.typeErrors.filter((d) => d.severity === 'error');
    assert.deepEqual(errors.map((d) => d.code), []);
  });

  it('不同变量名不受影响', () => {
    const source = [
      'Module m.',
      '',
      'Rule r given x as Int, produce Int:',
      '  Let y be 1.',
      '  If x greater than 0',
      '    Let z be y plus x.',
      '    Return z.',
      '  Return y.',
      '',
    ].join('\n');
    assert.deepEqual(e104Lines(source, undefined), []);
  });
});
