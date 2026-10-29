/**
 * 诊断译文 overlay 接入（aster-cloud/aster-lang-locales#107）。
 *
 * 英文基准是 shared/error_codes.json；各语言的 message/help 译文唯一来源是语言包 overlay
 * （aster-lang-locales 的 zh/de、aster-lang-hi 的 hi），经 core exportLexicons 进入
 * lexicons.json，再由 scripts/generate-diagnostic-overlays.ts 生成
 * src/config/lexicons/diagnostic-overlays.generated.ts。本文件校验：
 * - 生成表经 registerOverlayDiagnostic* 注册，且每个语言覆盖全部错误码、占位符与英文一致；
 * - 生成脚本的渲染规则（确定性、只收诊断 overlay、拒绝畸形输入）；
 * - localizeDiagnostics 与浏览器入口 compile / compileAndTypecheck 输出本地化诊断。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { compile, compileAndTypecheck, DE_DE, EN_US, ZH_CN } from '../../../src/browser.js';
import { HI_IN } from '../../../src/config/lexicons/hi-IN.js';
import { DIAGNOSTIC_OVERLAYS } from '../../../src/config/lexicons/diagnostic-overlays.generated.js';
import { HELP_BY_LEXICON, MESSAGES_BY_LEXICON } from '../../../src/config/lexicons/diagnostic-messages.js';
import { localizeDiagnostics } from '../../../src/typecheck/diagnostics.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import type { TypecheckDiagnostic } from '../../../src/types.js';
import { renderDiagnosticOverlays } from '../../../scripts/generate-diagnostic-overlays.js';

interface Spec {
  readonly code: string;
  readonly message: string;
  readonly help: string;
}

const TABLE = Object.values(
  JSON.parse(readFileSync(resolve(process.cwd(), 'shared', 'error_codes.json'), 'utf8')) as Record<string, Spec>,
);
const LOCALIZED = ['de-DE', 'hi-IN', 'zh-CN'] as const;

function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].sort();
}

function coverageProblems(texts: Readonly<Partial<Record<string, string>>> | undefined, pick: (s: Spec) => string): string[] {
  if (!texts) return ['未注册'];
  const problems: string[] = [];
  for (const spec of TABLE) {
    const text = texts[spec.code];
    if (!text || text.trim() === '') {
      problems.push(`${spec.code}: 缺少译文`);
    } else if (placeholders(text).join() !== placeholders(pick(spec)).join()) {
      problems.push(`${spec.code}: 占位符 ${placeholders(text)} 与英文 ${placeholders(pick(spec))} 不一致`);
    }
  }
  const codes = new Set(TABLE.map((s) => s.code));
  for (const code of Object.keys(texts)) if (!codes.has(code)) problems.push(`${code}: 码表中不存在`);
  return problems;
}

describe('诊断译文 overlay：生成表与注册', () => {
  it('生成表恰好包含 de-DE、hi-IN、zh-CN，且全部注册到 MESSAGES/HELP_BY_LEXICON', () => {
    assert.deepEqual(Object.keys(DIAGNOSTIC_OVERLAYS).sort(), [...LOCALIZED]);
    for (const id of LOCALIZED) {
      assert.deepEqual(MESSAGES_BY_LEXICON[id], DIAGNOSTIC_OVERLAYS[id]?.diagnosticMessages?.messages, `${id} messages`);
      assert.deepEqual(HELP_BY_LEXICON[id], DIAGNOSTIC_OVERLAYS[id]?.diagnosticHelp?.help, `${id} help`);
    }
    assert.equal(MESSAGES_BY_LEXICON['en-US'], undefined, 'en-US 使用码表英文，不注册 overlay');
  });

  for (const id of LOCALIZED) {
    it(`${id}：message 覆盖全部 ${TABLE.length} 个错误码且占位符与英文一致`, () => {
      assert.deepEqual(coverageProblems(MESSAGES_BY_LEXICON[id], (s) => s.message), []);
    });

    it(`${id}：help 覆盖全部错误码且占位符与英文一致`, () => {
      assert.deepEqual(coverageProblems(HELP_BY_LEXICON[id], (s) => s.help), []);
    });
  }
});

describe('generate-diagnostic-overlays 渲染', () => {
  const lexiconsJson = {
    lexicons: {
      'zz-ZZ': { overlays: { diagnosticHelp: { version: 1, help: { E001: "z'help" } } } },
      'aa-AA': {
        overlays: {
          lspUiTexts: { version: 1, texts: { a: 'b' } },
          diagnosticMessages: { version: 1, messages: { E001: 'a {expected} {actual}' } },
          diagnosticHelp: { version: 1, help: { E001: 'a-help' } },
        },
      },
      'en-US': { overlays: { lspUiTexts: { version: 1, texts: {} } } },
      'xx-XX': {},
    },
  };

  it('按语言 id 排序，只收诊断 overlay，跳过没有诊断 overlay 的语言', () => {
    const out = renderDiagnosticOverlays(lexiconsJson);
    assert.ok(out.indexOf("'aa-AA'") < out.indexOf("'zz-ZZ'"));
    assert.ok(!out.includes('en-US') && !out.includes('xx-XX') && !out.includes('lspUiTexts'));
    assert.ok(out.includes('"z\'help"'), '值以 JSON 字面量写出');
    assert.equal(renderDiagnosticOverlays(lexiconsJson), out, '输出确定');
  });

  it('译文不是字符串时拒绝生成', () => {
    const bad = { lexicons: { 'aa-AA': { overlays: { diagnosticMessages: { version: 1, messages: { E001: 1 } } } } } };
    assert.throws(() => renderDiagnosticOverlays(bad), /aa-AA.*diagnosticMessages.*E001/);
  });

  it('译文节点缺失时拒绝生成', () => {
    const bad = { lexicons: { 'aa-AA': { overlays: { diagnosticHelp: { version: 1 } } } } };
    assert.throws(() => renderDiagnosticOverlays(bad), /aa-AA.*diagnosticHelp/);
  });
});

describe('localizeDiagnostics', () => {
  const english: TypecheckDiagnostic = {
    severity: 'error',
    code: ErrorCode.UNRESOLVED_FIELD,
    message: "Cannot resolve field 'gewicht' in FIELD_REF position",
    help: 'Check the field name against the data type declaration or the active vocabulary.',
    data: { written: 'gewicht', role: 'FIELD_REF', candidates: '' },
  };

  it('按诊断参数用目标语言模板重新渲染 message，并替换 help', () => {
    const [de] = localizeDiagnostics([english], DE_DE);
    assert.equal(de!.message, "Feld 'gewicht' kann an Position FIELD_REF nicht aufgelöst werden");
    assert.equal(de!.help, DIAGNOSTIC_OVERLAYS['de-DE']!.diagnosticHelp!.help['E801']);
    const [hi] = localizeDiagnostics([english], HI_IN);
    assert.equal(hi!.message, "FIELD_REF स्थान पर फ़ील्ड 'gewicht' हल नहीं हो सका");
    assert.equal(english.message, "Cannot resolve field 'gewicht' in FIELD_REF position", '不修改输入');
  });

  it('参数不足以填满模板时保留原 message，只替换 help', () => {
    const noData = { ...english };
    delete noData.data;
    const [zh] = localizeDiagnostics([noData], ZH_CN);
    assert.equal(zh!.message, english.message);
    assert.equal(zh!.help, HELP_BY_LEXICON['zh-CN']!['E801']);
  });

  it('原诊断没有 help 时不补 help', () => {
    const noHelp = { ...english };
    delete noHelp.help;
    const [zh] = localizeDiagnostics([noHelp], ZH_CN);
    assert.equal(zh!.help, undefined);
    assert.equal(zh!.message, "无法在 FIELD_REF 位置解析字段 'gewicht'");
  });

  it('无 lexicon 或 en-US 时原样返回', () => {
    assert.deepEqual(localizeDiagnostics([english], undefined), [english]);
    assert.deepEqual(localizeDiagnostics([english], EN_US), [english]);
  });
});

describe('浏览器入口输出本地化诊断（cloud 编辑器路径）', () => {
  const unresolvedField =
    'Modul m.\n\nDefiniere Fahrer hat alter als Ganzzahl.\n\n' +
    'Regel f gegeben x als Fahrer, liefert Ganzzahl:\n  gib zurueck x.gewicht.\n';

  it('compile 的名称解析诊断按 lexicon 本地化', () => {
    const result = compile(unresolvedField, { lexicon: DE_DE });
    const e801 = result.resolutionDiagnostics?.find((d) => d.code === ErrorCode.UNRESOLVED_FIELD);
    assert.ok(e801, JSON.stringify(result.resolutionDiagnostics));
    assert.match(e801.message, /^Feld 'gewicht' kann an Position \w+ nicht aufgelöst werden$/);
    assert.equal(e801.help, HELP_BY_LEXICON['de-DE']!['E801']);
  });

  it('compileAndTypecheck 的类型检查诊断按 lexicon 本地化', () => {
    const source = readFileSync(resolve(process.cwd(), 'test', 'fixtures', 'e104-shadowing', 'auto-insurance.de.aster'), 'utf8');
    const result = compileAndTypecheck(source, { lexicon: DE_DE });
    const e104 = result.typeErrors.filter((d) => d.code === ErrorCode.DUPLICATE_SYMBOL);
    assert.ok(e104.length > 0, JSON.stringify(result.typeErrors));
    for (const d of e104) assert.match(d.message, /ist in diesem Gültigkeitsbereich bereits definiert\.$/);
  });

  it('英文源码不带 lexicon 时诊断保持英文', () => {
    const src = 'Module m.\n\nRule r given x as Int, produce Int:\n  Let x be 1.\n  Return x.\n';
    const result = compileAndTypecheck(src);
    const e104 = result.typeErrors.find((d) => d.code === ErrorCode.DUPLICATE_SYMBOL);
    assert.ok(e104);
    assert.match(e104.message, /already defined in this scope/);
  });
});
