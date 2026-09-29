import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { evaluate } from '../../src/core/interpreter.js';

/**
 * 累计分配预算（MAX_ALLOCATION_BUDGET）的行为锁定。
 *
 * ★**守的是什么**：单个 builtin 各自有上限（List.range 1e6、List.combinations
 * C(n,k)≤5000），但**组合起来**此前没有任何约束——List.concat 反复翻倍可用不到
 * 200 字节源码把规模推到约 1.3 亿元素。
 *
 * 修复前实测：本引擎 1.28 亿元素吃掉 3.3GB 堆且**返回 success**（静默通过，最坏形态）；
 * truffle 侧 1403ms 抛 `Java heap space`。既有防护全部失效：
 *   - MAX_STEPS 只数解释器步进，concat 在它眼里是 1 步、底层却是几千万次数组拷贝；
 *   - 宿主侧 5 秒 wall-clock 看门狗**来不及**（OOM 在 1.4 秒）。
 *
 * 与 aster-lang-truffle `AllocationBudgetTest` **同形同 fixture 语义**，
 * 保证两引擎在同一输入上给出同一判定。
 */
describe('allocation budget (内存放大 DoS 防护)', () => {
  // 攻击：concat 每行翻倍，1e6 → 2.56e8。
  const amplify = (rounds: number) => {
    let s = `Module p.
Rule main given seed as Int, produce Int:
  Let v0 be List.range(0, 1000000).\n`;
    for (let i = 1; i <= rounds; i++) {
      s += `  Let v${i} be List.concat(v${i - 1}, v${i - 1}).\n`;
    }
    return s + `  Return List.length(v${rounds}).`;
  };

  it('concat 翻倍放大被拒绝（而非 OOM 或静默成功）', () => {
    // ★用 7 轮（1.28 亿）而非 8 轮：7 轮正是修复前**静默返回 success**的那一档
    // （实测 heapDelta 3345MB、success=true）。8 轮会撞 V8 的 Array.concat 2^27
    // 上限报 `Invalid array length`——那是 V8 的硬限、不是我们的防护，
    // 拿它当用例会让「修复前会怎样」的论证站不住。
    const m = compile(amplify(7));
    assert.ok(m.core);
    const ev = evaluate(m.core!, 'main', { seed: 0 }, { maxSteps: 5_000_000 });
    assert.equal(ev.success, false, '放大攻击必须被拒绝');
    // 断言消息内容而非只断言 success=false：修复前这一档是 success=**true**（静默错答案）。
    // 且若将来退化成别的错误（V8 的 Invalid array length / 步数超限），
    // 只断言 false 会让这个测试在缺陷以另一形态回归时**依然是绿的**。
    assert.match(String(ev.error), /分配预算耗尽/);
  });

  it('★攻击藏在 lambda 回调里也必须被拦住', () => {
    // 预算重置点若做成「每次 lambda 调用都清零」，List.map 的每次回调都会把额度
    // 清空 → 守护形同虚设，而上一个用例**依然全绿**（它不经过 lambda）。
    // 故必须单独钉住这一形态。20 次回调 × 2e6 = 4e7 ≫ 1e7 预算。
    const src = `Module p.
Rule blow given x, produce Int:
  Let a be List.range(0, 1000000).
  Let b be List.concat(a, a).
  Return List.length(b).
Rule main given seed as Int, produce Int:
  Let xs be List.range(0, 20).
  Let ys be List.map(xs, blow).
  Return List.length(ys).`;
    const m = compile(src);
    assert.ok(m.core);
    const ev = evaluate(m.core!, 'main', { seed: 0 }, { maxSteps: 5_000_000 });
    assert.equal(ev.success, false);
    assert.match(String(ev.error), /分配预算耗尽/);
  });

  it('★Text.concat 字符串翻倍同样被拦住', () => {
    // 与集合向量同构但类型不同：返回 string，若计量只认 Array/Map 就扣 0 通过。
    // 实测修复前两引擎都 success：truffle 509ms 物化 268MB；本引擎因 V8 rope 更隐蔽
    // （concat 近乎零成本，直到 toUpper 之类强制扁平化才吃满内存，实测 +128MB）。
    let s = `Module p.
Rule main given seed as Int, produce Int:
  Let s0 be "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".\n`;
    for (let i = 1; i <= 22; i++) {
      s += `  Let s${i} be Text.concat(s${i - 1}, s${i - 1}).\n`;
    }
    s += `  Return Text.length(s22).`;
    const m = compile(s);
    assert.ok(m.core);
    const ev = evaluate(m.core!, 'main', { seed: 0 }, { maxSteps: 5_000_000 });
    assert.equal(ev.success, false, '字符串放大必须被拒绝');
    assert.match(String(ev.error), /分配预算耗尽/);
  });

  it('★嵌套容器不得靠「顶层小」逃过计量（groupBy 复用绕过）', () => {
    // 「只计顶层」那版设计的 Critical 漏洞：groupBy 把 1e6 元素全归进同一组，
    // 返回 Map 顶层 size=1 → 只扣 1 点、实际物化 1e6。重复 20 次 = 840 字节源码
    // 物化 2000 万元素只扣 20 点。实测修复前：Java 1972ms/+210MB SUCCESS；
    // 本引擎抬高 maxSteps 后同样 success、+396MB。
    //
    // 需要抬高 maxSteps 才能隔离出预算维度——默认 10000 步会先拦住（25ms），
    // 那是另一道防线在起作用，不能用它来证明预算有效。
    let s = `Module p.
Rule one given x, produce:
  Return 1.
Rule main given seed as Int, produce Int:
  Let a be List.range(0, 1000000).\n`;
    for (let i = 1; i <= 20; i++) s += `  Let g${i} be List.groupBy(a, one).\n`;
    s += `  Return Map.size(g20).`;
    const m = compile(s);
    assert.ok(m.core);
    const ev = evaluate(m.core!, 'main', { seed: 0 }, { maxSteps: 5_000_000_000 });
    assert.equal(ev.success, false, 'groupBy 反复重新物化入参必须被计量');
    assert.match(String(ev.error), /分配预算耗尽/);
  });

  it('★`plus` 运算符的字符串拼接也必须计量（曾是双引擎判定分叉）', () => {
    // `+` 走 evalBinary 而非 evalStdlibCall，chargeAllocation 的唯一调用点在后者
    // → 用 `plus` 代替 `Text.concat` 翻倍即可完全绕过预算。
    // 实测修复前：20 轮 = 3355 万字符 success=true；而同一份 IR 在 truffle 侧
    // （`+`→`add` builtin 经 Builtins.call 计量）是 REJECTED。同规则两引擎判定相反。
    let s = `Module p.
Rule main given seed as Int, produce Int:
  Let s0 be "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".\n`;
    for (let i = 1; i <= 20; i++) s += `  Let s${i} be s${i - 1} plus s${i - 1}.\n`;
    s += `  Return Text.length(s20).`;
    const m = compile(s);
    assert.ok(m.core);
    const ev = evaluate(m.core!, 'main', { seed: 0 }, { maxSteps: 5_000_000 });
    assert.equal(ev.success, false, 'plus 拼接必须同样受预算约束');
    assert.match(String(ev.error), /分配预算耗尽/);
  });

  it('★数值序转换不得对嵌套列表 toString（曾物化巨串且不计账）', () => {
    // 裸 `Number([...])` 会对数组调 toString() 把整个嵌套结构物化成巨串再返回 NaN，
    // 那份巨串不经过 chargeAllocation。实测修复前：9 层嵌套 + List.sort
    // → 10787ms / +707MB / success=true，源码仅 405 字节。
    // truffle 侧有类型闸门（toDouble 抛「期望 Number」），故这里同时是分叉。
    let s = `Module p.
Rule main given seed as Int, produce Int:
  Let base be List.range(0, 1000).
  Let n1 be [base, base, base, base].\n`;
    for (let i = 2; i <= 9; i++) s += `  Let n${i} be [n${i - 1}, n${i - 1}, n${i - 1}, n${i - 1}].\n`;
    s += `  Let srt be List.sort(n9).
  Return List.length(srt).`;
    const m = compile(s);
    assert.ok(m.core);
    const ev = evaluate(m.core!, 'main', { seed: 0 }, { maxSteps: 50_000_000 });
    assert.equal(ev.success, false, '对嵌套列表做数值序转换应报类型错，而非静默物化巨串');
    // 与 truffle 同口径：报类型错（不是预算错）——两引擎都在类型闸门处拒绝。
    assert.match(String(ev.error), /expected Number/);
  });

  it('预算内的大批量运算不被误拒', () => {
    const m = compile(amplify(1)); // 1e6 → 2e6，远低于 1e7
    assert.ok(m.core);
    const ev = evaluate(m.core!, 'main', { seed: 0 }, { maxSteps: 5_000_000 });
    assert.ok(ev.success, `合法用例不应被拒: ${ev.error ?? ''}`);
    assert.equal(ev.value, 2_000_000);
  });

  it('预算不跨执行残留（连续三次同一程序结果一致）', () => {
    // evaluate 每次新建 Interpreter，预算是实例字段故天然隔离；本用例锁住这一性质，
    // 防止将来有人把计数器提成模块级变量（那会让合法规则随机失败，
    // 且失败与否取决于此前跑过什么——最难查的一类缺陷）。
    const m = compile(amplify(2)); // 4e6，单次通过、累计三次会超
    assert.ok(m.core);
    for (let i = 1; i <= 3; i++) {
      const ev = evaluate(m.core!, 'main', { seed: 0 }, { maxSteps: 5_000_000 });
      assert.ok(ev.success, `第 ${i} 次执行应与第 1 次一致（预算残留？）: ${ev.error ?? ''}`);
      assert.equal(ev.value, 4_000_000);
    }
  });
});
