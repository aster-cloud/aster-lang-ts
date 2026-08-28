import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { evaluate } from '../../src/core/interpreter.js';

/**
 * Map 结构相等（issue aster-lang-ts#143）。
 *
 * ★真实缺陷：`valueEquals` 的结构比较分支显式带 `&& !(x instanceof Map)`，
 * 把 Map **排除**在外，GuestMap 落回引用相等：
 *
 *     Map.put(Map.empty(),"a",1) == Map.put(Map.empty(),"a",1)   →  false
 *     [1, 2] == [1, 2]                                           →  true
 *
 * 即 **TS 自身就不自洽**（同样"内容相同"，换个载体结论相反）；而 truffle 的
 * valueEquals 对映射逐键递归 → 同一条规则 TS 判 false、JVM 判 true，
 * **跨引擎决策翻转且不报错**。
 *
 * 修法镜像 truffle `Builtins.valueEquals`：先比 size，再逐键递归；
 * 一侧是 Map 另一侧不是 → false。
 */
function run(body: string): unknown {
  const c = compile(`Module probe.\n${body}\n`);
  assert.ok(c.core, `compile: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
  const ev = evaluate(c.core!, 'main', { seed: 0 });
  assert.ok(ev.success, `eval: ${ev.error ?? ''}`);
  return ev.value;
}

const M = (k: string, v: string) => `Map.put(Map.empty(), "${k}", ${v})`;

describe('Map 参与结构相等（与 JVM 对齐）', () => {
  it('★内容相同的两个 map 相等（此前 false）', () => {
    assert.equal(
      run(`Rule main produce Bool:\n  Return ${M('a', '1')} equals to ${M('a', '1')}.`),
      true,
    );
  });

  it('★与列表行为自洽：同样"内容相同"不应因载体不同而结论相反', () => {
    // 这条钉的是**内部一致性**——原缺陷最刺眼之处正是 list 判 true、map 判 false。
    assert.equal(run('Rule main produce Bool:\n  Return [1, 2] equals to [1, 2].'), true);
    assert.equal(
      run(`Rule main produce Bool:\n  Return ${M('a', '1')} equals to ${M('a', '1')}.`),
      true,
    );
  });

  it('值不同 → 不等', () => {
    assert.equal(
      run(`Rule main produce Bool:\n  Return ${M('a', '1')} equals to ${M('a', '2')}.`),
      false,
    );
  });

  it('键不同 → 不等', () => {
    assert.equal(
      run(`Rule main produce Bool:\n  Return ${M('a', '1')} equals to ${M('b', '1')}.`),
      false,
    );
  });

  it('★size 不同 → 不等（先比 size，镜像 truffle）', () => {
    assert.equal(
      run(`Rule main produce Bool:\n  Let a be Map.put(${M('a', '1')}, "b", 2).\n  Return a equals to ${M('a', '1')}.`),
      false,
    );
  });

  it('空 map 相等', () => {
    assert.equal(run('Rule main produce Bool:\n  Return Map.empty() equals to Map.empty().'), true);
  });

  it('★嵌套 map 逐层递归', () => {
    const inner = M('x', '1');
    assert.equal(
      run(`Rule main produce Bool:\n  Return Map.put(Map.empty(), "k", ${inner}) equals to Map.put(Map.empty(), "k", ${inner}).`),
      true,
    );
  });

  it('★一侧 Map 一侧 List → false（载体不同即不等）', () => {
    assert.equal(
      run(`Rule main produce Bool:\n  Return ${M('a', '1')} equals to [1].`),
      false,
    );
  });

  it('★List.contains 含 map 元素时也随之修正', () => {
    assert.equal(
      run(`Rule main produce Bool:\n  Return List.contains([${M('a', '1')}], ${M('a', '1')}).`),
      true,
    );
  });

  it('★List.distinct 含 map 元素时能真正去重', () => {
    assert.equal(
      run(`Rule main produce Int:\n  Return List.length(List.distinct([${M('a', '1')}, ${M('a', '1')}])).`),
      1,
    );
  });
});
