/**
 * 成员补全（member-completion.ts）的函数级测试：
 *   - 光标在已有成员名中间（`d.ag|e`）时，替换范围须覆盖名字后半截（#259）；
 *   - 修补文本推断有缓存、有规模上限（#258）：同一修补文本不重复解析，输入前缀时复用，
 *     修补推断有累计耗时预算，超出后放弃其余修补；大文档未写完的行照常补全。
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import {
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

  /** 返回一个每次调用前进 step 毫秒的假时钟 */
  const ticking = (step: number) => {
    let t = 0;
    return () => (t += step);
  };

  it('★大文档（约 5000 行）当前行未写完：照常给字段（不再按行数放弃）', () => {
    const rules = Array.from({ length: 600 }, (_, i) => [`Rule g${i} given d as Driver, produce Int:`, '  Return d.age plus 1.', '']).flat();
    const filler = Array.from({ length: 3000 }, () => '');
    const lines = [...HEAD.slice(0, 4), ...rules, ...filler, HEAD[4]!, '  If d. plus 1', '  Return 1.', ''];
    assert.ok(lines.length > 4800);
    const probe = countingParse();
    const items = memberCompletions(docOf(lines), { line: lines.length - 3, character: '  If d.'.length }, EN_US, { parse: probe.parse });
    assert.deepEqual(labels(items), ['age', 'name']);
    assert.ok(probe.count() >= 1 && probe.count() <= 3, `修补解析 ${probe.count()} 次`);
  });

  // zh 行尾 `如果 司机.`：前两份修补（删 `.前缀` / 删前缀）仍不完整，第三份（换成 `返回 司机.`）才定出类型
  const ZH_LINES = ['模块 demo.p。', '', '定义 驾驶员 包含 年龄 作为 整数，姓名 作为 文本。', '', '规则 f 给定 司机 作为 驾驶员，产出 整数：', '  如果 司机.', ''];
  const zhDoc = (): MemberDocument => {
    const text = ZH_LINES.join('\n');
    return { text, ...parseDocumentText(text, ZH_CN, undefined, undefined) };
  };
  const ZH_AT = { line: 5, character: '  如果 司机.'.length };

  it('★累计耗时超过预算后放弃其余修补：第一份修补失败即返回 null', () => {
    const probe = countingParse();
    const items = memberCompletions(zhDoc(), ZH_AT, ZH_CN, { parse: probe.parse, now: ticking(1000), repairBudgetMs: 150, repairBudgetFromLines: 0 });
    assert.equal(items, null);
    assert.equal(probe.count(), 1, '第一份修补总会尝试，之后超预算即停止');
  });

  it('小文档（不足 MEMBER_REPAIR_BUDGET_FROM_LINES 行）不受预算约束：冷启动或高负载下也依次尝试到成功', () => {
    const probe = countingParse();
    const items = memberCompletions(zhDoc(), ZH_AT, ZH_CN, { parse: probe.parse, now: ticking(1000), repairBudgetMs: 150 });
    assert.deepEqual(labels(items), ['姓名', '年龄'].sort());
    assert.equal(probe.count(), 3);
  });

  it('预算未超出时依次尝试，直到某份修补成功', () => {
    const probe = countingParse();
    const items = memberCompletions(zhDoc(), ZH_AT, ZH_CN, { parse: probe.parse, now: ticking(0), repairBudgetMs: 150, repairBudgetFromLines: 0 });
    assert.deepEqual(labels(items), ['姓名', '年龄'].sort());
    assert.equal(probe.count(), 3);
  });

  it('命中缓存的修补不计耗时：预算耗尽时继续输入前缀仍能补全', () => {
    memberCompletions(docOf(broken('')), at(''), EN_US);
    const probe = countingParse();
    const items = memberCompletions(docOf(broken('a')), at('a'), EN_US, { parse: probe.parse, now: ticking(1000), repairBudgetMs: 0, repairBudgetFromLines: 0 });
    assert.deepEqual(labels(items), ['age', 'name']);
    assert.equal(probe.count(), 0);
  });

  it('原文可推断（`Return d.` 本身是完整语句）：不做修补解析', () => {
    const probe = countingParse();
    const items = memberCompletions(docOf([...HEAD, '  Return d.', '']), { line: 5, character: '  Return d.'.length }, EN_US, { parse: probe.parse });
    assert.deepEqual(labels(items), ['age', 'name']);
    assert.equal(probe.count(), 0);
  });
});
