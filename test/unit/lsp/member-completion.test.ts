/**
 * 成员补全（member-completion.ts）的函数级测试：
 *   - 光标在已有成员名中间（`d.ag|e`）时，替换范围须覆盖名字后半截（#259）；
 *   - 修补文本推断有缓存、有规模上限（#258）：同一修补文本不重复解析，输入前缀时复用，
 *     超过行数上限的文档不再做修补解析。
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import {
  MEMBER_REPAIR_MAX_LINES,
  clearMemberRepairCache,
  memberCompletions,
} from '../../../src/lsp/member-completion.js';
import type { MemberDocument } from '../../../src/lsp/member-completion.js';
import { parseDocumentText, parseDocumentWith } from '../../../src/lsp/parse-document.js';

const HEAD = ['Module demo.p.', '', 'Define Driver has name as Text, age as Int.', '', 'Rule f given d as Driver, produce Int:'];

function docOf(lines: readonly string[]): MemberDocument {
  const text = lines.join('\n');
  return { text, ...parseDocumentText(text, EN_US, undefined, undefined) };
}

/** 统计修补文本解析次数的 parse */
function countingParse(): { parse: typeof parseDocumentWith; count: () => number } {
  let n = 0;
  return {
    parse: (text, lexicon, vocabulary) => {
      n += 1;
      return parseDocumentWith(text, lexicon, vocabulary);
    },
    count: () => n,
  };
}

const labels = (items: { label: string }[] | null) => (items ?? []).map((i) => i.label).sort();

beforeEach(() => clearMemberRepairCache());

describe('#259 光标在成员名中间', () => {
  const body = '  Return d.age.';
  const dot = '  Return d.'.length;
  const cursor = { line: 5, character: dot + 2 }; // d.ag|e

  it('客户端支持 InsertReplaceEdit：insert = 点号后到光标，replace = 点号后到名字末尾', () => {
    const items = memberCompletions(docOf([...HEAD, body, '']), cursor, EN_US, { insertReplace: true });
    assert.deepEqual(labels(items), ['age', 'name']);
    for (const i of items!) {
      assert.deepEqual(i.textEdit, {
        insert: { start: { line: 5, character: dot }, end: cursor },
        replace: { start: { line: 5, character: dot }, end: { line: 5, character: dot + 3 } },
        newText: i.label,
      });
    }
  });

  it('客户端不支持 InsertReplaceEdit：TextEdit 覆盖整个名字（选 age 得到 age，而非 agee）', () => {
    const items = memberCompletions(docOf([...HEAD, body, '']), cursor, EN_US);
    for (const i of items!) {
      assert.deepEqual(i.textEdit, { range: { start: { line: 5, character: dot }, end: { line: 5, character: dot + 3 } }, newText: i.label });
    }
  });

  it('光标在名字末尾：仍是普通 TextEdit（insert 与 replace 相同，无需 InsertReplaceEdit）', () => {
    const at = { line: 5, character: dot + 3 };
    const items = memberCompletions(docOf([...HEAD, body, '']), at, EN_US, { insertReplace: true });
    for (const i of items!) {
      assert.deepEqual(i.textEdit, { range: { start: { line: 5, character: dot }, end: at }, newText: i.label });
    }
  });
});

describe('#258 修补推断的缓存与规模上限', () => {
  // `If d.` 让当前行与所在声明语法不完整：原文推断失败，须走修补文本
  const broken = (prefix: string) => [...HEAD, `  If d.${prefix} plus 1`, '  Return 1.', ''];
  const at = (prefix: string) => ({ line: 5, character: `  If d.${prefix}`.length });

  it('同一文档版本再次请求：不重复解析修补文本', () => {
    const doc = docOf(broken(''));
    const first = countingParse();
    assert.deepEqual(labels(memberCompletions(doc, at(''), EN_US, { parse: first.parse })), ['age', 'name']);
    assert.ok(first.count() > 0, '首次请求应解析修补文本');
    const again = countingParse();
    assert.deepEqual(labels(memberCompletions(doc, at(''), EN_US, { parse: again.parse })), ['age', 'name']);
    assert.equal(again.count(), 0);
  });

  it('继续输入成员前缀（新版本 d.a → d.ag）：修补文本相同，复用缓存', () => {
    memberCompletions(docOf(broken('')), at(''), EN_US);
    for (const prefix of ['a', 'ag']) {
      const probe = countingParse();
      assert.deepEqual(labels(memberCompletions(docOf(broken(prefix)), at(prefix), EN_US, { parse: probe.parse })), ['age', 'name'], prefix);
      assert.equal(probe.count(), 0, prefix);
    }
  });

  it('文档其它位置改变后缓存不误用：重新解析', () => {
    memberCompletions(docOf(broken('')), at(''), EN_US);
    const changed = [...HEAD.slice(0, 2), 'Define Driver has name as Text, age as Int, level as Int.', ...HEAD.slice(3), '  If d. plus 1', '  Return 1.', ''];
    const probe = countingParse();
    assert.deepEqual(labels(memberCompletions(docOf(changed), at(''), EN_US, { parse: probe.parse })), ['age', 'level', 'name']);
    assert.ok(probe.count() > 0);
  });

  it(`超过 ${MEMBER_REPAIR_MAX_LINES} 行的文档不做修补解析：只用原文推断，返回 null 回到普通补全`, () => {
    const filler = Array.from({ length: MEMBER_REPAIR_MAX_LINES }, () => '');
    const lines = [...HEAD.slice(0, 4), ...filler, HEAD[4]!, '  If d. plus 1', '  Return 1.', ''];
    const probe = countingParse();
    const items = memberCompletions(docOf(lines), { line: lines.length - 3, character: '  If d.'.length }, EN_US, { parse: probe.parse });
    assert.equal(items, null);
    assert.equal(probe.count(), 0);
  });

  it('超过上限但原文可推断（`Return d.` 本身是完整语句）：照常给字段，且不做修补解析', () => {
    const filler = Array.from({ length: MEMBER_REPAIR_MAX_LINES }, () => '');
    const lines = [...HEAD.slice(0, 4), ...filler, HEAD[4]!, '  Return d.', ''];
    const probe = countingParse();
    const items = memberCompletions(docOf(lines), { line: lines.length - 2, character: '  Return d.'.length }, EN_US, { parse: probe.parse });
    assert.deepEqual(labels(items), ['age', 'name']);
    assert.equal(probe.count(), 0);
  });
});
