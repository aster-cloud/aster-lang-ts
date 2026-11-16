/**
 * 词角色判定 roleJudge（ADR 0058 §7.5）：重解析失败按值计（宁可多拒），重解析次数有上限。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parseWithLexicon } from '../../../src/parser.js';
import { ROLE_PROBE_BUDGET, roleJudge } from '../../../src/layout/value-tokens.js';

const SOURCE = 'Module m.\n\nRule f given return as Int, produce Int:\n  Return return.\n';
const tokens = lex(canonicalize(SOURCE, EN_US), EN_US).filter((t) => t.channel !== 'trivia');
/** 第二个 `return`（参数引用）：基线 AST 判不了，须重解析 */
const refIndex = tokens.map((t, i) => [t, i] as const).filter(([t]) => t.value === 'return').at(-1)![1];
const seq = { words: ['return'], english: new Set(['return']) };

describe('roleJudge', () => {
  it('参数引用 `return` 基线判不了，重解析认作值', () => {
    const judge = roleJudge(tokens, EN_US);
    assert.equal(judge.settle(refIndex, seq), null);
    assert.equal(judge.probe(refIndex), true);
  });

  it('重解析抛错时按值计（宁可多拒）', () => {
    let calls = 0;
    const parse: typeof parseWithLexicon = (ts, lx) => {
      calls++;
      if (calls > 1) throw new Error('boom');
      return parseWithLexicon(ts, lx);
    };
    const judge = roleJudge(tokens, EN_US, parse);
    assert.equal(judge.probe(refIndex), true);
    assert.equal(calls, 2);
  });

  it(`重解析最多 ${ROLE_PROBE_BUDGET} 次，预算用尽后不再解析、一律按值计`, () => {
    let calls = 0;
    const parse: typeof parseWithLexicon = (ts, lx) => {
      calls++;
      return parseWithLexicon(ts, lx);
    };
    // 首个 `Return` 是关键词：重解析判为关键词（false），用来确认预算内仍在真正解析
    const kwIndex = tokens.findIndex((t) => t.value === 'Return');
    const judge = roleJudge(tokens, EN_US, parse);
    for (let k = 0; k < ROLE_PROBE_BUDGET; k++) assert.equal(judge.probe(kwIndex), false);
    assert.equal(judge.probe(kwIndex), true);
    assert.equal(calls, 1 + ROLE_PROBE_BUDGET);
  });
});
