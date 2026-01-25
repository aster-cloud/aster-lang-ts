/**
 * @module test/unit/keyword-translator.test
 *
 * 关键词翻译器单元测试。
 *
 * 验证中文关键词能被正确翻译为英文关键词，
 * 以支持完整的中文 CNL 编译流程。
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  createKeywordTranslator,
  buildKeywordTranslationIndex,
  buildFullTranslationIndex,
  translateToken,
  translateTokens,
  needsKeywordTranslation,
} from '../../src/frontend/keyword-translator.js';
import { canonicalize } from '../../src/frontend/canonicalizer.js';
import { lex } from '../../src/frontend/lexer.js';
import { parse } from '../../src/parser.js';
import { ZH_CN } from '../../src/config/lexicons/zh-CN.js';
import { EN_US } from '../../src/config/lexicons/en-US.js';
import { TokenKind } from '../../src/frontend/tokens.js';
import type { Token } from '../../src/types.js';

describe('关键词翻译器', () => {
  describe('buildKeywordTranslationIndex', () => {
    it('应构建 zh-CN 到 en-US 的翻译索引', () => {
      const index = buildKeywordTranslationIndex(ZH_CN, EN_US);

      // 验证控制流关键词（普通关键词，不含【】）
      assert.strictEqual(index.get('若'), 'if');
      assert.strictEqual(index.get('返回'), 'return');
      assert.strictEqual(index.get('否则'), 'otherwise');
      assert.strictEqual(index.get('令'), 'let');
      assert.strictEqual(index.get('为'), 'be');

      // 验证普通类型定义关键词（不含【】）
      assert.strictEqual(index.get('包含'), 'with');

      // 验证函数定义关键词
      // 注意: '【函数】' 是标记关键词，在 markerIndex 中而不是 index 中
      assert.strictEqual(index.get('产出'), 'produce');

      // 验证类型关键词
      assert.strictEqual(index.get('整数'), 'int');
      assert.strictEqual(index.get('文本'), 'text');
      assert.strictEqual(index.get('布尔'), 'bool');

      // 验证布尔字面量
      assert.strictEqual(index.get('真'), 'true');
      assert.strictEqual(index.get('假'), 'false');
      assert.strictEqual(index.get('空'), 'null');
    });

    it('应支持大小写不敏感的映射', () => {
      const index = buildKeywordTranslationIndex(ZH_CN, EN_US);

      // 中文关键词没有大小写问题，但英文关键词应保持原始大小写
      assert.strictEqual(index.get('若'), 'if');
    });

    it('对相同词法表应返回空索引', () => {
      const index = buildKeywordTranslationIndex(EN_US, EN_US);
      assert.strictEqual(index.size, 0);
    });
  });

  describe('buildFullTranslationIndex', () => {
    it('应构建普通关键词和标记关键词的完整索引', () => {
      const { index, markerIndex } = buildFullTranslationIndex(ZH_CN, EN_US);

      // 验证普通关键词在 index 中
      assert.strictEqual(index.get('若'), 'if');
      assert.strictEqual(index.get('返回'), 'return');
      assert.strictEqual(index.get('包含'), 'with');

      // 验证标记关键词在 markerIndex 中（不含【】的内部值）
      assert.strictEqual(markerIndex.get('定义'), 'define');
      assert.strictEqual(markerIndex.get('模块'), 'this module is');
      assert.strictEqual(markerIndex.get('流程'), 'workflow');
      assert.strictEqual(markerIndex.get('步骤'), 'step');
    });
  });

  describe('needsKeywordTranslation', () => {
    it('zh-CN 到 en-US 需要翻译', () => {
      assert.strictEqual(needsKeywordTranslation(ZH_CN, EN_US), true);
    });

    it('en-US 到 en-US 不需要翻译', () => {
      assert.strictEqual(needsKeywordTranslation(EN_US, EN_US), false);
    });

    it('默认目标为 en-US', () => {
      assert.strictEqual(needsKeywordTranslation(ZH_CN), true);
      assert.strictEqual(needsKeywordTranslation(EN_US), false);
    });
  });

  describe('translateToken', () => {
    it('应翻译 IDENT 类型的关键词 token', () => {
      const index = buildKeywordTranslationIndex(ZH_CN, EN_US);
      const token: Token = {
        kind: TokenKind.IDENT,
        value: '若',
        start: { line: 1, col: 1 },
        end: { line: 1, col: 2 },
      };

      const translated = translateToken(token, index);
      assert.strictEqual(translated.value, 'if');
      assert.strictEqual(translated.kind, TokenKind.IDENT);
    });

    it('应保持非关键词 token 不变', () => {
      const index = buildKeywordTranslationIndex(ZH_CN, EN_US);
      const token: Token = {
        kind: TokenKind.IDENT,
        value: '驾驶员', // 不是关键词，是标识符
        start: { line: 1, col: 1 },
        end: { line: 1, col: 4 },
      };

      const translated = translateToken(token, index);
      assert.strictEqual(translated.value, '驾驶员');
    });

    it('应保持非 IDENT 类型 token 不变', () => {
      const index = buildKeywordTranslationIndex(ZH_CN, EN_US);
      const token: Token = {
        kind: TokenKind.INT,
        value: 42,
        start: { line: 1, col: 1 },
        end: { line: 1, col: 3 },
      };

      const translated = translateToken(token, index);
      assert.strictEqual(translated.value, 42);
      assert.strictEqual(translated.kind, TokenKind.INT);
    });
  });

  describe('translateTokens', () => {
    it('应翻译 token 数组中的所有关键词', () => {
      const index = buildKeywordTranslationIndex(ZH_CN, EN_US);
      const tokens: Token[] = [
        { kind: TokenKind.IDENT, value: '若', start: { line: 1, col: 1 }, end: { line: 1, col: 2 } },
        { kind: TokenKind.IDENT, value: 'x', start: { line: 1, col: 3 }, end: { line: 1, col: 4 } },
        { kind: TokenKind.COLON, value: ':', start: { line: 1, col: 5 }, end: { line: 1, col: 6 } },
        { kind: TokenKind.IDENT, value: '返回', start: { line: 1, col: 7 }, end: { line: 1, col: 9 } },
      ];

      const translated = translateTokens(tokens, index);
      assert.strictEqual(translated[0]!.value, 'if');
      assert.strictEqual(translated[1]!.value, 'x');
      assert.strictEqual(translated[2]!.kind, TokenKind.COLON);
      assert.strictEqual(translated[3]!.value, 'return');
    });

    it('不应修改原数组', () => {
      const index = buildKeywordTranslationIndex(ZH_CN, EN_US);
      const original: Token[] = [
        { kind: TokenKind.IDENT, value: '若', start: { line: 1, col: 1 }, end: { line: 1, col: 2 } },
      ];

      translateTokens(original, index);
      assert.strictEqual(original[0]!.value, '若');
    });
  });

  describe('createKeywordTranslator', () => {
    it('应创建完整的翻译器对象', () => {
      const translator = createKeywordTranslator(ZH_CN);

      assert.ok(translator.index instanceof Map);
      assert.strictEqual(typeof translator.translateToken, 'function');
      assert.strictEqual(typeof translator.translateTokens, 'function');
      assert.strictEqual(typeof translator.hasTranslation, 'function');
      assert.strictEqual(typeof translator.getTranslation, 'function');
    });

    it('hasTranslation 应正确判断', () => {
      const translator = createKeywordTranslator(ZH_CN);

      assert.strictEqual(translator.hasTranslation('若'), true);
      assert.strictEqual(translator.hasTranslation('返回'), true);
      assert.strictEqual(translator.hasTranslation('驾驶员'), false);
      assert.strictEqual(translator.hasTranslation('if'), false); // 英文关键词不在翻译索引中
    });

    it('getTranslation 应返回正确的翻译', () => {
      const translator = createKeywordTranslator(ZH_CN);

      assert.strictEqual(translator.getTranslation('若'), 'if');
      assert.strictEqual(translator.getTranslation('返回'), 'return');
      assert.strictEqual(translator.getTranslation('驾驶员'), undefined);
    });
  });

  describe('完整编译流程集成', () => {
    it('应能解析翻译后的中文 CNL 简单返回语句', () => {
      // 中文源代码 - 使用 【函数】 标记关键词
      const zhSource = '【函数】 identity 包含 id，产出：\n  返回 id。';

      // 步骤 1: 规范化
      const canonical = canonicalize(zhSource, ZH_CN);

      // 步骤 2: 词法分析
      const tokens = lex(canonical, ZH_CN);

      // 步骤 3: 关键词翻译
      const translator = createKeywordTranslator(ZH_CN);
      const translatedTokens = translator.translateTokens(tokens);

      // 验证关键词已翻译
      const typeIdentTokens = translatedTokens.filter(t => t.kind === TokenKind.TYPE_IDENT);
      const hasTo = typeIdentTokens.some(t => t.value === 'to');
      const identTokens = translatedTokens.filter(t => t.kind === TokenKind.IDENT);
      const hasWith = identTokens.some(t => t.value === 'with');
      const hasProduce = identTokens.some(t => t.value === 'produce');
      const hasReturn = identTokens.some(t => t.value === 'return');

      assert.ok(hasTo, '应有翻译后的 "to" 关键词（TYPE_IDENT）');
      assert.ok(hasWith, '应有翻译后的 "with" 关键词');
      assert.ok(hasProduce, '应有翻译后的 "produce" 关键词');
      assert.ok(hasReturn, '应有翻译后的 "return" 关键词');

      // 步骤 4: 解析（使用翻译后的 token）
      const ast = parse(translatedTokens);

      // 验证 AST 结构
      assert.ok(ast, '应生成 AST');
      assert.ok(ast.decls.length > 0, '应有声明');
    });

    it('应能解析翻译后的中文 CNL 类型定义', () => {
      // 中文类型定义
      const zhSource = '【定义】 Driver 包含 age：整数。';

      // 完整编译流程
      const canonical = canonicalize(zhSource, ZH_CN);
      const tokens = lex(canonical, ZH_CN);
      const translator = createKeywordTranslator(ZH_CN);
      const translatedTokens = translator.translateTokens(tokens);

      // 验证关键词翻译
      // 标记关键词【定义】被合并为 TYPE_IDENT token
      const typeIdentTokens = translatedTokens.filter(t => t.kind === TokenKind.TYPE_IDENT);
      const hasDefine = typeIdentTokens.some(t => t.value === 'define');

      // 普通关键词保持为 IDENT token
      const identTokens = translatedTokens.filter(t => t.kind === TokenKind.IDENT);
      const hasWith = identTokens.some(t => t.value === 'with');
      const hasInt = identTokens.some(t => t.value === 'int');

      assert.ok(hasDefine, '应有翻译后的 "define" 关键词（TYPE_IDENT）');
      assert.ok(hasWith, '应有翻译后的 "with" 关键词');
      assert.ok(hasInt, '应有翻译后的 "int" 类型');

      // 解析
      const ast = parse(translatedTokens);
      assert.ok(ast, '应生成 AST');

      // 验证类型定义
      const dataDef = ast.decls.find(d => d.kind === 'Data');
      assert.ok(dataDef, '应有 Data 类型定义');
    });

    it('应能解析翻译后的中文 CNL If 语句', () => {
      // 中文 If 语句 - 使用 【函数】 标记关键词
      const zhSource = `【函数】 check 包含 x，产出：
  若 1 小于 2：
    返回 1。
  返回 0。`;

      // 完整编译流程
      const canonical = canonicalize(zhSource, ZH_CN);
      const tokens = lex(canonical, ZH_CN);
      const translator = createKeywordTranslator(ZH_CN);
      const translatedTokens = translator.translateTokens(tokens);

      // 验证关键词翻译
      const identTokens = translatedTokens.filter(t => t.kind === TokenKind.IDENT);
      const hasIf = identTokens.some(t => t.value === 'if');
      const hasReturn = identTokens.some(t => t.value === 'return');

      assert.ok(hasIf, '应有翻译后的 "if" 关键词');
      assert.ok(hasReturn, '应有翻译后的 "return" 关键词');

      // 解析
      const ast = parse(translatedTokens);
      assert.ok(ast, '应生成 AST');
    });

    it('英文 CNL 不受影响', () => {
      // 英文源代码
      const enSource = 'To id, produce Int:\n  Return 1.';

      // 完整编译流程（英文不需要翻译，但测试流程不会出错）
      const canonical = canonicalize(enSource, EN_US);
      const tokens = lex(canonical, EN_US);

      // 英文不需要翻译
      assert.strictEqual(needsKeywordTranslation(EN_US), false);

      // 直接解析
      const ast = parse(tokens);
      assert.ok(ast, '应生成 AST');
      assert.ok(ast.decls.length > 0, '应有声明');
    });
  });
});
