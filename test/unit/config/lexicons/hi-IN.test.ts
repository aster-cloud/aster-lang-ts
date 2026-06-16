// hi-IN（Hindi / 天城文）端到端编译冒烟测试。
//
// 验证第四语种（ADR 0017 Phase 2 的 2a）在 TS 引擎里可用：
// 用注册的 HI_IN 词法表把真实的 Hindi CNL 源码一路编译到 Core IR。
// 这些样本沿用 Phase 0 POC 已验证过的三段策略（定价 / 信贷 / 算术），
// 区别在于：此处用的是 @generated 的生产词法表 HI_IN（从 core 导出），
// 而非 POC 手写的一次性 HI_IN_POC。
//
// 比较用 `से अधिक`(greater than) / `से कम`(less than) / `बराबर`(equals to)
// 这类已实现的关键词，不依赖 `है`(is) 的裸比较语义。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { compile } from '../../../../src/browser.js';
import { HI_IN } from '../../../../src/config/lexicons/hi-IN.js';
import { LexiconRegistry, initializeAllBundledLexicons } from '../../../../src/config/lexicons/index.js';

describe('hi-IN（Hindi/天城文）第四语种', () => {
  // 与 i18n 套件一样，需显式注册全部内置语言（initializeDefaultLexicons 仅 en-US）
  initializeAllBundledLexicons();

  describe('词法表注册', () => {
    it('hi-IN 应已注册且 id 正确', () => {
      assert.ok(LexiconRegistry.has('hi-IN'), 'hi-IN 应已注册');
      const lex = LexiconRegistry.get('hi-IN');
      assert.ok(lex, 'hi-IN 应可获取');
      assert.equal(lex.id, 'hi-IN');
    });

    it('句末符应为天城文 danda（।）而非 ASCII 句点', () => {
      assert.equal(HI_IN.punctuation.statementEnd, '।');
    });

    it('关键词应为天城文（mod_decl / func / if / return）', () => {
      assert.equal(HI_IN.keywords.MODULE_DECL, 'मॉड्यूल');
      assert.equal(HI_IN.keywords.FUNC_TO, 'नियम');
      assert.equal(HI_IN.keywords.IF, 'यदि');
      assert.equal(HI_IN.keywords.RETURN, 'लौटाएं');
    });
  });

  describe('端到端编译到 Core IR', () => {
    it('定价规则（greater than 比较 + 算术）应编译成功', () => {
      const source = [
        'मॉड्यूल pricing।',
        '',
        'नियम discountedPrice दिया गया amount रूप में पूर्णांक, उत्पन्न पूर्णांक:',
        '  यदि amount से अधिक 100',
        '    लौटाएं amount गुणा 80 भाग 100।',
        '  लौटाएं amount।',
      ].join('\n');

      const result = compile(source, { lexicon: HI_IN });
      assert.ok(result.success, `应编译成功，错误：${JSON.stringify(result.parseErrors ?? result.loweringErrors)}`);
      assert.ok(result.core, '应产出 Core IR');
    });

    it('信贷规则（struct + 字段访问 + 布尔返回）应编译成功', () => {
      const source = [
        'मॉड्यूल loan।',
        '',
        'परिभाषित Applicant रखता है creditScore रूप में पूर्णांक, income रूप में पूर्णांक।',
        '',
        'नियम approve दिया गया a रूप में Applicant, उत्पन्न बूलियन:',
        '  यदि a.creditScore से अधिक 700',
        '    लौटाएं सत्य।',
        '  लौटाएं असत्य।',
      ].join('\n');

      const result = compile(source, { lexicon: HI_IN });
      assert.ok(result.success, `应编译成功，错误：${JSON.stringify(result.parseErrors ?? result.loweringErrors)}`);
      assert.ok(result.core, '应产出 Core IR');
    });

    it('算术规则（let 绑定 + 减法 + less than）应编译成功', () => {
      const source = [
        'मॉड्यूल calc।',
        '',
        'नियम net दिया गया gross रूप में पूर्णांक, tax रूप में पूर्णांक, उत्पन्न पूर्णांक:',
        '  मानें result हो gross घटा tax।',
        '  यदि result से कम 0',
        '    लौटाएं 0।',
        '  लौटाएं result।',
      ].join('\n');

      const result = compile(source, { lexicon: HI_IN });
      assert.ok(result.success, `应编译成功，错误：${JSON.stringify(result.parseErrors ?? result.loweringErrors)}`);
      assert.ok(result.core, '应产出 Core IR');
    });
  });
});
