/**
 * 反向映射（ADR 0059 修订 4 D7）：vectors/display-reconstruct.json 的用例与三个性能配方（各须 2 s 内给出结论）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reconstructFromDisplay, toCanonical, type LayoutSpan, type PolicyLayout } from '../../../src/layout/index.js';

interface Doc {
  cases: { id: string; layoutText: string; edited: string; expect: string; canonical?: string }[];
  performance: {
    id: string;
    unit: LayoutSpan[];
    units: number;
    editUnit: string;
    editRepeat: number;
    editTail: string;
    expect: string;
    canonicalUnit?: string;
  }[];
}

const doc = JSON.parse(readFileSync(join(process.cwd(), 'shared/layout-vectors/display-reconstruct.json'), 'utf8')) as Doc;

describe('reconstructFromDisplay：用例', () => {
  for (const c of doc.cases) {
    it(`${c.id} → ${c.expect}`, () => {
      const r = reconstructFromDisplay(JSON.parse(c.layoutText) as PolicyLayout, c.edited);
      assert.equal(r.kind, c.expect);
      if (r.kind === 'unique') assert.equal(toCanonical(r.layout), c.canonical);
    });
  }
  it('CRLF 全文：unmappable 且带 crlf 提示', () => {
    const c = doc.cases.find((x) => x.id === 'jingyesi-crlf')!;
    const r = reconstructFromDisplay(JSON.parse(c.layoutText) as PolicyLayout, c.edited);
    assert.ok(r.kind === 'unmappable' && r.crlf);
  });
});

describe('reconstructFromDisplay：性能配方', () => {
  for (const p of doc.performance) {
    it(`${p.id} 2 s 内得 ${p.expect}`, () => {
      const layout: PolicyLayout = { v: 1, spans: Array.from({ length: p.units }, () => p.unit).flat() };
      const edited = p.editUnit.repeat(p.editRepeat) + p.editTail;
      const t0 = performance.now();
      const r = reconstructFromDisplay(layout, edited);
      const ms = performance.now() - t0;
      assert.equal(r.kind, p.expect);
      if (r.kind === 'unique' && p.canonicalUnit !== undefined) assert.equal(toCanonical(r.layout), p.canonicalUnit.repeat(p.units));
      assert.ok(ms < 2000, `用时 ${ms.toFixed(0)} ms`);
    });
  }
});
