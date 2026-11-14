/**
 * 逐条运行 aster-lang-locales type-inference/test-vectors.json（ADR 0056 §3.2 共用测试向量）：
 * 给定名字与约束（IR v2 形状，Range 端点是规范十进制串），推断类型须等于 expected。
 * aster-lang-core TypeInferenceVectorsTest 跑同一份向量。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inferFieldType } from '../../../src/parser/type-inference.js';
import type { Constraint } from '../../../src/types.js';
import { locateLocalesTypeInference } from '../../helpers/locales-type-inference.js';

interface Vector {
  readonly name: string;
  readonly constraints: ReadonlyArray<
    | { readonly kind: 'Required' }
    | { readonly kind: 'Range'; readonly min: string | null; readonly max: string | null }
    | { readonly kind: 'Pattern'; readonly regexp: string }
  >;
  readonly expected: string;
}

const span = { start: { line: 1, col: 1 }, end: { line: 1, col: 1 } };

function toAst(c: Vector['constraints'][number]): Constraint {
  switch (c.kind) {
    case 'Required':
      return { kind: 'Required', span };
    case 'Pattern':
      return { kind: 'Pattern', regexp: c.regexp, span };
    case 'Range':
      return {
        kind: 'Range',
        ...(c.min === null ? {} : { min: Number(c.min), minRaw: c.min }),
        ...(c.max === null ? {} : { max: Number(c.max), maxRaw: c.max }),
        span,
      };
  }
}

test('共用测试向量全部一致', (t) => {
  const source = locateLocalesTypeInference('test-vectors.json');
  if (source === undefined) return t.skip('本地未并列 checkout aster-lang-locales');
  const vectors = JSON.parse(readFileSync(source, 'utf8')) as Vector[];
  assert.ok(vectors.length > 0);
  const wrong = vectors.flatMap((v) => {
    const type = inferFieldType(v.name, v.constraints.map(toAst));
    const actual = type.kind === 'TypeName' ? type.name : type.kind;
    return actual === v.expected ? [] : [`${v.name} ${JSON.stringify(v.constraints)}：期望 ${v.expected}，实际 ${actual}`];
  });
  assert.deepEqual(wrong, []);
});
