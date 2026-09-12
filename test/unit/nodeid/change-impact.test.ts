import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import type { Module as AstModule } from '../../../src/types.js';
import { computeNodeIds, canonicalHash } from '../../../src/nodeid/node-id-map.js';
import { diffNodeIds } from '../../../src/nodeid/change-impact.js';

/**
 * ADR 0037 §4 的核心能力：跨版本 change impact（TS 侧，与 Java 对等）。
 *
 * <p>每条用例都锚在一个**具体的产品承诺**上（「改阈值 → 立刻知道哪条规则
 * stale」），而不是锚在实现细节（路径字符串长什么样）上——后者会在重构时
 * 变红却证明不了任何事。
 */

const V1 = [
  'Module demo.approve.',
  '',
  'Rule approve given amount, produce:',
  '  If amount greater than 10000:',
  '    Return "REFER".',
  '  Otherwise:',
  '    Return "APPROVE".',
  '',
].join('\n');

/** 完整链路：源码 → canonicalize → lex → parse → lower → Core IR。 */
function ir(src: string): unknown {
  const ast = parse(lex(canonicalize(src))).ast as AstModule;
  return JSON.parse(JSON.stringify(lowerModule(ast)));
}

function idsOf(src: string) {
  return computeNodeIds(ir(src));
}

describe('change impact（TS 侧）', () => {
  it('★改阈值：节点身份不变、内容指纹变 —— 这正是 change impact 的前提', () => {
    const v2 = V1.replace('10000', '20000');
    assert.notStrictEqual(v2, V1, '★replace 未生效则本用例测的是「未编辑」，结论无效。');

    const changes = diffNodeIds(idsOf(V1), idsOf(v2));

    // 契约 1：不能出现「旧节点消失 + 新节点出现」——那说明身份没稳住。
    assert.ok(!changes.some(c => c.kind === 'ADDED'),
      `改一个字面量不应产生 ADDED 节点，实际：${JSON.stringify(changes)}`);
    assert.ok(!changes.some(c => c.kind === 'REMOVED'),
      `改一个字面量不应产生 REMOVED 节点，实际：${JSON.stringify(changes)}`);

    // 契约 2：必须有 MODIFIED，否则 change impact 根本没察觉到这次修改。
    assert.ok(changes.some(c => c.kind === 'MODIFIED'),
      '改了阈值却没报告任何 MODIFIED —— change impact 失效。');

    // 契约 3：包含该阈值的那条规则必须被标为 stale（§4 的「谁受影响」）。
    assert.ok(changes.flatMap(c => c.staleAncestors).some(a => a.includes('{approve}')),
      `改了 approve 规则内的阈值，该规则应出现在 staleAncestors 里。实际：${JSON.stringify(changes)}`);
  });

  it('★在前面插入一条无关规则：原有规则的身份必须纹丝不动', () => {
    // 这是纯下标路径方案的灾难场景（实测 5/16 存活）。命名作用域路径应完全免疫。
    const v2 = V1.replace('Rule approve', 'Rule noop, produce:\n  Return "X".\n\nRule approve');
    assert.notStrictEqual(v2, V1, '★replace 未生效则本用例无效。');

    const before = idsOf(V1);
    const after = idsOf(v2);

    for (const [id, identity] of before) {
      const now = after.get(id);
      assert.ok(now !== undefined,
        `插入无关规则后，原节点 ${id} 的身份丢失了`
        + '\n★这会让 change impact 把「没动过的规则」误报成被删除。');
      // ★根节点 `$` 除外：模块的 decls 确实多了一条规则，它的内容**本就应该**变。
      //   契约是「祖先 stale、后代不受扰」，不是「插入后整棵树一个字节都不许动」。
      if (id !== '$') {
        assert.strictEqual(now!.contentHash, identity.contentHash,
          `原节点 ${id} 内容未变，contentHash 却变了`
          + '\n★多半是 contentHash 混进了位置信息（origin 未剥干净）。');
      }
    }

    // 反向守卫：根节点**必须**变——它是「本模块多了一条规则」的唯一体现。
    assert.notStrictEqual(after.get('$')!.contentHash, before.get('$')!.contentHash,
      '模块新增了一条规则，根节点 contentHash 却没变 —— 内容指纹失效。');

    assert.ok(diffNodeIds(before, after).some(c => c.kind === 'ADDED'),
      '插入了一条新规则却没有任何 ADDED。');
  });

  it('未修改的程序：不得报告任何变更（防止 change impact 恒报 stale）', () => {
    // 若本用例变红，说明 nodeId 或 contentHash 里混进了非确定性内容
    // （随机序、时间戳、位置…）——那会让每次编译都「全量 stale」，能力等于没有。
    assert.deepStrictEqual(diffNodeIds(idsOf(V1), idsOf(V1)), [],
      '同一份源码两次编译不应产生任何变更。');
  });

  it('★contentHash 必须剥掉 origin：位置不是内容', () => {
    // 在**文件开头**加一行注释：所有代码整体下移一行，位置全变、内容全同。
    const v2 = `# 一行注释\n${V1}`;

    assert.deepStrictEqual(diffNodeIds(idsOf(V1), idsOf(v2)), [],
      '只加了一行注释（位置变、内容不变），却报告了变更。'
      + '\n★说明 contentHash 未剥干净 origin —— 这会让每次挪动代码都触发'
      + '\n  全量 stale，change impact 沦为噪声。');
  });

  it('已知局限：重命名规则会使其子树身份迁移（如实暴露，不掩盖）', () => {
    // ADR 0037 §8.5 记录的固有代价（实测 1/16 存活）。本用例把它**钉成已知行为**，
    // 而不是让它在生产里以「一条规则凭空消失 + 一条凭空出现」的形式被发现。
    const v2 = V1.replace('Rule approve given amount', 'Rule assess given amount');
    assert.notStrictEqual(v2, V1, '★replace 未生效则本用例无效。');

    const changes = diffNodeIds(idsOf(V1), idsOf(v2));
    assert.ok(changes.some(c => c.kind === 'REMOVED'),
      `重命名应表现为旧身份 REMOVED（需由显式 rename 声明消解），实际：${JSON.stringify(changes)}`);
    assert.ok(changes.some(c => c.kind === 'ADDED'),
      `重命名应表现为新身份 ADDED，实际：${JSON.stringify(changes)}`);
  });

  it('stale 只向上传播，不向下 —— 否则影响面被夸大到整棵子树', () => {
    const changes = diffNodeIds(idsOf(V1), idsOf(V1.replace('10000', '20000')));

    for (const c of changes) {
      for (const ancestor of c.staleAncestors) {
        assert.ok(c.nodeId.startsWith(ancestor),
          `staleAncestors 含非祖先项：节点 ${c.nodeId} 的 ${ancestor}`
          + '\n★若把后代也标 stale，改一个字面量会波及整棵子树，影响面失真。');
        assert.notStrictEqual(c.nodeId, ancestor, '节点自身不应出现在 staleAncestors 里。');
      }
    }
  });
});

describe('canonicalHash：与 Java 同口径', () => {
  it('★object key 按 Unicode code point 升序（不是 UTF-16 code unit 序）', () => {
    // JS 的字符串比较（`<` 与默认 `.sort()`）按 **UTF-16 code unit**；Java 的
    // CanonicalJson 按 **code point**。两者对增补平面字符的排序**相反**——
    // 两侧会对同一棵树产出不同 hash，且只在含这类字符的程序上暴露（极易隐身）。
    //
    // ★判别用例必须选一对在两种排序下**次序相反**的键，否则测试恒绿：
    //   U+1F600 😀 的代理对以 D83D 开头 → UTF-16 序排在 U+FF5A ｚ **之前**；
    //   而 code point 序 0x1F600 > 0xFF5A → 应排在**之后**。
    //   （最初我用的是 `\u{1F600}` vs `'z'`(U+007A)，两种排序结果相同，
    //     把 compareByCodePoint 换成默认 .sort() 测试照样绿 = 假门禁。）
    const emoji = '\u{1F600}';
    const fullwidthZ = '\uFF5A';
    assert.notStrictEqual(
      emoji < fullwidthZ,
      emoji.codePointAt(0)! < fullwidthZ.codePointAt(0)!,
      '★选用的键对在两种排序下次序相同，本用例无法判别 —— 换一对键。');

    // 期望值取自 Java CanonicalJson.canonicalHash（实跑），非 TS 自产回填。
    assert.strictEqual(
      canonicalHash({ [emoji]: 1, [fullwidthZ]: 2 }),
      'b87d68a90ea148ae96b7a6680061882d749a96d3b0a269a9c5b3a18ff647961e',
      '键序与 Java 不一致 —— 多半是用了 JS 默认的 UTF-16 比较而非 code point 比较。');
  });

  it('★拒绝浮点与超安全整数：静默降级会产出两侧不同的 hash', () => {
    assert.throws(() => canonicalHash({ x: 1.5 }), /安全整数/,
      '浮点应抛错——跨引擎浮点表示不一致，静默接受会让两侧 hash 不同且无人察觉。');
    assert.throws(() => canonicalHash({ x: Number.MAX_SAFE_INTEGER + 2 }), /安全整数/);
    assert.throws(() => canonicalHash({ x: NaN }), /NaN|Infinity/);
  });

  it('hash 随内容变化（防止退化成常量）', () => {
    assert.notStrictEqual(canonicalHash({ a: 1 }), canonicalHash({ a: 2 }),
      '不同内容产出了相同 hash —— 指纹失效。');
  });
  it('★与 Java 引擎产出逐字节相同的 hash（跨引擎黄金向量）', () => {
    // ADR 0037 §7 要求 `Verify_TS == Verify_Java`。contentHash 是 verifier 的
    // 输入之一，两侧必须对同一棵树产出同一个 hash。
    //
    // ★下列期望值是从 **Java `CanonicalJson.canonicalHash`** 实跑取得的
    //   （aster-lang-core，同一组输入），不是从 TS 自己的输出回填的——
    //   后者会让本测试退化成「TS 和它自己一致」，恒绿且毫无意义。
    //
    // 覆盖四类易分叉点：键序、数组保序、字符串转义、null/bool 表示。
    const golden: ReadonlyArray<readonly [unknown, string]> = [
      [{ kind: 'Func', name: 'approve' },
        '1d734937ddec06a461c07bd9288b2794e5ed4c3f6412c35e77eb4f2ccedfa779'],
      [{ kind: 'Module', name: 'demo.x', decls: [] },
        'c57535c007893ea6a6e20cf310eac1bb94fe2034ccdbaa5d81c60672dc74b890'],
      [{ z: 2, a: 1, m: [1, 2, 3] },
        'ab46e446797b892a3626bbb51dac66c3bd1593612eb644be1f3f452232d876e3'],
      [{ s: 'hello "world"\n', b: true, n: null },
        '92c558f3dd8a1fd1e7be98261a6cb4fc37f01433418de7332dbb6540f8d5b8ea'],
      [{ nested: { kind: 'If', cond: { kind: 'Bool', value: true } } },
        '247d63263789e93f4c6700e1badf401abcd26662ca37767b4552873398571c7e'],
    ];

    for (const [value, expected] of golden) {
      assert.strictEqual(canonicalHash(value), expected,
        `TS 与 Java 的 canonical hash 不一致，输入：${JSON.stringify(value)}`
        + '\n★两侧对同一棵树必须产出同一 hash，否则跨引擎 verifier 无法成立。');
    }
  });
});
