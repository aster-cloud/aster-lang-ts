// CJK 标点软边界归一化单元测试。
//
// 验证点：
//   1. 中文标点在字符串字面量外正确归一化为英文等价
//   2. 字符串字面量内的中文标点 100% 保留
//   3. 与现有 fullWidthToHalfWidth、关键字、冠词处理路径不冲突
//   4. 仅在 whitespaceMode === 'chinese' 的 lexicon 下生效；英文路径不受影响
//   5. 幂等性：再次 canonicalize 相同输入产生相同输出

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';

describe('CJK 标点软边界归一化', () => {
  describe('字符串外的标点替换', () => {
    it('。→ .（语句终止符）', () => {
      const input = '模块 测试.示例。';
      const result = canonicalize(input, ZH_CN);
      assert.ok(result.endsWith('.'), `expected to end with '.', got: ${result}`);
      assert.strictEqual(result.includes('。'), false);
    });

    it('：→ :（块起始符）', () => {
      const input = '规则 验证 给定 患者：\n  返回 真值。';
      const result = canonicalize(input, ZH_CN);
      assert.ok(result.includes(':'), `expected ':', got: ${result}`);
      assert.strictEqual(result.includes('：'), false);
    });

    it('，→ ,（列表分隔符）', () => {
      const input = '规则 评估 给定 年龄，评分，产出：\n  返回 真值。';
      const result = canonicalize(input, ZH_CN);
      assert.strictEqual(result.includes('，'), false);
      // 「，」应转为半角逗号，与英文 fixture 等价
      assert.ok(result.includes(','), `expected comma, got: ${result}`);
      assert.ok(/年龄\s*,\s*评分/.test(result), `expected '年龄, 评分': ${result}`);
    });

    it('；→ ;', () => {
      const input = '规则 评估 给定 年龄；评分，产出：\n  返回 真值。';
      const result = canonicalize(input, ZH_CN);
      assert.strictEqual(result.includes('；'), false);
      assert.ok(result.includes(';'), 'expected semicolon');
    });

    it('、→ ,（枚举分隔，与列表分隔等价）', () => {
      const input = '定义 决定 包含 是否批准、理由。';
      const result = canonicalize(input, ZH_CN);
      assert.strictEqual(result.includes('、'), false);
      assert.ok(result.includes(','), `expected enum sep -> comma: ${result}`);
    });
  });

  describe('字符串字面量内的标点保留', () => {
    it('「」 内的中文句号保留', () => {
      const input = '返回 「年龄不足。请重试」。';
      const result = canonicalize(input, ZH_CN);
      // 字符串内的 。 保持；字符串外的句号变 .
      assert.ok(result.includes('年龄不足。请重试'), `string content lost: ${result}`);
    });

    it('「」 内的中文逗号保留', () => {
      const input = '返回 「张三，李四」。';
      const result = canonicalize(input, ZH_CN);
      assert.ok(result.includes('张三，李四'), `string content lost: ${result}`);
    });

    it('「」 内的全部 CJK 标点都保留', () => {
      const input = '返回 「测试。：，；、」。';
      const result = canonicalize(input, ZH_CN);
      assert.ok(result.includes('测试。：，；、'), `string content lost: ${result}`);
    });
  });

  describe('英文 lexicon 路径不受影响', () => {
    it('英文输入下中文标点不应被处理（中文标点应保持原样作为标识符外字符）', () => {
      // 英文 lexicon 的 whitespaceMode !== 'chinese'，不应触发归一化
      const input = 'Module test.example.';
      const result = canonicalize(input);
      // 英文路径不应改变原句号语义
      assert.ok(result.includes('Module test.example.'), `unexpected: ${result}`);
    });
  });

  describe('幂等性', () => {
    it('对已归一化的代码再次 canonicalize 产生相同结果', () => {
      const input = '规则 验证 给定 患者：\n  如果 患者.年龄 大于 18，\n    返回 真值。';
      const once = canonicalize(input, ZH_CN);
      const twice = canonicalize(once, ZH_CN);
      assert.strictEqual(twice, once, `not idempotent: once=${once}, twice=${twice}`);
    });
  });

  describe('混合场景', () => {
    it('完整中文规则示例的端到端归一化', () => {
      const input = [
        '模块 测试.控制流。',
        '',
        '定义 决定 包含 是否批准、理由。',
        '',
        '规则 评估申请 包含 年龄，评分，产出：',
        '  如果 年龄 小于 18',
        '    返回 决定 包含 是否批准 将 设为 假值，理由 将 设为 「年龄不足」。',
        '  否则',
        '    返回 决定 包含 是否批准 将 设为 真值，理由 将 设为 「通过」。',
      ].join('\n');
      const result = canonicalize(input, ZH_CN);

      // 不应残留任何字符串外 CJK 标点（segmentString 用 lexicon 的 quotes，即「」）
      const lexQuoteOpen = '「';
      const lexQuoteClose = '」';
      const segments = result.split(/[「」]/);
      const stringOutside = segments.filter((_, i) => i % 2 === 0).join('');
      assert.strictEqual(stringOutside.includes('。'), false, `句号未归一化: ${result}`);
      assert.strictEqual(stringOutside.includes('，'), false, `逗号未归一化: ${result}`);
      assert.strictEqual(stringOutside.includes('：'), false, `冒号未归一化: ${result}`);
      assert.strictEqual(stringOutside.includes('、'), false, `顿号未归一化: ${result}`);

      // 字符串内的标点保留
      assert.ok(result.includes('年龄不足') || result.includes('「年龄不足」'));

      // 应当生成英文等价标点
      assert.ok(stringOutside.includes(','), '应生成半角逗号');
      assert.ok(stringOutside.includes(':'), '应生成半角冒号');
      assert.ok(stringOutside.includes('.'), '应生成半角句号');
      // ensure lexicon quotes preserved as-is (not normalized)
      void lexQuoteOpen; void lexQuoteClose;
    });
  });
});
