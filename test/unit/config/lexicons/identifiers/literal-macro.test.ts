import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIdentifierIndex,
  validateVocabulary,
  IdentifierKind,
} from '../../../../../src/config/lexicons/identifiers/index.js';
import type { DomainVocabulary, IdentifierMapping } from '../../../../../src/config/lexicons/identifiers/index.js';
import { canonicalize } from '../../../../../src/frontend/canonicalizer.js';
import { ZH_CN, initializeAllBundledLexicons } from '../../../../../src/browser.js';
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
});
