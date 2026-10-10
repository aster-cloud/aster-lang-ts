/**
 * ADR 0046 §2/§5：Profile 声明与 When/Otherwise 语法糖在 TS 前端的解析与降糖。
 *
 * 降糖须与 aster-lang-core（AstBuilder）产出逐字段一致的 Core IR：
 * `When c, outcome.` → `If c: Return Verdict.*(…)`（无 else）；`Otherwise outcome.` → `Return Verdict.*(…)`。
 * 语法糖把 If 与 Return 写在同一行，故与长写法只在去掉 origin 后相等。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parseWithLexicon } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { formatCNL } from '../../../src/formatter.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import type { Core } from '../../../src/types.js';

// 源码 → Core 的完整管线；任何解析错误都抛出（消息即首条诊断）
function toCore(source: string, lexicon: Lexicon = EN_US): Core.Module {
  const tokens = lex(canonicalize(source, lexicon), lexicon);
  const result = parseWithLexicon(tokens, lexicon);
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((d) => d.message).join('\n'));
  return lowerModule(result.ast);
}

function stripOrigins(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(stripOrigins);
  if (!o || typeof o !== 'object') return o;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k !== 'origin') out[k] = stripOrigins(v);
  }
  return out;
}

function bodyOf(core: Core.Module): readonly Core.Statement[] {
  const func = core.decls[0] as Core.Func;
  return func.body.statements;
}

const OUTCOME_ERROR = /Expected allow, deny, escalate or require approval by … because … after When\/Otherwise/;

describe('ADR 0046 — Profile 声明', () => {
  test('Profile 声明进入 Core.Module.profile', () => {
    const core = toCore('Module m.\nProfile "governed".\n\nRule r produce Int:\n  Return 1.\n');
    assert.equal(core.profile, 'governed');
  });

  test('带连字符的档案 id 可声明', () => {
    const core = toCore('Module m.\nProfile "eu-ai-act-high-risk".\n\nRule r produce Int:\n  Return 1.\n');
    assert.equal(core.profile, 'eu-ai-act-high-risk');
  });

  test('未声明档案时 Core.Module 不含 profile 键', () => {
    const core = toCore('Module m.\n\nRule r produce Int:\n  Return 1.\n');
    assert.equal('profile' in core, false);
    assert.equal(JSON.stringify(core).includes('"profile"'), false);
  });

  test('小写 profile 参数名不受影响', () => {
    const core = toCore('Module m.\n\nRule r given profile, produce Int:\n  Return profile.\n');
    assert.equal('profile' in core, false);
  });

  test('档案 id 形态非法抛错', () => {
    assert.throws(() => toCore('Module m.\nProfile "Bad_Id".\n'),
      /Profile id must match \^\[a-z\]\[a-z0-9-\]\{0,63\}\$: Bad_Id/);
  });

  test('重复声明或不在模块头之后抛错', () => {
    const misplaced = /Profile must follow the Module header and appear at most once/;
    assert.throws(() => toCore('Module m.\nProfile "a".\nProfile "b".\n'), misplaced);
    assert.throws(() => toCore('Profile "a".\nModule m.\n'), misplaced);
    assert.throws(() => toCore('Module m.\n\nRule r produce Int:\n  Return 1.\n\nProfile "a".\n'), misplaced);
    // 第二个模块头之后的 Profile 同样算重复（Java 连第二个模块头都拒绝）
    assert.throws(() => toCore('Module a.\nProfile "x".\nModule b.\nProfile "y".\n'), misplaced);
  });
});

describe('ADR 0046 — When/Otherwise 语法糖', () => {
  test('语法糖与长写法的 Core 去 origin 后相等', () => {
    const sugar = ['Module m.', '', 'Rule decide given amount, produce Verdict:',
      '  When amount at least 100, require approval by "Officer" because "large".',
      '  When amount at most 0, deny "negative".',
      '  When amount at least 50, escalate "review".',
      '  Otherwise allow.', ''].join('\n');
    const long = ['Module m.', '', 'Rule decide given amount, produce Verdict:',
      '  If amount at least 100:', '    Return Verdict.require_approval("Officer", "large").',
      '  If amount at most 0:', '    Return Verdict.deny("negative").',
      '  If amount at least 50:', '    Return Verdict.escalate("review").',
      '  Return Verdict.allow().', ''].join('\n');
    assert.deepEqual(stripOrigins(toCore(sugar)), stripOrigins(toCore(long)));
  });

  test('合成节点带有源码行号（不是第 0 行）', () => {
    const core = toCore(['Module m.', '', 'Rule r given n, produce Verdict:',
      '  When n at least 1, deny "x".', '  Otherwise allow.', ''].join('\n'));
    const [when, otherwise] = bodyOf(core) as [Core.If, Core.Return];
    assert.equal(when.origin?.start.line, 4);
    assert.equal(when.thenBlock.origin?.start.line, 4);
    assert.equal(when.thenBlock.statements[0]!.origin?.start.line, 4);
    assert.equal(otherwise.origin?.start.line, 5);
  });

  test('Otherwise 之后还有语句抛错', () => {
    assert.throws(() => toCore(['Module m.', '', 'Rule r produce Verdict:', '  Otherwise allow.',
      '  Return Verdict.deny("x").', ''].join('\n')), /Otherwise must be the last statement of its block/);
  });

  test('Otherwise 只收尾所在块：嵌套块内收尾不影响外层后续语句', () => {
    const core = toCore(['Module m.', '', 'Rule r given n as Int, produce Verdict:', '  If n at least 1:',
      '    Otherwise deny "x".', '  Return Verdict.allow().', ''].join('\n'));
    assert.equal(bodyOf(core).length, 2);
    assert.throws(() => toCore(['Module m.', '', 'Rule r given n as Int, produce Verdict:', '  If n at least 1:',
      '    Otherwise deny "x".', '    Return Verdict.allow().', ''].join('\n')),
    /Otherwise must be the last statement of its block/);
  });

  test('结论词组合非法抛错', () => {
    for (const outcome of ['allow "x"', 'deny', 'approve "x"',
      'require approval by "a"', 'require approval by "a" since "b"']) {
      assert.throws(() => toCore(['Module m.', '', 'Rule r given n, produce Verdict:',
        `  When n at least 1, ${outcome}.`, '  Otherwise allow.', ''].join('\n')), OUTCOME_ERROR, outcome);
    }
    assert.throws(() => toCore(['Module m.', '', 'Rule r produce Verdict:',
      '  Otherwise approve "x".', ''].join('\n')), OUTCOME_ERROR);
  });

  test('结论含非单词记号同样报结论错误（对齐 Java A5）', () => {
    for (const outcome of ['deny 42', 'deny "a" + "b"', 'escalate ("x")', 'allow, deny "x"',
      'deny "x" because 1', 'require approval by "a" because "b" now', 'allow 1.5']) {
      for (const stmt of [`  When n at least 1, ${outcome}.`, `  Otherwise ${outcome}.`]) {
        assert.throws(() => toCore(['Module m.', '', 'Rule r given n, produce Verdict:', stmt, ''].join('\n')),
          OUTCOME_ERROR, stmt);
      }
    }
  });

  test('Otherwise 后紧跟逗号或冒号不是语法糖：报普通解析错误而非语法糖消息', () => {
    const sugarMessages = /Otherwise must be the last statement|Expected allow, deny, escalate/;
    const cases: ReadonlyArray<readonly [string, RegExp]> = [
      // If 块之后：按 else 分支解析，缺换行
      ['  If n at least 1:\n    Return Verdict.deny("x").\n  Otherwise, Return Verdict.allow().', /^Expected newline$/],
      ['  If n at least 1:\n    Return Verdict.deny("x").\n  Otherwise: Return Verdict.allow().', /^Expected newline$/],
      // 没有前置 If：结论不得以逗号或冒号开头
      ['  Otherwise, Return Verdict.allow().', /^Unexpected ',' where an outcome was expected$/],
      ['  Otherwise: Return Verdict.allow().', /^Unexpected ':' where an outcome was expected$/],
    ];
    for (const [body, expected] of cases) {
      const src = ['Module m.', '', 'Rule r given n as Int, produce Verdict:', body, ''].join('\n');
      assert.throws(() => toCore(src), (e: Error) => {
        assert.doesNotMatch(e.message, sugarMessages, body);
        assert.match(e.message, expected, body);
        return true;
      });
    }
  });

  test('If 块后的 Otherwise 换行块仍是 else 分支', () => {
    const core = toCore(['Module m.', '', 'Rule r given a, produce Int:', '  If a at least 1:', '    Return 1.',
      '  Otherwise:', '    Return 2.', ''].join('\n'));
    const body = bodyOf(core);
    assert.equal(body.length, 1);
    const first = body[0] as Core.If;
    assert.equal(first.kind, 'If');
    assert.ok(first.elseBlock, '应有 else 块');
    assert.equal(first.elseBlock!.statements.length, 1);
  });

  test('If 块后紧随 Otherwise 语法糖是独立语句，不被吞作 else', () => {
    const core = toCore(['Module m.', '', 'Rule r given a, produce Verdict:', '  If a at least 1:',
      '    Return Verdict.deny("x").', '  Otherwise allow.', ''].join('\n'));
    const body = bodyOf(core);
    assert.equal(body.length, 2);
    assert.equal(body[0]!.kind, 'If');
    assert.equal((body[0] as Core.If).elseBlock, null);
    assert.equal(body[1]!.kind, 'Return');
  });

  test('Match 分支的 When 不受影响', () => {
    const core = toCore(['Module m.', '', 'Rule r given n, produce Int:',
      '  Match n:', '    When 1, Return 10.', '    When x, Return 20.', ''].join('\n'));
    assert.equal(bodyOf(core)[0]!.kind, 'Match');
  });

  test('Verdict 成员调用不受新词影响', () => {
    const core = toCore('Module m.\n\nRule r produce Verdict:\n  Return Verdict.allow().\n');
    const ret = bodyOf(core)[0] as Core.Return;
    assert.equal(ret.kind, 'Return');
    assert.equal(ret.expr.kind, 'Call');
  });

  test('中文与德文档案与语法糖同样降糖', () => {
    // 英文长写法关闭冠词删除，保留与中德源文同名的参数 a（对齐 Java 测试的同一组源文）
    const enKeepArticles: Lexicon = {
      ...EN_US,
      canonicalization: { ...EN_US.canonicalization, removeArticles: false },
    };
    const expected = stripOrigins(toCore(['Module m.', 'Profile "governed".', '',
      'Rule r given a produce Verdict:',
      '  If a at least 100:', '    Return Verdict.require_approval("Officer", "large").',
      '  If a at least 50:', '    Return Verdict.escalate("review").',
      '  If a at least 1:', '    Return Verdict.deny("x").',
      '  Return Verdict.allow().', ''].join('\n'), enKeepArticles));
    const zhSrc = ['模块 m。', '档案 "governed"。', '',
      '规则 r 给定 a 产出 Verdict：',
      '  当 a 至少 100，需审批人 "Officer" 因为 "large"。',
      '  当 a 至少 50，升级 "review"。',
      '  当 a 至少 1，拒绝 "x"。',
      '  否则 允许。', ''].join('\n');
    const deSrc = ['Modul m.', 'Profil "governed".', '',
      'Regel r gegeben a liefert Verdict:',
      '  bei a mindestens 100, Genehmigung durch "Officer" weil "large".',
      '  bei a mindestens 50, eskalieren "review".',
      '  bei a mindestens 1, ablehnen "x".',
      '  sonst erlauben.', ''].join('\n');
    assert.deepEqual(stripOrigins(toCore(zhSrc, ZH_CN)), expected, 'zh-CN');
    assert.deepEqual(stripOrigins(toCore(deSrc, DE_DE)), expected, 'de-DE');
  });
});

describe('ADR 0046 — 格式化器', () => {
  test('格式化器保留 Profile 行', () => {
    const out = formatCNL('Module m.\nProfile "governed".\n\nRule r produce Int:\n  Return 1.\n');
    assert.match(out, /^Module m\.\nProfile "governed"\./);
  });

  test('格式化器把语法糖按长写法输出（ADR 0046 §10 已知限制）', () => {
    const sugar = ['Module m.', '', 'Rule r given n, produce Verdict:',
      '  When n at least 1, deny "x".', '  Otherwise allow.', ''].join('\n');
    const long = ['Module m.', '', 'Rule r given n, produce Verdict:',
      '  If n at least 1:', '    Return Verdict.deny("x").', '  Return Verdict.allow().', ''].join('\n');
    assert.equal(formatCNL(sugar), formatCNL(long));
  });
});
