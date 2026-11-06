/**
 * ADR 0051 §16 R56：原本地码 P0xx / L0xx 的每个发出点都改发 E050–E069，并在 legacyCode 中保留原码
 * （过渡一个车次）。逐个发出点一条用例；对照表见 aster-lang-ts#291 描述。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parseWithLexicon } from '../../../src/parser.js';
import { DiagnosticError, toDiagnostic, type Diagnostic } from '../../../src/diagnostics/diagnostics.js';
import { createParserContext } from '../../../src/parser/context.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';

const H = 'Module m.\n\n';
const R = 'Rule f given x as Int, produce Int:\n';
const T = 'Rule f, produce Text:\n';

/** [发出点, 源码, 新码, legacyCode, lexicon] */
const CASES: readonly (readonly [string, string, string, string, Lexicon?])[] = [
  ['lexer.ts 264 unterminatedString（转义在文件末）', H + T + '  Return "a\\', 'E051', 'L002'],
  ['lexer.ts 281 unexpectedCharacter（\\u 非法）', H + T + '  Return "\\uZZZZ".\n', 'E050', 'L001'],
  ['lexer.ts 289 unexpectedCharacter（非法转义）', H + T + '  Return "\\q".\n', 'E050', 'L001'],
  ['lexer.ts 337 invalidIndentation', H + R + '   Return x.\n', 'E052', 'L003'],
  ['lexer.ts 348 inconsistentDedent', H + R + '  If x > 1:\n      Return 1.\n    Return 2.\n', 'E052', 'L004'],
  ['lexer.ts 502 unexpectedCharacter（孤立 !）', H + R + '  Return ! x.\n', 'E050', 'L001'],
  ['lexer.ts 582 unterminatedString（「」）', '模块 m。\n\n规则 f 给定 x 作为 整数，产出 文本：\n  返回 「abc。\n', 'E051', 'L002', ZH_CN],
  ['lexer.ts 600 unterminatedString', H + T + '  Return "abc.\n', 'E051', 'L002'],
  ['lexer.ts 671 decimalTooManyDigits', H + 'Rule f, produce Decimal:\n  Return 1' + '1'.repeat(45) + 'm.\n', 'E053', 'L005'],
  ['lexer.ts 681 floatLiteralNotFinite', H + 'Rule f, produce Float:\n  Return 1' + '0'.repeat(400) + '.5.\n', 'E053', 'L008'],
  ['lexer.ts 694 longLiteralOutOfRange', H + R + '  Return 99999999999999999999L.\n', 'E053', 'L007'],
  ['lexer.ts 703 intLiteralOutOfRange', H + R + '  Return 99999999999.\n', 'E053', 'L006'],
  ['lexer.ts 709 unexpectedCharacter', H + R + '  Return x § 1.\n', 'E050', 'L001'],
  ['import-parser.ts 33 expectedIdentifier', H + 'Use .\n', 'E055', 'P001'],
  ['context.ts 314 nestingTooDeep', H + R + '  Return ' + '('.repeat(400) + '1' + ')'.repeat(400) + '.\n', 'E054', 'P015'],
  ['type-parser.ts 319 expectedKeyword（map 缺 to）', H + 'Rule f given x as Map Text Int, produce Int:\n  Return 1.\n', 'E057', 'P004'],
  ['parser-tools.ts 69 tools.error', H + R + '  Banana x.\n', 'E064', 'P005'],
  ['parser-tools.ts 78 tools.expectKeyword', H + 'Type Score Int.\n', 'E056', 'P004'],
  ['parser-tools.ts 87 expectDot', 'Module m\n\nRule f, produce Int:\n  Return 1.\n', 'E059', 'P006'],
  ['parser-tools.ts 101 expectNewline（函数头冒号后同行写语句）', H + R.replace(':\n', ': Return x.\n'), 'E055', 'P003'],
  ['parser-tools.ts 113 parseIdent', H + 'Rule , produce Int:\n  Return 1.\n', 'E055', 'P001'],
  ['parser-tools.ts 125 parseTypeIdent', H + 'Define 1 has v as Int.\n', 'E055', 'P003'],
  // cloud invalidConstructForm 启发式的对象：过渡期按 legacyCode === 'P005' 识别，新码 E057（与 Java 一致）
  ['构造写法 X with f = v', H + 'Define User has name as Text.\n\nRule f, produce User:\n  Return User with name = "a".\n', 'E057', 'P005'],
  ['expr-stmt-parser.ts expectKeyword（经 error）', H + R + '  Let y x.\n', 'E057', 'P005'],
];

function firstDiagnostic(source: string, lexicon: Lexicon = EN_US): Diagnostic | undefined {
  try {
    return parseWithLexicon(lex(canonicalize(source, lexicon), lexicon), lexicon).diagnostics[0];
  } catch (e) {
    if (e instanceof DiagnosticError) return e.diagnostic;
    throw e;
  }
}

describe('R56 legacyCode：每个原 P/L 码发出点', () => {
  for (const [site, source, code, legacy, lexicon] of CASES) {
    it(site, () => {
      const d = firstDiagnostic(source, lexicon);
      assert.ok(d, '应有诊断');
      assert.deepEqual([d.code, d.legacyCode], [code, legacy], d.message);
      assert.ok(d.params !== undefined, '应带命名参数');
    });
  }

  it('context.ts 257 nextWord（非关键词 / 标识符）→ E055 + P005', () => {
    // 调用方都先判过关键词，源码层面难以触达；直接驱动上下文
    const ctx = createParserContext(lex(canonicalize('(', EN_US), EN_US), EN_US);
    let d: Diagnostic | undefined;
    try {
      ctx.nextWord();
    } catch (e) {
      d = (e as DiagnosticError).diagnostic;
    }
    assert.deepEqual([d?.code, d?.legacyCode, d?.message], ['E055', 'P005', 'Expected keyword/identifier']);
  });

  it('decl-parser 恢复路径 toDiagnostic（非 DiagnosticError）→ E061 + P005', () => {
    const d = toDiagnostic(new Error('boom'));
    assert.deepEqual([d.code, d.legacyCode, d.message], ['E061', 'P005', 'boom']);
  });
});
