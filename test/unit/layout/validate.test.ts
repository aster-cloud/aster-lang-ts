/**
 * validatePolicyLayout（ADR 0058 §7.5）：每个错误码一正一反。
 * layout_structural_hides_value：《静夜思》通过、《斑点带子案》因「揪出真凶」被拒。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import { SemanticTokenKind as K } from '../../../src/config/token-kind.js';
import { toCanonical, validatePolicyLayout } from '../../../src/layout/index.js';
import type { LayoutValidation, PolicyLayout } from '../../../src/layout/index.js';
import {
  JINGYESI_ALIASES,
  JINGYESI_LAYOUT,
  JINGYESI_LEX,
  SHERLOCK_ALIASES,
  SHERLOCK_LAYOUT,
  SHERLOCK_LEX,
  asterSource,
} from './fixtures.js';

function failure(r: LayoutValidation): Exclude<LayoutValidation, { ok: true }> {
  assert.equal(r.ok, false, '应校验失败');
  return r as Exclude<LayoutValidation, { ok: true }>;
}

/** 由 spans 构造 layout，并以其 canonical 作为 source 校验 */
function check(spans: PolicyLayout['spans'], lexicon = EN_US, aliasSet?: Record<string, string[]>): LayoutValidation {
  const layout: PolicyLayout = { v: 1, spans };
  return validatePolicyLayout(layout, toCanonical(layout), lexicon, aliasSet);
}

describe('示例', () => {
  it('《静夜思》通过全部规则（词法表带别名，或以 aliasSet 冻结别名）', () => {
    const source = asterSource('examples/jingyesi/jingyesi.aster');
    assert.deepEqual(validatePolicyLayout(JINGYESI_LAYOUT, source, JINGYESI_LEX), { ok: true });
    assert.deepEqual(validatePolicyLayout(JINGYESI_LAYOUT, source, ZH_CN, JINGYESI_ALIASES), { ok: true });
  });

  it('《斑点带子案》因结构 span 里的函数名「揪出真凶」被拒（layout_structural_hides_value）', () => {
    const source = asterSource('examples/sherlock/sherlock.aster');
    for (const r of [
      validatePolicyLayout(SHERLOCK_LAYOUT, source, SHERLOCK_LEX),
      validatePolicyLayout(SHERLOCK_LAYOUT, source, ZH_CN, SHERLOCK_ALIASES),
    ]) {
      const f = failure(r);
      assert.equal(f.code, 'layout_structural_hides_value');
      assert.equal(f.offset, source.indexOf('揪出真凶'));
    }
  });
});

describe('layout_invalid_format', () => {
  it('反：结构不合 §7.3 → 拒绝', () => {
    const bad = { v: 1, spans: [{ text: 'x', extra: 1 }] } as unknown as PolicyLayout;
    assert.equal(failure(validatePolicyLayout(bad, 'x', EN_US)).code, 'layout_invalid_format');
    assert.equal(failure(validatePolicyLayout({ v: 1, spans: [] }, '', EN_US)).code, 'layout_invalid_format');
    assert.equal(
      failure(validatePolicyLayout({ v: 1, spans: [{ text: 'x' }, { canonical: '', display: 'y' }] }, 'x', EN_US)).code,
      'layout_invalid_format',
    );
  });
  it('正：合法结构通过', () => {
    assert.deepEqual(check([{ text: 'Return x' }, { canonical: '.', display: '' }]), { ok: true });
  });
});

describe('layout_too_large', () => {
  it('反：源码超过 sourceBytes → 拒绝，并报出是哪个上限', () => {
    const f = failure(check([{ text: 'x'.repeat(12289) }]));
    assert.equal(f.code, 'layout_too_large');
    assert.equal(f.limit, 'sourceBytes');
  });
  it('正：上限内通过', () => {
    assert.deepEqual(check([{ text: 'x'.repeat(12288) }]), { ok: true });
  });
});

describe('layout_roundtrip_mismatch', () => {
  it('反：toCanonical(layout) !== source → 拒绝并报第一个不一致的偏移', () => {
    const layout: PolicyLayout = { v: 1, spans: [{ text: 'Return x' }, { canonical: '.', display: '' }] };
    const f = failure(validatePolicyLayout(layout, 'Return y.', EN_US));
    assert.equal(f.code, 'layout_roundtrip_mismatch');
    assert.equal(f.offset, 7);
    // 前缀关系：偏移为较短者的长度
    assert.equal(failure(validatePolicyLayout(layout, 'Return x.\n', EN_US)).offset, 9);
    assert.equal(failure(validatePolicyLayout(layout, 'Return x', EN_US)).offset, 8);
  });
  it('正：逐字节一致通过', () => {
    const layout: PolicyLayout = { v: 1, spans: [{ text: 'Return x' }, { canonical: '.', display: '' }] };
    assert.deepEqual(validatePolicyLayout(layout, 'Return x.', EN_US), { ok: true });
  });
});

describe('layout_structural_hides_value', () => {
  const hides = (r: LayoutValidation): number | undefined => {
    const f = failure(r);
    assert.equal(f.code, 'layout_structural_hides_value');
    return f.offset;
  };

  it('反：标识符、数字、字符串、布尔与结构 span 重叠 → 拒绝（偏移指向值的起点）', () => {
    assert.equal(hides(check([{ text: 'Return ' }, { canonical: 'total', display: '' }, { text: '.' }])), 7);
    assert.equal(hides(check([{ text: 'Return ' }, { canonical: '42', display: '' }, { text: '.' }])), 7);
    assert.equal(hides(check([{ text: 'Return ' }, { canonical: '"secret"', display: '' }, { text: '.' }])), 7);
    assert.equal(hides(check([{ text: 'Return ' }, { canonical: 'true', display: '' }, { text: '.' }])), 7);
    // 只盖住值的一部分也算重叠
    assert.equal(hides(check([{ text: 'Return to' }, { canonical: 'tal', display: '' }, { text: '.' }])), 7);
  });

  it('反：zh 字符串字面量（源码用直引号，规范化后为「」）与结构 span 重叠', () => {
    const r = check(
      [{ text: '如果 甲 那么 返回 ' }, { canonical: '"乙"', display: '' }, { text: '。' }],
      ZH_CN,
    );
    assert.equal(hides(r), '如果 甲 那么 返回 '.length);
  });

  it('反：别名未冻结时，别名词只是普通标识符 → 拒绝；冻结进 aliasSet 后通过', () => {
    const spans: PolicyLayout['spans'] = [{ canonical: '探案笔记 ', display: '《' }, { text: '斑点带子案' }, { canonical: '。', display: '》' }];
    assert.equal(hides(check(spans, ZH_CN)), 0);
    assert.deepEqual(check(spans, ZH_CN, { [K.MODULE_DECL]: ['探案笔记'] }), { ok: true });
  });

  it('反：值与冠词同形（`Return a a plus 1.` 的首个 a 是冠词）时，结构 span 盖住真正的值 → 拒绝', () => {
    const head = 'Module m.\n\nRule f given a as Int, produce Int:\n';
    const r = check([{ text: head + '  Return a ' }, { canonical: 'a', display: '2' }, { text: ' plus 1.\n' }]);
    assert.equal(hides(r), head.length);
  });

  it('反：值与冠词同形且紧贴句号（`Return a a.`）时，结构 span 盖住真正的值 → 拒绝', () => {
    const head = 'Module m.\n\nRule f given a: Int, produce Int:\n';
    const r = check([{ text: head + '  Return a ' }, { canonical: 'a', display: '' }, { text: '.\n' }]);
    assert.equal(hides(r), head.length);
  });

  it('反：值与关键词同形（参数名 `return`，`Return return.` 的第二个是参数引用）→ 按解析器角色认作值并拒绝', () => {
    const head = 'Module m.\n\nRule f given return as Int, produce Int:\n';
    const r = check([{ text: head + '  Return ' }, { canonical: 'return', display: '' }, { text: '.\n' }]);
    assert.equal(hides(r), head.length);
  });

  it('反：zh 源码里与英文规范关键词同形的参数名（`返回 return。`）→ 拒绝', () => {
    const head = '模块 m。\n\n规则 f 给定 return 作为 整数 产出 整数：\n';
    const r = check([{ text: head + '  返回 ' }, { canonical: 'return', display: '' }, { text: '。\n' }], ZH_CN);
    assert.equal(hides(r), head.length);
  });

  it('反：de 参数名与关键词同形（`gegeben` 在 AST 里被译作 given）→ 拒绝', () => {
    const head = 'Modul m.\n\nRegel f gegeben gegeben als Ganzzahl, liefert Ganzzahl:\n';
    const r = check([{ text: head + '  Gib zurück ' }, { canonical: 'gegeben', display: '' }, { text: '.\n' }], DE_DE);
    assert.equal(hides(r), head.length);
  });

  it('反：含连字符的字符串字面量与结构 span 重叠 → 拒绝（找回原文位置时不抛正则错误）', () => {
    assert.equal(hides(check([{ text: 'Return ' }, { canonical: '"truck-driver"', display: '' }, { text: '.' }])), 7);
  });

  it('正：运算符关键词（AST 里是 Name 节点 `and`）仍是关键词，可以在结构 span 里', () => {
    const head = 'Module m.\n\nRule f given x as Bool, y as Bool, produce Bool:\n  Return x';
    assert.deepEqual(check([{ text: head }, { canonical: ' and ', display: ' && ' }, { text: 'y.\n' }]), { ok: true });
  });

  it('正：关键词（含多词关键词）、标点、空白、注释可以在结构 span 里', () => {
    assert.deepEqual(
      check([
        { canonical: 'Rule ', display: '' }, { text: 'f' }, { canonical: ' given ', display: '(' }, { text: 'x' },
        { canonical: ', produce:\n  ', display: '): ' },
        { canonical: 'If ', display: 'when ' }, { text: 'x' }, { canonical: ' greater than ', display: ' > ' }, { text: '1' },
        { canonical: ' then ', display: ' → ' }, { text: 'Return x' }, { canonical: '.\n  // note\n  ', display: '; ' },
        { text: 'Return 0' }, { canonical: '.', display: '' },
      ]),
      { ok: true },
    );
  });

  it('正：zh 全角标点与换行缩进在结构 span 里', () => {
    assert.deepEqual(
      check([{ text: '如果 甲 那么 返回 「乙」' }, { canonical: '。\n', display: '' }, { text: '返回 「丙」' }, { canonical: '。', display: '' }], ZH_CN),
      { ok: true },
    );
  });
});

describe('layout_content_parity', () => {
  it('反：没有非空内容 span → 拒绝', () => {
    const f = failure(check([{ canonical: 'Return', display: '' }, { text: ' ' }, { canonical: '.', display: '' }]));
    assert.equal(f.code, 'layout_content_parity');
  });
  it('反：结构 span 的 canonical 含引号（注释里，不构成值 token）→ 拒绝', () => {
    const f = failure(check([{ text: 'Return x.' }, { canonical: '\n// "x"', display: '' }]));
    assert.equal(f.code, 'layout_content_parity');
  });
  it('正：有非空内容 span、结构 span 不含引号', () => {
    assert.deepEqual(check([{ text: 'Return x.' }, { canonical: '\n// note', display: '' }]), { ok: true });
  });
});
