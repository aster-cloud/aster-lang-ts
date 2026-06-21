import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import {
  vocabularyRegistry,
  initBuiltinVocabularies,
} from '../../../src/config/lexicons/identifiers/registry.js';
import { IdentifierKind } from '../../../src/config/lexicons/identifiers/types.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';

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

    // 标识符保护：a/an/the 当参数名/变量名时不应被当冠词吞掉。
    // 判据：冠词后紧跟声明关键字 as、运算符词、多词关键字、逗号/句末时它是标识符。
    it('a/an/the 作参数名（后跟 as）不应被吞', () => {
      assert.strictEqual(
        canonicalize('given a as Int, b as Int'),
        'given a as Int, b as Int',
      );
      assert.strictEqual(
        canonicalize('given the as Int, an as Text'),
        'given the as Int, an as Text',
      );
    });

    it('a 在参数列表（后跟逗号）不应被吞', () => {
      assert.strictEqual(canonicalize('given a, b, c'), 'given a, b, c');
    });

    it('a/the 作操作数（后跟单词运算符或多词运算符）不应被吞', () => {
      assert.strictEqual(canonicalize('Return a plus b.'), 'Return a plus b.');
      assert.strictEqual(canonicalize('Return the plus an.'), 'Return the plus an.');
      assert.strictEqual(
        canonicalize('Return a equals to 1 or b equals to 2 and c equals to 3.'),
        'Return a equals to 1 or b equals to 2 and c equals to 3.',
      );
    });

    it('冠词后紧跟句末（无修饰名词）不应被吞', () => {
      assert.strictEqual(canonicalize('Return a.'), 'Return a.');
    });

    it('行末孤立标识符（无句末点）不应被吞——\\n 锚点与 EOF', () => {
      // 多行：a/the/an 在行末后跟 \n
      assert.strictEqual(canonicalize('Let a be 1\nReturn a'), 'Let a be 1\nReturn a');
      assert.strictEqual(canonicalize('Return the\nReturn an'), 'Return the\nReturn an');
      // EOF：整个输入末尾无空格，TS (?=\s) 天然豁免
      assert.strictEqual(canonicalize('Return a'), 'Return a');
    });

    it('真冠词（后跟名词）仍被移除', () => {
      assert.strictEqual(
        canonicalize('define the function to return a value'),
        'define function to return value',
      );
      // 句首冠词移除后留前导空格（既有 TS 行为，靠后续空白规整或 parser 容忍）
      assert.strictEqual(
        canonicalize('a function takes an input and returns the result'),
        ' function takes input and returns result',
      );
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

  describe('租户自定义词汇翻译（ADR 0014 线A）', () => {
    // 租户自定义词汇：把本地化术语 pilot 翻译为规范化 Driver
    const customVocab = {
      id: 'my.custom',
      name: 'Custom',
      locale: 'en-US',
      version: '1.0.0',
      structs: [{ canonical: 'Driver', localized: 'pilot', kind: IdentifierKind.STRUCT }],
      fields: [],
      functions: [],
      enumValues: [],
    };

    beforeEach(() => {
      vocabularyRegistry.clear();
      initBuiltinVocabularies();
      vocabularyRegistry.registerCustom('tenant-42', customVocab);
    });

    afterEach(() => {
      vocabularyRegistry.clear();
    });

    it('提供 tenantId 时应翻译该租户的自定义词汇', () => {
      const result = canonicalize('Return pilot.', {
        domain: 'my.custom',
        locale: 'en-US',
        tenantId: 'tenant-42',
      });

      assert.strictEqual(result, 'Return Driver.');
    });

    it('缺省 tenantId 时仅查内置词汇，自定义词汇不被翻译', () => {
      const result = canonicalize('Return pilot.', {
        domain: 'my.custom',
        locale: 'en-US',
      });

      // my.custom 非内置领域，getWithCustom 回退后查无 → 不翻译
      assert.strictEqual(result, 'Return pilot.');
    });

    it('tenantId 不匹配时回退内置，自定义词汇不被翻译', () => {
      const result = canonicalize('Return pilot.', {
        domain: 'my.custom',
        locale: 'en-US',
        tenantId: 'other-tenant',
      });

      assert.strictEqual(result, 'Return pilot.');
    });

    it('结构体+字段重命名规范化结果与 Java 执行端基线字节一致（跨引擎 parity）', () => {
      // 与 aster-api VocabularyExecutionTest 同一词汇：Fahrer→Driver、alter→age。
      // 断言 TS 规范化产出 = 该测试的 canonical 基线源（Java 据此求值得 42），
      // 锁定两引擎对用户自定义词汇的翻译一致。
      const vocab = {
        id: 'insurance.custom',
        name: 'Custom',
        locale: 'en-US',
        version: 'user',
        structs: [{ canonical: 'Driver', localized: 'Fahrer', kind: IdentifierKind.STRUCT }],
        fields: [{ canonical: 'age', localized: 'alter', kind: IdentifierKind.FIELD, parent: 'Driver' }],
        functions: [],
        enumValues: [],
      };
      vocabularyRegistry.clear();
      initBuiltinVocabularies();
      vocabularyRegistry.registerCustom('t-parity', vocab);

      const localized = [
        'Module insurance.custom.',
        'Define Fahrer has alter as Int.',
        'Rule evaluate given driver as Fahrer, produce Int:',
        '  Return driver.alter.',
      ].join('\n');

      const expectedCanonical = [
        'Module insurance.custom.',
        'Define Driver has age as Int.',
        'Rule evaluate given driver as Driver, produce Int:',
        '  Return driver.age.',
      ].join('\n');

      const result = canonicalize(localized, {
        domain: 'insurance.custom',
        locale: 'en-US',
        tenantId: 't-parity',
      });

      assert.strictEqual(result, expectedCanonical);

      // 大小写不敏感：小写 fahrer/alter 同样翻译（与 Java 引擎等价）。
      const lower = canonicalize('Return fahrer.alter.', {
        domain: 'insurance.custom',
        locale: 'en-US',
        tenantId: 't-parity',
      });
      assert.strictEqual(lower, 'Return Driver.age.');
    });
  });

  describe('德文二合字母转写（只转关键词，不碰标识符）', () => {
    it('用户标识符含 ue/ae 不被转写', () => {
      // fruehereSchaeden 是标识符，不该被错写成 frühereSchäden
      const out = canonicalize('sei fruehereSchaeden gleich 1.', DE_DE);
      assert.ok(out.includes('fruehereSchaeden'), `标识符应保留, 实际: ${out}`);
      assert.ok(!out.includes('frühereSchäden'), `标识符不该被转写, 实际: ${out}`);
    });

    it('关键词 hoechstens 仍转写为 höchstens', () => {
      const out = canonicalize('x hoechstens 5', DE_DE);
      assert.ok(out.includes('höchstens'), `关键词应转写, 实际: ${out}`);
    });

    it('同一行：标识符保留 + 关键词转写', () => {
      const out = canonicalize('wenn fruehereSchaeden hoechstens 5', DE_DE);
      assert.ok(out.includes('fruehereSchaeden'), `标识符保留, 实际: ${out}`);
      assert.ok(out.includes('höchstens'), `关键词转写, 实际: ${out}`);
    });

    it('字符串字面量内的二合字母不被转写', () => {
      const out = canonicalize('gib zurueck "Bonitaet zu niedrig".', DE_DE);
      assert.ok(out.includes('"Bonitaet zu niedrig"'), `字符串内容应保留, 实际: ${out}`);
    });

    it('需多条规则串联的关键词仍成形（groesser→größer）', () => {
      // groesser 经 oe→ö 再 \bgrösser\b→größer 两条规则串联，一次性应用确保不在中间态中断
      const out = canonicalize('wenn x groesser als 5', DE_DE);
      assert.ok(out.includes('größer'), `groesser 应转写为 größer, 实际: ${out}`);
    });

    it('标识符以关键词词开头但整体非关键词不被部分转写', () => {
      // fuer 是关键词词(fuer jedes=for each)，但 fuer_foo/fuer2 是完整标识符，
      // 整 token 才是判定单位，不该被拆出 fuer 误转成 für_foo/für2
      assert.ok(
        canonicalize('sei fuer_foo gleich 1.', DE_DE).includes('fuer_foo'),
        'fuer_foo 应整体保留',
      );
      assert.ok(
        canonicalize('sei fuer2 gleich 1.', DE_DE).includes('fuer2'),
        'fuer2 应整体保留',
      );
      // 但作为独立关键词的 fuer（fuer jedes）仍应转写
      assert.ok(
        canonicalize('fuer jedes x', DE_DE).includes('für'),
        'fuer jedes 关键词应转写为 für',
      );
    });
  });
});
