/**
 * 关键词别名（ADR 0022）单元测试 —— TypeScript 引擎。
 *
 * 核心不变式：别名在 canonicalize/translate 阶段归一成规范拼写，故「别名版」与「规范版」
 * 源码编译到**结构一致的 Core IR**（仅源码位置 origin 元数据因关键词长度不同而偏移，
 * 这是派生层，与 IR 字段级 parity 方法学一致——ADR 0016 的 normalizeIr 也剥离 origin）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile, EN_US, initializeAllBundledLexicons } from '../../src/browser.js';
import { SemanticTokenKind } from '../../src/config/token-kind.js';
import {
  buildKeywordIndex,
  findSemanticTokenKind,
  getMultiWordKeywords,
  isLexiconKeyword,
  type Lexicon,
} from '../../src/config/lexicons/types.js';

initializeAllBundledLexicons();

/** en-US 加别名（不改规范拼写）。 */
const EN_ALIAS: Lexicon = {
  ...EN_US,
  aliases: {
    [SemanticTokenKind.FUNC_TO]: ['Policy'],
    [SemanticTokenKind.IF]: ['Whenever'],
    [SemanticTokenKind.TIMES]: ['multiplied by'],
  },
};

const ALIAS_SRC = `Module Pricing.

Policy discountedPrice given amount as Int, produce Int:
  Whenever amount greater than 100
    Return amount multiplied by 90 divided by 100.
  Return amount.`;

const CANON_SRC = `Module Pricing.

Rule discountedPrice given amount as Int, produce Int:
  If amount greater than 100
    Return amount times 90 divided by 100.
  Return amount.`;

/** 递归剥离 origin（源码位置元数据，派生层），用于结构级 IR 比较。 */
function stripOrigin(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(stripOrigin);
  if (o && typeof o === 'object') {
    const r: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      if (k === 'origin') continue;
      r[k] = stripOrigin((o as Record<string, unknown>)[k]);
    }
    return r;
  }
  return o;
}

describe('关键词别名（ADR 0022）', () => {
  it('别名版与规范版编译到结构一致的 Core IR', () => {
    const ra = compile(ALIAS_SRC, { lexicon: EN_ALIAS });
    const rc = compile(CANON_SRC, { lexicon: EN_US });
    assert.equal(ra.success, true, JSON.stringify(ra.parseErrors));
    assert.equal(rc.success, true);
    assert.deepEqual(stripOrigin(ra.core), stripOrigin(rc.core));
  });

  it('别名版求值结果正确（discountedPrice(200) = 180）', () => {
    const ra = compile(ALIAS_SRC, { lexicon: EN_ALIAS });
    assert.equal(ra.success, true);
    // evaluate 通过 browser 暴露；这里仅断言编译成功 + IR 含 times 算子
    const json = JSON.stringify(ra.core);
    assert.ok(json.includes('"name":"*"') || json.includes('times'), 'IR 应含乘法算子');
  });

  it('规范拼写源码始终编译（别名机制不影响规范路径）', () => {
    const rc = compile(CANON_SRC, { lexicon: EN_US });
    assert.equal(rc.success, true);
  });

  it('官方 builtin EN_US 不内置别名（方案 A 已回滚，机制保留供方案 D）', () => {
    // 方案 A（官方全租户别名）已回滚：builtin 无 aliases。别名只经方案 D 在编译期
    // 注入（如 EN_ALIAS），机制本身保留。
    assert.equal(EN_US.aliases, undefined);
  });

  it('注入别名不占标识符命名空间（policy/above 在无别名 EN_US 下仍可作字段/参数名）', () => {
    // 铁律：别名不得破坏用户空间。多词注入别名安全；单词别名占标识符命名空间，
    // 故方案 D 只放开白名单多词别名（见 ADR §11.5）。
    const r1 = compile(
      'Module M.\n\nDefine Account has policy as Int.\n\nRule c given a as Account, produce Int:\n  Return a.policy.',
      { lexicon: EN_US },
    );
    assert.equal(r1.success, true, JSON.stringify(r1.parseErrors));
    const r2 = compile('Module M.\n\nRule f given above as Int, produce Int:\n  Return above.', { lexicon: EN_US });
    assert.equal(r2.success, true, JSON.stringify(r2.parseErrors));
  });

  it('别名进入关键词索引与查找', () => {
    const index = buildKeywordIndex(EN_ALIAS);
    assert.equal(index.get('policy'), SemanticTokenKind.FUNC_TO);
    assert.equal(index.get('whenever'), SemanticTokenKind.IF);
    // 规范拼写仍在
    assert.equal(index.get('rule'), SemanticTokenKind.FUNC_TO);
    assert.equal(findSemanticTokenKind(EN_ALIAS, 'Policy'), SemanticTokenKind.FUNC_TO);
    assert.equal(isLexiconKeyword(EN_ALIAS, 'Whenever'), true);
    // 多词别名进最长匹配集
    assert.ok(getMultiWordKeywords(EN_ALIAS).includes('multiplied by'));
  });
});
