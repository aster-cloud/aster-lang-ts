/**
 * `./layout` 的格式与序列化（ADR 0058 §7.3），以及迁入的《静夜思》LayoutMap 不变式
 * （原 examples/jingyesi/layout-map.test.mjs）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile, evaluate } from '../../../src/browser.js';
import { initializeAllBundledLexicons } from '../../../src/config/lexicons/index.js';
import { vocabularyRegistry, initBuiltinVocabularies } from '../../../src/config/lexicons/identifiers/registry.js';
import { IdentifierKind } from '../../../src/config/lexicons/identifiers/types.js';
import type { Core } from '../../../src/types.js';
import {
  LayoutError,
  parseLayout,
  serializeLayout,
  toCanonical,
  toDisplay,
  verifyContentParity,
} from '../../../src/layout/index.js';
import type { LayoutSpan, PolicyLayout } from '../../../src/layout/index.js';
import { JINGYESI_LAYOUT, JINGYESI_LEX, asterSource } from './fixtures.js';

describe('《静夜思》LayoutMap（迁入）', () => {
  const asterFile = asterSource('examples/jingyesi/jingyesi.aster');

  it('① toCanonical === jingyesi.aster（忽略尾随换行）', () => {
    assert.equal(toCanonical(JINGYESI_LAYOUT), asterFile);
  });

  it('② display 是李白原诗工整四句 + 内容一致', () => {
    const display = toDisplay(JINGYESI_LAYOUT);
    assert.equal(display, '床前 明月光，\n疑是 地上霜。\n举头 望明月，\n低头 思故乡。');
    assert.equal(display.split('\n').length, 4);
    assert.equal(verifyContentParity(JINGYESI_LAYOUT).ok, true);
  });

  it('③ 编译走 canonical → 模块「明月光」·函数「地上霜」，运行输出「静夜思」', () => {
    initializeAllBundledLexicons();
    initBuiltinVocabularies();
    vocabularyRegistry.registerCustom('jingyesi', {
      id: 'jingyesi', name: '静夜思', locale: 'jingyesi', version: '1.0.0',
      structs: [{ localized: '望明月', canonical: 'Text', kind: IdentifierKind.STRUCT }], fields: [], functions: [], enumValues: [],
      literals: [{ localized: '思故乡', canonical: '静夜思', kind: IdentifierKind.LITERAL }],
    });
    const compiled = compile(toCanonical(JINGYESI_LAYOUT), { lexicon: JINGYESI_LEX, domain: 'jingyesi', tenantId: 'jingyesi' });
    assert.equal(compiled.success, true, JSON.stringify(compiled.parseErrors));
    assert.ok(compiled.core);
    assert.equal(compiled.core.name, '明月光');
    const rule = (compiled.core.decls[0] as Core.Func).name;
    assert.equal(rule, '地上霜');
    const result = evaluate(compiled.core, rule, {});
    assert.equal(result.success, true);
    assert.equal(result.value, '静夜思');
  });

  it('④ 反例：结构 span 的 canonical 偷塞字符串字面量 → verifyContentParity 拒绝', () => {
    const bad: PolicyLayout = {
      v: 1,
      spans: [{ text: '床前 明月光' }, { canonical: '。\n返回 "偷偷加的".', display: '，\n' }, { text: '疑是 地上霜' }],
    };
    const r = verifyContentParity(bad);
    assert.equal(r.ok, false);
  });
});

describe('serializeLayout（§7.3）', () => {
  it('固定形态：键序固定、无多余空白、JSON.stringify 转义', () => {
    const layout: PolicyLayout = {
      v: 1,
      // 故意打乱结构 span 的键序：输出仍是 canonical 在前
      spans: [{ text: 'a "q"\n' }, { display: '\t', canonical: '：' } as { canonical: string; display: string }],
    };
    assert.equal(serializeLayout(layout), '{"v":1,"spans":[{"text":"a \\"q\\"\\n"},{"canonical":"：","display":"\\t"}]}');
  });

  it('相邻内容 span 合并；结构 span 不合并', () => {
    const layout: PolicyLayout = {
      v: 1,
      spans: [
        { text: '床前' }, { text: ' ' }, { text: '明月光' },
        { canonical: '。', display: '，' }, { canonical: '\n', display: '\n' },
        { text: '疑是' },
      ],
    };
    assert.equal(
      serializeLayout(layout),
      '{"v":1,"spans":[{"text":"床前 明月光"},{"canonical":"。","display":"，"},{"canonical":"\\n","display":"\\n"},{"text":"疑是"}]}',
    );
  });

  it('两次序列化相同（含 parse 往返）；同一排版的不同切分序列化为同一文本', () => {
    const once = serializeLayout(JINGYESI_LAYOUT);
    assert.equal(serializeLayout(JINGYESI_LAYOUT), once);
    assert.equal(serializeLayout(parseLayout(once)), once);
    const split: PolicyLayout = {
      v: 1,
      spans: JINGYESI_LAYOUT.spans.flatMap((s): LayoutSpan[] =>
        'text' in s ? [...s.text].map((ch) => ({ text: ch })) : [s]),
    };
    assert.equal(serializeLayout(split), once);
  });

  it('不合法的 layout 不序列化（抛 layout_invalid_format）', () => {
    assert.throws(
      () => serializeLayout({ v: 1, spans: [] }),
      (e: unknown) => e instanceof LayoutError && e.code === 'layout_invalid_format',
    );
  });
});
