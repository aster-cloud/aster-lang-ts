import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIdentifierIndex,
  validateVocabulary,
  IdentifierKind,
} from '../../../../../src/config/lexicons/identifiers/index.js';
import type { DomainVocabulary, IdentifierMapping } from '../../../../../src/config/lexicons/identifiers/index.js';
import { canonicalize } from '../../../../../src/frontend/canonicalizer.js';
import { ZH_CN, HI_IN, EN_US, initializeAllBundledLexicons } from '../../../../../src/browser.js';
import { vocabularyRegistry } from '../../../../../src/config/lexicons/identifiers/registry.js';

initializeAllBundledLexicons();

// 字面量宏（IdentifierKind.LITERAL）：canonicalize 时把 localized token 展开成字符串
// 字面量（用 lexicon 引号包裹），内容受严格校验防注入。与 aster-lang-core LiteralMacroTest
// 逐条对齐（双引擎 parity）。动机：《静夜思》demo 里 思故乡 → "静夜思"。

function vocab(literals: readonly IdentifierMapping[], extra: Partial<DomainVocabulary> = {}): DomainVocabulary {
  return {
    id: 'jingyesi', name: '静夜思', locale: 'zh-CN', version: '1.0.0',
    structs: [], fields: [], functions: [], enumValues: [],
    literals,
    ...extra,
  };
}

describe('字面量宏 IdentifierKind.LITERAL', () => {
  it('canonicalize 把 思故乡 展开成 lexicon 引号包裹的字符串字面量', () => {
    const v = vocab([{ localized: '思故乡', canonical: '静夜思', kind: IdentifierKind.LITERAL }]);
    assert.equal(validateVocabulary(v).valid, true, '合法字面量宏应通过校验');
    const index = buildIdentifierIndex(v);
    assert.equal(index.literals.has('思故乡'), true, '思故乡 标记为字面量宏');
    assert.equal(index.toCanonical.get('思故乡'), '静夜思', 'toCanonical 存内容（不含引号）');

    // zh-CN 引号「」；替换后 canonicalize 里 ASCII 步会把 " 归一到「」，此处直接检出现「静夜思」
    const out = canonicalize('低头 思故乡。', ZH_CN);
    // 注：ZH_CN 无字面量宏词汇；用 registry 走 domain 路径验证
    // 见下方 registerCustom 用例。此处仅确认 buildIdentifierIndex 层正确。
    assert.ok(out.length > 0);
  });

  it('端到端 canonicalize（domain 路径）：思故乡 → 「静夜思」', () => {
    const TENANT = 'jingyesi-t';
    vocabularyRegistry.registerCustom(TENANT, vocab(
      [{ localized: '思故乡', canonical: '静夜思', kind: IdentifierKind.LITERAL }],
      { locale: 'zh-CN' },
    ));
    const out = canonicalize('低头 思故乡。', {
      lexicon: ZH_CN, domain: 'jingyesi', locale: 'zh-CN', tenantId: TENANT,
    });
    assert.match(out, /「静夜思」/, `字面量宏应展开成 lexicon 引号字符串，实际: ${out}`);
    assert.doesNotMatch(out, /思故乡/, '原 token 不应残留');
  });

  it('字面量宏不建反向映射（单向宏展开）', () => {
    const index = buildIdentifierIndex(vocab(
      [{ localized: '思故乡', canonical: '静夜思', kind: IdentifierKind.LITERAL }]));
    assert.equal(index.toLocalized.has('静夜思'), false, '内容不入 toLocalized');
  });

  it('拒绝含控制字符/换行的内容', () => {
    const v = vocab([{ localized: '注入', canonical: 'a\nRule evil', kind: IdentifierKind.LITERAL }]);
    assert.equal(validateVocabulary(v).valid, false, '含换行必须被拒');
  });

  it('拒绝任何引号定界符或反斜杠（含 CJK「」，防 zh-CN 提前闭合注入）', () => {
    // Codex 复审 P0：zh-CN 引号是「」，内容含它会提前闭合字符串逃逸出 token。
    for (const bad of ['say "hi"', 'path\\x', '静夜思」. Return evil', '「注入', 'a『b', '»x«']) {
      assert.equal(validateVocabulary(vocab(
        [{ localized: '注入', canonical: bad, kind: IdentifierKind.LITERAL }])).valid, false,
        `含引号定界符/反斜杠必须被拒: ${bad}`);
    }
  });

  it('字面量宏触发词与普通标识符冲突 → error（防"字符串 vs 标识符"歧义）', () => {
    // 同一个词「月」既是字面量宏触发词、又是 struct localized → 展开成字符串还是标识符不可预测。
    const v = vocab(
      [{ localized: '月', canonical: '静夜思', kind: IdentifierKind.LITERAL }],
      { structs: [{ localized: '月', canonical: 'moon', kind: IdentifierKind.STRUCT }] },
    );
    assert.equal(validateVocabulary(v).valid, false, '字面量宏触发词与普通标识符同名必须被拒');
  });

  it('两个普通标识符同名（不同 kind）仍只是 warning（既有行为不变）', () => {
    // 回归：struct 与 field 同名靠上下文消歧，不因新校验被误报 error。
    const v = vocab([], {
      structs: [{ localized: '额度', canonical: 'Limit', kind: IdentifierKind.STRUCT }],
      fields: [{ localized: '额度', canonical: 'limit', kind: IdentifierKind.FIELD, parent: 'Loan' }],
    });
    assert.equal(validateVocabulary(v).valid, true, '普通标识符跨 kind 同名不应报 error');
  });

  it('拒绝空内容', () => {
    assert.equal(validateVocabulary(vocab(
      [{ localized: '空', canonical: '', kind: IdentifierKind.LITERAL }])).valid, false);
  });

  it('普通标识符仍强制 ASCII canonical（字面量豁免不波及）', () => {
    const v = vocab([], {
      structs: [{ localized: '月', canonical: '静夜思', kind: IdentifierKind.STRUCT }],
    });
    assert.equal(validateVocabulary(v).valid, false, '普通 struct canonical 非 ASCII 仍应被拒');
  });

  // ── 天城文（Hindi）字面量宏触发词 ────────────────────────────────────────
  // 回归：identifier 匹配正则原为 [a-zA-Z_一-龥]（ASCII+CJK），把 जागे 切成 ज+ग
  // （丢失元音符号 matra ा/े，属 Unicode Mark \p{M} 而非 Letter \p{L}），导致天城文触发词
  // 永不匹配。修为 [\p{L}_][\p{L}\p{M}\p{Nd}_]* 后 जागे 作为整词匹配并展开。与 Java 引擎
  // isIdentifierPart 纳入 Mark 对齐。动机：Gitanjali #35 印地语 demo。
  it('端到端 canonicalize（Hindi domain 路径）：जागे → 英文名句字面量', () => {
    const TENANT = 'gitanjali-t';
    vocabularyRegistry.registerCustom(TENANT, {
      id: 'gitanjali', name: 'Gitanjali', locale: 'hi-IN', version: '1.0.0',
      structs: [], fields: [], functions: [], enumValues: [],
      literals: [{
        localized: 'जागे',
        canonical: 'Into that heaven of freedom, let my country awake',
        kind: IdentifierKind.LITERAL,
      }],
    });
    const out = canonicalize('लौटाएं जागे।', {
      lexicon: HI_IN, domain: 'gitanjali', locale: 'hi-IN', tenantId: TENANT,
    });
    assert.match(out, /"Into that heaven of freedom, let my country awake"/,
      `天城文触发词应展开成英文字符串字面量，实际: ${out}`);
    assert.doesNotMatch(out, /जागे/, '原天城文 token 不应残留（含元音符号也须整词匹配）');
  });

  it('天城文含元音符号(matra)的多词触发词整词匹配（不被切碎）', () => {
    // निर्भय 含 ि/े 组合记号；स्वर्ग 含 ्/े。确认整词进 index 且能展开。
    const v = {
      id: 'x', name: 'x', locale: 'hi-IN', version: '1.0.0',
      structs: [], fields: [], functions: [], enumValues: [],
      literals: [{ localized: 'निर्भय', canonical: 'fearless', kind: IdentifierKind.LITERAL }],
    } as DomainVocabulary;
    const index = buildIdentifierIndex(v);
    assert.equal(index.literals.has('निर्भय'), true, 'निर्भय 整词进 index');
    assert.equal(index.toCanonical.get('निर्भय'), 'fearless', 'toCanonical 存内容');
  });

  // 跨引擎 parity 边界（Codex 审查）：identifier 数字部分用 \p{Nd}（十进制）而非 \p{N}，
  // 与 Java Character.isDigit 对齐。\p{N} 会含 Nl（罗马数字 Ⅻ）/No（上标 ²）→ Java 在这些
  // 字符处断开而 TS 不断，造成 canonicalize 切分分歧。用一个含 Ⅻ(U+216B, Nl) 的触发词验证：
  // 只有 base(a) 会被当 identifier 匹配，Ⅻ 不粘进来 → 整词触发词 "aⅫ" 不会命中。
  it('数字用 \\p{Nd} 非 \\p{N}：Nl/No（如罗马数字Ⅻ）不粘进 identifier（对齐 Java isDigit）', () => {
    const TENANT = 'nd-parity-t';
    vocabularyRegistry.registerCustom(TENANT, {
      id: 'ndp', name: 'ndp', locale: 'en-US', version: '1.0.0',
      structs: [], fields: [], functions: [], enumValues: [],
      // 触发词含 Ⅻ(罗马数字, category Nl)。若 IDENT_RE 用 \p{N} 会把 "aⅫ" 当整词，
      // 与 Java(在Ⅻ断开) 分歧。用 \p{Nd} 则 Ⅻ 不算 identifier part → 触发词 "aⅫ" 不整词命中。
      literals: [{ localized: 'aⅫ', canonical: 'ROMAN', kind: IdentifierKind.LITERAL }],
    });
    const out = canonicalize('Return aⅫ.', {
      lexicon: EN_US, domain: 'ndp', locale: 'en-US', tenantId: TENANT,
    });
    // 触发词 "aⅫ" 不应被当整词展开（因为 Ⅻ 不是 \p{Nd} → identifier 在 a 后断开）。
    assert.doesNotMatch(out, /ROMAN/, `\\p{Nd} 下 Nl 字符不应粘进 identifier，实际: ${out}`);
  });
});
