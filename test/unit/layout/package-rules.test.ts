/**
 * 包格式 1.1 显示排版 L1–L7 与 L9 补空格（ADR 0059 修订 4 §4）：跑 aster-lang-test 共享向量的逐字节副本
 * （shared/layout-vectors/，sha256 钉住；与 aster-lang-core 的副本同一哈希）。期望手写在 aster-lang-test，与实现无关。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LayoutError,
  checkPackageLayout,
  layoutRuleOf,
  padStructuralSpans,
  parseLayout,
  serializeLayout,
  toDisplay,
  validatePolicyLayout,
} from '../../../src/layout/index.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';

const DIR = join(process.cwd(), 'shared/layout-vectors');

/** 四个副本的 sha256：与 aster-lang-test 真相源及 aster-lang-core 副本相同；真相源变化时同步复制并改这里。 */
export const LAYOUT_VECTOR_SHA256: Readonly<Record<string, string>> = {
  'layout.json': 'cc51f78a44f87d3cf0c03543eeeb9d68015fd922923094c0aad76fe64a8aa79b',
  'display-reconstruct.json': '0aedb893caeb81923a895fdecf5c9983314a276a6d966e8801c009840d0d04a1',
  'display-padding.json': '294986f9fafc886bf478d3961233603d5ee9c40ac2f6485c88f550ae5763232f',
  'keyword-spellings.json': '467b1075dd67e2e7249d50ae3b47eb5c1f00a2f1827dcf501016e97ef906fd3f',
};

export function readVector<T>(name: string): T {
  return JSON.parse(readFileSync(join(DIR, name), 'utf8')) as T;
}

interface LayoutCase {
  id: string;
  layoutText: string;
  source?: string;
  displayText?: string;
  sourceB64?: string;
  layoutVersion?: number;
  vocabularyLocalized: string[];
  literalKeywords: string[];
  operatorSpellings: string[];
  expect: string;
  serialized?: string;
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('共享向量副本', () => {
  for (const [name, sha] of Object.entries(LAYOUT_VECTOR_SHA256)) {
    it(`${name} 的 sha256 与真相源相同`, () => {
      assert.equal(createHash('sha256').update(readFileSync(join(DIR, name))).digest('hex'), sha);
    });
  }
});

describe('checkPackageLayout：vectors/layout.json', () => {
  const doc = readVector<{ cases: LayoutCase[] }>('layout.json');
  it('用例数不少于 70', () => assert.ok(doc.cases.length >= 70));
  for (const c of doc.cases) {
    it(`${c.id} → ${c.expect}`, () => {
      let display: string;
      try {
        display = c.displayText ?? toDisplay(JSON.parse(c.layoutText));
      } catch {
        display = '';
      }
      let got = 'ok';
      try {
        const layout = checkPackageLayout({
          layoutBytes: utf8(c.layoutText),
          displayBytes: utf8(display),
          source: c.sourceB64 !== undefined ? new Uint8Array(Buffer.from(c.sourceB64, 'base64')) : c.source!,
          layoutVersion: c.layoutVersion ?? 1,
          vocabularyLocalized: c.vocabularyLocalized,
          literalKeywords: c.literalKeywords,
          operatorSpellings: c.operatorSpellings,
        });
        if (c.serialized !== undefined) assert.equal(serializeLayout(layout), c.serialized);
      } catch (e) {
        if (!(e instanceof LayoutError)) throw e;
        got = layoutRuleOf(e) ?? `无规则号：${e.code}`;
      }
      assert.equal(got, c.expect);
    });
  }
});

describe('规则号 → 稳定错误码', () => {
  it('L4 为 layout_display_mismatch、L7 为 layout_structural_hides_operator', () => {
    const text = '{"v":1,"spans":[{"text":"Return a"},{"canonical":" + ","display":" plus "},{"text":"b."}]}';
    const ctx = { vocabularyLocalized: [], literalKeywords: [], operatorSpellings: ['plus'] };
    const run = (display: string): LayoutError => {
      try {
        checkPackageLayout({ layoutBytes: utf8(text), displayBytes: utf8(display), source: 'Return a + b.', layoutVersion: 1, ...ctx });
      } catch (e) {
        return e as LayoutError;
      }
      throw new Error('应失败');
    };
    assert.equal(run('x').code, 'layout_display_mismatch');
    assert.equal(run('Return a plus b.').code, 'layout_structural_hides_operator');
  });

  it('validatePolicyLayout 不变：不填规则号', () => {
    const layout = parseLayout('{"v":1,"spans":[{"text":"Return 1."}]}');
    assert.deepEqual(validatePolicyLayout(layout, 'Return 2.', EN_US).ok, false);
  });
});

describe('padStructuralSpans：vectors/display-padding.json', () => {
  for (const c of readVector<{ cases: { id: string; layoutText: string; padded: string }[] }>('display-padding.json').cases) {
    it(c.id, () => assert.equal(padStructuralSpans(JSON.parse(c.layoutText)), c.padded));
  }
});
