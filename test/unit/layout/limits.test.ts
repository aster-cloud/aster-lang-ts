/**
 * LAYOUT_LIMITS（ADR 0058 §7.6）：每个上限等于上限通过、加一失败（layout_too_large + limit 名）。
 * 字节一律按 UTF-8 计；单个结构 span 的 display 按字符（Unicode 码点）计。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { LAYOUT_LIMITS, serializeLayout, toCanonical, toDisplay, validatePolicyLayout } from '../../../src/layout/index.js';
import type { LayoutSpan, PolicyLayout } from '../../../src/layout/index.js';

type Limit = keyof typeof LAYOUT_LIMITS;

function utf8(s: string): number {
  return new TextEncoder().encode(s).length;
}

function validate(spans: LayoutSpan[]) {
  const layout: PolicyLayout = { v: 1, spans };
  return validatePolicyLayout(layout, toCanonical(layout), EN_US);
}

function passes(spans: LayoutSpan[]): void {
  assert.deepEqual(validate(spans), { ok: true });
}

function exceeds(spans: LayoutSpan[], limit: Limit): void {
  const r = validate(spans);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, 'layout_too_large');
    assert.equal(r.limit, limit);
  }
}

describe('LAYOUT_LIMITS', () => {
  it('取值与 ADR §7.6 一致', () => {
    assert.deepEqual(LAYOUT_LIMITS, {
      sourceBytes: 12288,
      sourceLines: 200,
      spans: 400,
      serializedBytes: 49152,
      displayBytes: 24576,
      structuralDisplayChars: 256,
    });
  });
});

describe('sourceBytes（UTF-8）', () => {
  it('ASCII：12288 字节通过，12289 失败', () => {
    passes([{ text: 'x'.repeat(12288) }]);
    exceeds([{ text: 'x'.repeat(12289) }], 'sourceBytes');
  });
  it('多字节：4096 个「中」= 12288 字节通过，再加一字节失败', () => {
    passes([{ text: '中'.repeat(4096) }]);
    exceeds([{ text: '中'.repeat(4096) + 'x' }], 'sourceBytes');
  });
});

describe('sourceLines', () => {
  it('200 行通过（末尾换行不另计一行），201 行失败', () => {
    passes([{ text: 'x\n'.repeat(199) + 'x' }]);
    passes([{ text: 'x\n'.repeat(200) }]);
    exceeds([{ text: 'x\n'.repeat(200) + 'x' }], 'sourceLines');
    exceeds([{ text: 'x\r\n'.repeat(201) }], 'sourceLines');
  });
});

describe('spans（相邻内容 span 合并后计数）', () => {
  const alternating = (n: number): LayoutSpan[] =>
    Array.from({ length: n }, (_, i) => (i % 2 === 0 ? { text: 'x' } : { canonical: ' ', display: ' ' }));
  it('400 个通过，401 个失败', () => {
    passes(alternating(400));
    exceeds(alternating(401), 'spans');
  });
  it('可合并的相邻内容 span 不重复计数', () => {
    passes([...alternating(400), { text: 'y' }, { text: 'z' }].slice(1));
  });
});

describe('serializedBytes（序列化文本的 UTF-8 字节）', () => {
  /**
   * 构造序列化后恰为 target 字节的 layout：display 用控制字符（JSON 转义为 6 字节、UTF-8 仅 1 字节）
   * 撑大序列化体积而不触碰 display 上限，余数用 canonical 里的空格（各 1 字节）补齐。
   */
  function sized(target: number): LayoutSpan[] {
    const spans: LayoutSpan[] = [{ text: 'x' }];
    const size = () => utf8(serializeLayout({ v: 1, spans }));
    const max = LAYOUT_LIMITS.structuralDisplayChars;
    for (;;) {
      const last = { canonical: ' ', display: '' };
      spans.push(last);
      const room = target - size();
      if (room < 0) throw new Error('构造越界');
      const ctrl = Math.min(max, Math.floor(room / 6));
      last.display = '\u0001'.repeat(ctrl);
      if (ctrl < max) {
        last.canonical += ' '.repeat(room - 6 * ctrl);
        return spans;
      }
    }
  }
  it('49152 字节通过，49153 字节失败', () => {
    const at = sized(LAYOUT_LIMITS.serializedBytes);
    assert.equal(utf8(serializeLayout({ v: 1, spans: at })), LAYOUT_LIMITS.serializedBytes);
    passes(at);
    const over = sized(LAYOUT_LIMITS.serializedBytes + 1);
    assert.equal(utf8(serializeLayout({ v: 1, spans: over })), LAYOUT_LIMITS.serializedBytes + 1);
    exceeds(over, 'serializedBytes');
  });
});

describe('displayBytes（toDisplay 的 UTF-8 字节）', () => {
  function sized(target: number): LayoutSpan[] {
    const spans: LayoutSpan[] = [{ text: 'x' }];
    let left = target - 1;
    while (left > 0) {
      const n = Math.min(LAYOUT_LIMITS.structuralDisplayChars, left);
      spans.push({ canonical: ' ', display: 'y'.repeat(n) });
      left -= n;
    }
    return spans;
  }
  it('24576 字节通过，24577 字节失败', () => {
    const at = sized(LAYOUT_LIMITS.displayBytes);
    assert.equal(utf8(toDisplay({ v: 1, spans: at })), LAYOUT_LIMITS.displayBytes);
    passes(at);
    exceeds(sized(LAYOUT_LIMITS.displayBytes + 1), 'displayBytes');
  });
});

describe('structuralDisplayChars（按码点计）', () => {
  it('256 个字符通过（含代理对，UTF-16 长 512），257 个失败', () => {
    passes([{ text: 'x' }, { canonical: ' ', display: '😀'.repeat(256) }]);
    exceeds([{ text: 'x' }, { canonical: ' ', display: '😀'.repeat(257) }], 'structuralDisplayChars');
  });
});
