/**
 * 名称解析诊断码 E800–E807 / W800–W801（ADR 0051）。
 * 校验码值、严重级别、英文文案约束与中文 overlay 覆盖（全语言覆盖见 diagnostic-overlays.test.ts）。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ErrorCode, ERROR_MESSAGES, ERROR_METADATA } from '../../../src/diagnostics/error_codes.js';
import { MESSAGES_BY_LEXICON, HELP_BY_LEXICON } from '../../../src/config/lexicons/diagnostic-messages.js';

interface Expected {
  readonly code: string;
  /** shared/error_codes.json 的键名，须与 ErrorCode 枚举键一致 */
  readonly name: string;
  readonly severity: 'error' | 'warning';
  /** 英文与中文文案都必须引用、且只引用这些占位符（resolve-*.ts 按此传参） */
  readonly placeholders: readonly string[];
}

const NAME_ROLE = ['role', 'written'];
const AMBIGUOUS = ['candidates', 'role', 'written'];

const EXPECTED: ReadonlyArray<Expected> = [
  { code: 'E800', name: 'UNRESOLVED_TYPE', severity: 'error', placeholders: NAME_ROLE },
  { code: 'E801', name: 'UNRESOLVED_FIELD', severity: 'error', placeholders: NAME_ROLE },
  { code: 'E802', name: 'UNRESOLVED_NAME', severity: 'error', placeholders: NAME_ROLE },
  { code: 'E803', name: 'UNRESOLVED_PATTERN', severity: 'error', placeholders: NAME_ROLE },
  { code: 'E804', name: 'AMBIGUOUS_NAME', severity: 'error', placeholders: AMBIGUOUS },
  { code: 'E805', name: 'AMBIGUOUS_FIELD', severity: 'error', placeholders: AMBIGUOUS },
  { code: 'E806', name: 'AMBIGUOUS_PATTERN', severity: 'error', placeholders: AMBIGUOUS },
  { code: 'E807', name: 'DUPLICATE_DECLARATION', severity: 'error', placeholders: NAME_ROLE },
  { code: 'W800', name: 'SHADOWED_VOCABULARY', severity: 'warning', placeholders: NAME_ROLE },
  { code: 'W801', name: 'RESOLVED_WITHOUT_TYPE', severity: 'warning', placeholders: NAME_ROLE },
];

/** 文案中出现的占位符名（去重、排序） */
function placeholdersOf(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].sort();
}

// Han、平假名/片假名、谚文
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/;

// 按测试文件自身位置定位仓库根（dist/test/unit/diagnostics → 上溯 4 级），不依赖 cwd
const repoFile = (rel: string): string => readFileSync(fileURLToPath(new URL(`../../../../${rel}`, import.meta.url)), 'utf8');

const table = JSON.parse(repoFile('shared/error_codes.json')) as Record<
  string,
  { code: string; severity: string; message: string; help: string }
>;

// ErrorCode 是 const enum，运行时没有键名 → 从生成的源码里读出「枚举键 → 码值」
const enumKeys = new Map(
  [...repoFile('src/diagnostics/error_codes.ts').matchAll(/^\s+([A-Z][A-Z0-9_]*) = "([EWI]\d+)",?$/gm)].map((m) => [m[1]!, m[2]!]),
);

describe('名称解析诊断码 E800–E807 / W800–W801', () => {
  it('枚举值与码表名称一致', () => {
    assert.equal(ErrorCode.UNRESOLVED_TYPE, 'E800');
    assert.equal(ErrorCode.UNRESOLVED_FIELD, 'E801');
    assert.equal(ErrorCode.UNRESOLVED_NAME, 'E802');
    assert.equal(ErrorCode.UNRESOLVED_PATTERN, 'E803');
    assert.equal(ErrorCode.AMBIGUOUS_NAME, 'E804');
    assert.equal(ErrorCode.AMBIGUOUS_FIELD, 'E805');
    assert.equal(ErrorCode.AMBIGUOUS_PATTERN, 'E806');
    assert.equal(ErrorCode.DUPLICATE_DECLARATION, 'E807');
    assert.equal(ErrorCode.SHADOWED_VOCABULARY, 'W800');
    assert.equal(ErrorCode.RESOLVED_WITHOUT_TYPE, 'W801');
  });

  for (const { code, name, severity, placeholders } of EXPECTED) {
    describe(code, () => {
      const meta = Object.values(ERROR_METADATA).find(m => (m.code as string) === code);

      it('存在且严重级别正确', () => {
        assert.ok(meta, `${code} 应在 ERROR_METADATA 中`);
        assert.equal(meta.severity, severity);
        assert.equal(meta.category, 'scope');
      });

      it('英文文案非空、无 CJK 且恰好引用约定的占位符', () => {
        assert.ok(meta);
        const message = ERROR_MESSAGES[meta.code];
        assert.ok(message && message.length > 0);
        assert.ok(meta.help.length > 0);
        assert.deepEqual(placeholdersOf(message), placeholders, `${code} 英文 message 占位符`);
        assert.ok(!CJK.test(message), `${code} message 含 CJK`);
        assert.ok(!CJK.test(meta.help), `${code} help 含 CJK`);
      });

      it('中文 overlay 的消息与帮助非空，消息占位符与英文一致', () => {
        const zhMsg = MESSAGES_BY_LEXICON['zh-CN']?.[code];
        const zhHelp = HELP_BY_LEXICON['zh-CN']?.[code];
        assert.ok(zhMsg && zhMsg.length > 0, `${code} 缺少 zh-CN 消息`);
        assert.deepEqual(placeholdersOf(zhMsg), placeholders, `${code} zh-CN message 占位符`);
        assert.ok(zhHelp && zhHelp.length > 0, `${code} 缺少 zh-CN 帮助`);
      });

      it('码表键名与 ErrorCode 枚举键一致，条目与生成的元数据一致', () => {
        const entry = table[name];
        assert.ok(entry, `shared/error_codes.json 缺少键 ${name}`);
        assert.equal(entry.code, code);
        assert.equal(enumKeys.get(name), code, `ErrorCode.${name} 应为 ${code}`);
        assert.equal(Object.entries(table).filter(([, v]) => v.code === code).length, 1, `${code} 在码表中应唯一`);
        assert.ok(meta);
        assert.equal(entry.severity, meta.severity);
        assert.equal(entry.message, ERROR_MESSAGES[meta.code]);
        assert.equal(entry.help, meta.help);
      });
    });
  }

  for (const code of ['E804', 'E806']) {
    it(`${code} 帮助提示写限定名或加类型注解`, () => {
      const meta = Object.values(ERROR_METADATA).find(m => (m.code as string) === code);
      assert.ok(meta);
      assert.ok(meta.help.includes('Stufe.Hoch'), '应含限定名示例');
      assert.ok(/type annotation/i.test(meta.help), '应含类型注解提示');
      assert.ok(HELP_BY_LEXICON['zh-CN']?.[code]?.includes('Stufe.Hoch'));
    });
  }
});
