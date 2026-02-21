import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';

describe('canonicalizer', () => {
  describe('注释处理', () => {
    it('应该删除行注释并保留空行占位', () => {
      const input = ['first line', '# comment', '  // inline comment', 'second line'].join('\n');
      const result = canonicalize(input);

      assert.strictEqual(result, 'first line\n\nsecond line');
      assert.strictEqual(result.includes('comment'), false);
    });
  });

  describe('冠词移除', () => {
    it('应该在字符串外移除冠词', () => {
      const result = canonicalize('Return the answer.');

      assert.strictEqual(result, 'Return answer.');
    });

    it('应该在字符串内保留冠词', () => {
      const result = canonicalize('Return "the answer".');

      assert.strictEqual(result, 'Return "the answer".');
    });
  });

  describe('多词关键字替换', () => {
    it('应该将多词关键字统一为小写', () => {
      const input = 'MODULE Example.\nWAIT FOR OPTION OF value.';
      const result = canonicalize(input);

      // 单词关键字（MODULE）不被 canonicalizer 处理，由 parser 的 case-insensitive 匹配处理
      // 多词关键字（WAIT FOR, OPTION OF）被 canonicalizer 统一为小写
      assert.strictEqual(result, 'MODULE Example.\nwait for option of value.');
    });

    it('应该避免误匹配紧凑单词', () => {
      const input = 'Return WaitFor result and Module island scenic.';
      const result = canonicalize(input);

      // 单词 Module 不被 canonicalizer 小写化（由 parser 处理）
      assert.strictEqual(result, 'Return WaitFor result and Module island scenic.');
    });
  });

  describe('缩进与空白规范', () => {
    it('应该将制表符统一为两个空格缩进', () => {
      const input = ['Line1', '\tIndented line', '\t  Mixed tab spaces', '  Already spaced'].join('\n');
      const result = canonicalize(input);

      assert.strictEqual(
        result,
        ['Line1', '  Indented line', '    Mixed tab spaces', '  Already spaced'].join('\n')
      );
      assert.strictEqual(result.includes('\t'), false);
    });

    it('应该移除行尾多余空格同时保留缩进', () => {
      const input = ['Return value   ', '  Next line   '].join('\n');
      const result = canonicalize(input);

      assert.strictEqual(result, ['Return value', '  Next line'].join('\n'));
    });
  });

  describe('标点与空格规范', () => {
    it('应该移除标点前多余空格', () => {
      const input = 'Return  value ,  next : item !  Should we ?';
      const result = canonicalize(input);

      assert.strictEqual(result, 'Return value, next: item! Should we?');
    });
  });

  describe('引号处理', () => {
    it('应该将智能引号转换为直引号并保留转义', () => {
      const input = 'Return “smart” and ‘single’ plus "escaped \\"quote\\"".';
      const result = canonicalize(input);

      assert.strictEqual(result, 'Return "smart" and \'single\' plus "escaped \\"quote\\"".');
    });
  });

  describe('字符串分段保护', () => {
    it('应该避免字符串内部空白被规范化', () => {
      const input = 'Return " spaced , punctuation " and the value , please.';
      const result = canonicalize(input);

      assert.strictEqual(result, 'Return " spaced , punctuation " and value, please.');
      assert.strictEqual(result.includes('" spaced , punctuation "'), true);
    });
  });

  describe('幂等性', () => {
    it('应该在重复规范化后保持不变', () => {
      const input = ['Module Example.', 'Return  value ,  next.', '  Next line   '].join('\n');
      const once = canonicalize(input);
      const twice = canonicalize(once);

      assert.strictEqual(twice, once);
    });
  });

  describe('换行符规范', () => {
    it('应该将 CRLF 转换为 LF', () => {
      const input = ['Line1', 'Line2', 'Line3'].join('\r\n') + '\r\n';
      const result = canonicalize(input);

      assert.strictEqual(result, ['Line1', 'Line2', 'Line3', ''].join('\n'));
      assert.strictEqual(result.includes('\r'), false);
    });

    it('应该将混合换行符统一为 LF', () => {
      const input = 'LineA\rLineB\r\nLineC\nLineD';
      const result = canonicalize(input);

      assert.strictEqual(result, ['LineA', 'LineB', 'LineC', 'LineD'].join('\n'));
      assert.strictEqual(result.includes('\r'), false);
    });
  });

  describe('关键字大小写扩展', () => {
    it('应该统一多词关键字的大小写', () => {
      const input = ['MODULE Sample.', 'WAIT FOR OPTION OF value.', 'ERR OF Issue.'].join('\n');
      const result = canonicalize(input);

      // 单词关键字（MODULE）不被 canonicalizer 处理
      assert.strictEqual(result, ['MODULE Sample.', 'wait for option of value.', 'err of Issue.'].join('\n'));
    });

    it('应该在多行语句中保持关键字规范化', () => {
      const input = ['It PERFORMS duty.', 'MODULE Example.', 'WAIT FOR option OF value.'].join('\n');
      const result = canonicalize(input);

      // 多词关键字 "it performs" 被小写化，单词关键字 MODULE 不变
      assert.strictEqual(result, ['it performs duty.', 'MODULE Example.', 'wait for option of value.'].join('\n'));
    });
  });

  describe('注释边界扩展', () => {
    it('应该移除连续多行注释并保留空行', () => {
      const input = ['# outer comment', '  // inner comment', 'Return value.'].join('\n');
      const result = canonicalize(input);

      assert.strictEqual(result, ['','Return value.'].join('\n'));
      assert.strictEqual(result.includes('comment'), false);
    });

    it('应该处理包含特殊字符的注释', () => {
      const input = ['// 注释包含!@#$%^&*()', 'Return value.'].join('\n');
      const result = canonicalize(input);

      assert.strictEqual(result, ['','Return value.'].join('\n'));
      assert.strictEqual(result.includes('!@#$'), false);
    });

    it('应该保留行尾注释并清理多余空格', () => {
      const input = 'Return value.    // trailing comment';
      const result = canonicalize(input);

      assert.strictEqual(result, 'Return value. // trailing comment');
    });

    it('应该保留字符串中的注释符号', () => {
      const input = 'Return "// not comment" and "# still string".';
      const result = canonicalize(input);

      assert.strictEqual(result, 'Return "// not comment" and "# still string".');
    });
  });

  describe('缩进与空白扩展', () => {
    it('应该将混合缩进转换为两个空格单位', () => {
      const input = ['\tLine one', ' \tLine two', '  \t Line three'].join('\n');
      const result = canonicalize(input);

      assert.strictEqual(result, ['  Line one', '   Line two', '     Line three'].join('\n'));
    });

    it('应该转换行内制表符并保持标点规范', () => {
      const input = 'Return\tvalue ,\tplease.';
      const result = canonicalize(input);

      assert.strictEqual(result, 'Return value, please.');
      assert.strictEqual(result.includes('\t'), false);
    });

    it('应该移除仅包含空白的行尾空格', () => {
      const input = ['Line1', '   ', 'Line2'].join('\n');
      const result = canonicalize(input);
      const lines = result.split('\n');

      assert.strictEqual(lines[1], '');
      assert.strictEqual(result, ['Line1', '', 'Line2'].join('\n'));
    });

    it('应该清理多余空行中的空白字符', () => {
      const input = ['LineA', '  ', '', '   ', 'LineB'].join('\n');
      const result = canonicalize(input);
      const lines = result.split('\n');

      assert.strictEqual(lines.length, 3);
      assert.strictEqual(lines[1], '');
      assert.strictEqual(result, ['LineA', '', 'LineB'].join('\n'));
    });
  });

  describe('字符串字面量扩展', () => {
    it('应该保留嵌套引号结构', () => {
      const input = 'Return "He said \\"Hello\\" and \'hi\'" and \'others\'.';
      const result = canonicalize(input);

      assert.strictEqual(result, 'Return "He said \\"Hello\\" and \'hi\'" and \'others\'.');
    });

    it('应该保留字符串中的转义字符', () => {
      const input = 'Return "path\\\\to\\\\file and \\t tab".';
      const result = canonicalize(input);

      assert.strictEqual(result, 'Return "path\\\\to\\\\file and \\t tab".');
    });

    it('应该允许多行字符串块保持原样', () => {
      const input = ['Return "first line', '  second line', 'third line".'].join('\n');
      const result = canonicalize(input);

      assert.strictEqual(result, ['Return "first line', '  second line', 'third line".'].join('\n'));
    });
  });

  describe('Unicode 字符处理', () => {
    it('应该保留 Unicode 内容', () => {
      const input = 'Return "火花 🚀".';
      const result = canonicalize(input);

      assert.strictEqual(result, 'Return "火花 🚀".');
    });
  });

  describe('结构保持', () => {
    it('应该保留语句关键结构与缩进', () => {
      const input = ['Rule greet produce Text:', '\tReturn value.'].join('\r\n');
      const result = canonicalize(input);

      assert.strictEqual(result, ['Rule greet produce Text:', '  Return value.'].join('\n'));
    });
  });

  describe('组合场景', () => {
    it('应该在组合场景下完成规范化', () => {
      const input = ['MODULE Sample', '\tWait FOR Option OF value , please.', '# comment', 'Return "Tab\tInside".'].join(
        '\r\n'
      );
      const result = canonicalize(input);

      // 单词 MODULE 不被 canonicalizer 小写化
      assert.strictEqual(
        result,
        ['MODULE Sample', '  wait for option of value, please.', '', 'Return "Tab  Inside".'].join('\n')
      );
    });
  });
});
