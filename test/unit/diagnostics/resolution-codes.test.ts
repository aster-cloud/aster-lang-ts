/**
 * 名称解析诊断码 E800–E807 / W800–W801（ADR 0051）。
 * 校验码值、严重级别、英文文案约束与中文 fallback 覆盖。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ErrorCode, ERROR_MESSAGES, ERROR_METADATA } from '../../../src/diagnostics/error_codes.js';
import { MESSAGES_BY_LEXICON, HELP_BY_LEXICON } from '../../../src/config/lexicons/diagnostic-messages.js';

interface Expected {
  readonly code: string;
  readonly severity: 'error' | 'warning';
}

const EXPECTED: ReadonlyArray<Expected> = [
  { code: 'E800', severity: 'error' },
  { code: 'E801', severity: 'error' },
  { code: 'E802', severity: 'error' },
  { code: 'E803', severity: 'error' },
  { code: 'E804', severity: 'error' },
  { code: 'E805', severity: 'error' },
  { code: 'E806', severity: 'error' },
  { code: 'E807', severity: 'error' },
  { code: 'W800', severity: 'warning' },
  { code: 'W801', severity: 'warning' },
];

// Han、平假名/片假名、谚文
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/;

const table = JSON.parse(
  readFileSync(resolve(process.cwd(), 'shared', 'error_codes.json'), 'utf8'),
) as Record<string, { code: string }>;

function nameOf(code: string): string {
  const hit = Object.entries(table).find(([, v]) => v.code === code);
  assert.ok(hit, `码表缺少 ${code}`);
  return hit[0];
}

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

  for (const { code, severity } of EXPECTED) {
    describe(code, () => {
      const meta = Object.values(ERROR_METADATA).find(m => (m.code as string) === code);

      it('存在且严重级别正确', () => {
        assert.ok(meta, `${code} 应在 ERROR_METADATA 中`);
        assert.equal(meta.severity, severity);
        assert.equal(meta.category, 'scope');
      });

      it('英文文案非空、无 CJK 且引用 {written}', () => {
        assert.ok(meta);
        const message = ERROR_MESSAGES[meta.code];
        assert.ok(message && message.length > 0);
        assert.ok(meta.help.length > 0);
        assert.ok(message.includes('{written}'), `${code} message 应引用 {written}`);
        assert.ok(!CJK.test(message), `${code} message 含 CJK`);
        assert.ok(!CJK.test(meta.help), `${code} help 含 CJK`);
      });

      it('中文 fallback 的消息与帮助非空且引用 {written}', () => {
        const zhMsg = MESSAGES_BY_LEXICON['zh-CN']?.[code];
        const zhHelp = HELP_BY_LEXICON['zh-CN']?.[code];
        assert.ok(zhMsg && zhMsg.length > 0, `${code} 缺少 zh-CN 消息`);
        assert.ok(zhMsg.includes('{written}'));
        assert.ok(zhHelp && zhHelp.length > 0, `${code} 缺少 zh-CN 帮助`);
      });

      it('码表键名与 json 一致', () => {
        assert.ok(nameOf(code).length > 0);
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
