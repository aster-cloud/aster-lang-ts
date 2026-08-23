import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { evaluate, serializeGuestValue } from '../../src/core/interpreter.js';

// 审计 #126 回归测试：GuestMap 宿主边界。
// JSON.stringify 会把普通对象的整数样式键升序重排（JS 自有属性规范），guest map 的
// 插入序在 toJSON 的对象形态里必然丢失 —— 与 JVM 引擎（Jackson 序列化 LinkedHashMap，
// 插入序）字节不一致。serializeGuestValue 手写 JSON 对象语法按插入序发射（合法 JSON），
// dual-engine runner 的 value 字段用它。toObject() 给按普通对象读取的宿主一个非空快照。

function evalMap(body: string): unknown {
  const c = compile(`Module probe.\n\n${body}\n`);
  assert.ok(c.core, `compile failed: ${JSON.stringify((c as { parseErrors?: { message?: string }[] }).parseErrors?.map((e) => e.message) ?? [])}`);
  const ev = evaluate(c.core!, 'f', {});
  assert.equal(ev.success, true, `eval: ${ev.error ?? ''}`);
  return ev.value;
}

const NUMERIC_KEYED = 'Rule f:\n  Return Map.put(Map.put(Map.empty(), "2", 20), "1", 10).';

describe('audit #126: GuestMap host-boundary serialization', () => {
  it('serializeGuestValue preserves numeric-like key insertion order (JVM byte parity)', () => {
    const v = evalMap(NUMERIC_KEYED);
    // 插入序 2 → 1；JVM LinkedHashMap+Jackson 输出 {"2":20,"1":10}
    assert.equal(serializeGuestValue(v), '{"2":20,"1":10}');
    // 对照：JSON.stringify（toJSON 对象形态）不可避免地重排 —— 记录这一已知限制，
    // 若未来 JS 规范或实现变化使其保持插入序，此断言提醒我们可以简化。
    assert.equal(JSON.stringify(v), '{"1":10,"2":20}');
  });

  it('serializeGuestValue recurses through lists and struct objects', () => {
    const v = evalMap(
      'Rule f:\n  Let inner be Map.put(Map.put(Map.empty(), "10", 1), "2", 2).\n  Return List.append(List.append(List.empty(), inner), 7).',
    );
    assert.equal(serializeGuestValue(v), '[{"10":1,"2":2},7]');
  });

  it('serializeGuestValue output is valid JSON that round-trips', () => {
    const v = evalMap(NUMERIC_KEYED);
    const parsed = JSON.parse(serializeGuestValue(v)) as Record<string, unknown>;
    assert.deepEqual(parsed, { '1': 10, '2': 20 });
  });

  it('serializeGuestValue escapes keys and string values', () => {
    const v = evalMap('Rule f:\n  Return Map.put(Map.empty(), "a\\"b", "x\\"y").');
    const s = serializeGuestValue(v);
    assert.equal(s, '{"a\\"b":"x\\"y"}');
    assert.deepEqual(JSON.parse(s), { 'a"b': 'x"y' });
  });

  it('serializeGuestValue handles primitives, null and top-level undefined', () => {
    assert.equal(serializeGuestValue(42), '42');
    assert.equal(serializeGuestValue('hi'), '"hi"');
    assert.equal(serializeGuestValue(null), 'null');
    assert.equal(serializeGuestValue(undefined), 'null');
  });

  it('toObject() gives hosts a usable, non-empty plain-object snapshot', () => {
    const v = evalMap(NUMERIC_KEYED) as { toObject: () => Record<string, unknown> };
    // Object.keys(guestMap) === []（真正的 Map），宿主改用 toObject()
    assert.deepEqual(Object.keys(v as unknown as object), []);
    const o = v.toObject();
    assert.equal(o['1'], 10);
    assert.equal(o['2'], 20);
    assert.equal(Object.keys(o).length, 2);
    // null 原型：无原型链可泄漏
    assert.equal(Object.getPrototypeOf(o), null);
  });
});
