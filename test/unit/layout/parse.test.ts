/**
 * parseLayout（ADR 0058 §7.3 / §7.8）：拒绝未知键、空 span 列表、空 text、空 canonical、
 * 把代理对拆在两个 span 之间的 layout；拒绝时抛 LayoutError，code 为稳定码。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT_LIMITS, LayoutError, parseLayout, serializeLayout } from '../../../src/layout/index.js';
import { JINGYESI_LAYOUT, SHERLOCK_LAYOUT } from './fixtures.js';

function rejects(text: string, code = 'layout_invalid_format'): void {
  assert.throws(
    () => parseLayout(text),
    (e: unknown) => e instanceof LayoutError && e.code === code,
    `应以 ${code} 拒绝：${text.slice(0, 120)}`,
  );
}

describe('parseLayout 接受', () => {
  it('示例 layout 往返', () => {
    for (const layout of [JINGYESI_LAYOUT, SHERLOCK_LAYOUT]) {
      const text = serializeLayout(layout);
      assert.equal(serializeLayout(parseLayout(text)), text);
    }
  });

  it('display 为空串的结构 span（隐藏）', () => {
    assert.deepEqual(parseLayout('{"v":1,"spans":[{"text":"a"},{"canonical":"。","display":""}]}'), {
      v: 1,
      spans: [{ text: 'a' }, { canonical: '。', display: '' }],
    });
  });

  it('键序与空白不限（导入手写 JSON）', () => {
    assert.deepEqual(parseLayout(' { "spans" : [ { "display":"，","canonical":"。" }, {"text":"x"} ], "v" : 1 } '), {
      v: 1,
      spans: [{ canonical: '。', display: '，' }, { text: 'x' }],
    });
  });

  it('完整的代理对留在一个 span 内', () => {
    assert.equal(parseLayout('{"v":1,"spans":[{"text":"😀"},{"canonical":"。","display":"😀"}]}').spans.length, 2);
  });
});

describe('parseLayout 拒绝（layout_invalid_format）', () => {
  it('不是 JSON / 不是对象', () => {
    rejects('not json');
    rejects('[]');
    rejects('null');
    rejects('"x"');
  });

  it('版本不是 1', () => {
    rejects('{"v":2,"spans":[{"text":"a"}]}');
    rejects('{"v":"1","spans":[{"text":"a"}]}');
    rejects('{"spans":[{"text":"a"}]}');
  });

  it('未知键（顶层与 span）', () => {
    rejects('{"v":1,"spans":[{"text":"a"}],"extra":0}');
    rejects('{"v":1,"spans":[{"text":"a","note":"x"}]}');
    rejects('{"v":1,"spans":[{"canonical":"。","display":"，","text":"a"}]}');
    rejects('{"v":1,"spans":[{"canonical":"。"}]}');
    rejects('{"v":1,"spans":[{}]}');
  });

  it('空 span 列表、空 text、空 canonical', () => {
    rejects('{"v":1,"spans":[]}');
    rejects('{"v":1,"spans":{}}');
    rejects('{"v":1,"spans":[{"text":""}]}');
    rejects('{"v":1,"spans":[{"text":"a"},{"canonical":"","display":"，"}]}');
  });

  it('字段不是字符串', () => {
    rejects('{"v":1,"spans":[{"text":1}]}');
    rejects('{"v":1,"spans":[{"canonical":"。","display":null}]}');
    rejects('{"v":1,"spans":["a"]}');
  });

  it('代理对被拆在两个 span 之间（canonical 侧与 display 侧）', () => {
    // 😀 = 😀
    rejects('{"v":1,"spans":[{"text":"a\\ud83d"},{"text":"\\ude00b"}]}');
    rejects('{"v":1,"spans":[{"text":"a\\ud83d"},{"canonical":"\\ude00","display":"x"}]}');
    // display 侧：空 display 的结构 span 不隔开两侧，拆开的代理对在 display 里相邻
    rejects('{"v":1,"spans":[{"text":"a\\ud83d"},{"canonical":"。","display":""},{"text":"\\ude00"}]}');
    rejects('{"v":1,"spans":[{"text":"a"},{"canonical":"。","display":"\\ud83d"},{"canonical":"，","display":"\\ude00"}]}');
  });
});

describe('parseLayout 拒绝（layout_too_large）', () => {
  it('文本超过 serializedBytes 不解析', () => {
    const pad = 'x'.repeat(LAYOUT_LIMITS.serializedBytes);
    rejects(`{"v":1,"spans":[{"text":"${pad}"}]}`, 'layout_too_large');
  });
});
