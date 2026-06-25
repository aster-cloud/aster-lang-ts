/**
 * @module test/unit/keyword-translator.test
 *
 * 关键词翻译器单元测试。
 *
 * 验证中文关键词能被正确翻译为英文关键词，
 * 以支持完整的中文 CNL 编译流程。
 */

import { describe, it } from 'node:test';
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

// en-US 显式去掉 aliases 字段（ADR 0022）：下列"同词表无需翻译/空索引"断言测规范路径。
// builtin EN_US 本身无 aliases（方案 A 已撤）；这里**删除属性**而非置 undefined，否则
// exactOptionalPropertyTypes 下 {aliases:undefined} 不是合法 Lexicon→tsc 报错。
// 用辅助函数删键，避免解构产生未用绑定（lint no-unused-vars）。
function withoutAliases(lex: typeof EN_US): typeof EN_US {
  const copy = { ...lex };
  delete (copy as { aliases?: unknown }).aliases;
  return copy;
}
const EN_NO_ALIAS = withoutAliases(EN_US);

describe('关键词翻译器', () => {
  describe('buildKeywordTranslationIndex', () => {
    it('应构建 zh-CN 到 en-US 的翻译索引（v2 关键字）', () => {
      const index = buildKeywordTranslationIndex(ZH_CN, EN_US);

      // 验证控制流关键词
      assert.strictEqual(index.get('如果'), 'If');
      assert.strictEqual(index.get('匹配于'), 'Match'); // v2: MATCH 关键字
      assert.strictEqual(index.get('当'), 'When');       // v2: WHEN 关键字（与 BE 不再共享）
      assert.strictEqual(index.get('定义为'), 'be');      // v2: BE 关键字
      assert.strictEqual(index.get('返回'), 'Return');
      assert.strictEqual(index.get('否则'), 'Otherwise');
      assert.strictEqual(index.get('令'), 'Let');

      // 验证普通类型定义关键词
      assert.strictEqual(index.get('包含'), 'with');

      // 验证函数定义关键词
      assert.strictEqual(index.get('产出'), 'produce');

      // 验证类型关键词
      assert.strictEqual(index.get('整数'), 'Int');
      assert.strictEqual(index.get('文本'), 'Text');
      assert.strictEqual(index.get('布尔'), 'Bool');

      // 验证布尔字面量（v2: 真值 / 假值 / 空值）
      assert.strictEqual(index.get('真值'), 'true');
      assert.strictEqual(index.get('假值'), 'false');
      assert.strictEqual(index.get('空值'), 'null');
    });

    it('应支持大小写不敏感的映射', () => {
      const index = buildKeywordTranslationIndex(ZH_CN, EN_US);

      // 中文关键词没有大小写问题，但英文关键词应保持原始大小写
      assert.strictEqual(index.get('如果'), 'If');
    });

    it('对相同词法表（无别名）应返回空索引', () => {
      const index = buildKeywordTranslationIndex(EN_NO_ALIAS, EN_NO_ALIAS);
      assert.strictEqual(index.size, 0);
    });
  });

  describe('buildFullTranslationIndex', () => {
    it('应构建普通关键词的完整索引', () => {
      const { index, markerIndex } = buildFullTranslationIndex(ZH_CN, EN_US);

      // 验证普通关键词在 index 中（v2 关键字）
      assert.strictEqual(index.get('如果'), 'If');
      assert.strictEqual(index.get('匹配于'), 'Match');
      assert.strictEqual(index.get('返回'), 'Return');
      assert.strictEqual(index.get('包含'), 'with');

      // 中文不再使用【】标记，所有关键词都在 index 中
      assert.strictEqual(index.get('定义'), 'Define');
      assert.strictEqual(index.get('模块'), 'Module');
      assert.strictEqual(index.get('流程'), 'workflow');
      assert.strictEqual(index.get('步骤'), 'step');

      // markerIndex 应为空（中文无标记符号）
      assert.strictEqual(markerIndex.size, 0);
    });
  });

  describe('needsKeywordTranslation', () => {
    it('zh-CN 到 en-US 需要翻译', () => {
      assert.strictEqual(needsKeywordTranslation(ZH_CN, EN_US), true);
    });

    it('en-US（无别名）到 en-US 不需要翻译', () => {
      assert.strictEqual(needsKeywordTranslation(EN_NO_ALIAS, EN_NO_ALIAS), false);
    });

    it('en-US 注入别名时需要翻译（把别名归一成规范拼写，ADR 0022 方案 D）', () => {
      // 官方 builtin 无别名（方案 A 已回滚）；别名经方案 D 编译期注入。注入了别名的
      // 英文 lexicon 必须走翻译，才能把别名归一成规范拼写。
      const enWithAlias = { ...EN_US, aliases: { TIMES: ['multiplied by'] } };
      assert.strictEqual(needsKeywordTranslation(enWithAlias, EN_US), true);
    });

    it('默认目标为 en-US', () => {
      assert.strictEqual(needsKeywordTranslation(ZH_CN), true);
      assert.strictEqual(needsKeywordTranslation(EN_NO_ALIAS), false);
    });
  });

  describe('translateToken', () => {
    it('应翻译 IDENT 类型的关键词 token', () => {
      const index = buildKeywordTranslationIndex(ZH_CN, EN_US);
      const token: Token = {
        kind: TokenKind.IDENT,
        value: '如果',
        start: { line: 1, col: 1 },
        end: { line: 1, col: 2 },
      };

      const translated = translateToken(token, index);
      assert.strictEqual(translated.value, 'If');
      assert.strictEqual(translated.kind, TokenKind.TYPE_IDENT);
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
        { kind: TokenKind.IDENT, value: '如果', start: { line: 1, col: 1 }, end: { line: 1, col: 2 } },
        { kind: TokenKind.IDENT, value: 'x', start: { line: 1, col: 3 }, end: { line: 1, col: 4 } },
        { kind: TokenKind.COLON, value: ':', start: { line: 1, col: 5 }, end: { line: 1, col: 6 } },
        { kind: TokenKind.IDENT, value: '返回', start: { line: 1, col: 7 }, end: { line: 1, col: 9 } },
      ];

      const translated = translateTokens(tokens, index);
      assert.strictEqual(translated[0]!.value, 'If');
      assert.strictEqual(translated[1]!.value, 'x');
      assert.strictEqual(translated[2]!.kind, TokenKind.COLON);
      assert.strictEqual(translated[3]!.value, 'Return');
    });

    it('不应修改原数组', () => {
      const index = buildKeywordTranslationIndex(ZH_CN, EN_US);
      const original: Token[] = [
        { kind: TokenKind.IDENT, value: '如果', start: { line: 1, col: 1 }, end: { line: 1, col: 2 } },
      ];

      translateTokens(original, index);
      assert.strictEqual(original[0]!.value, '如果');
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

    it('hasTranslation 应正确判断（v2 关键字）', () => {
      const translator = createKeywordTranslator(ZH_CN);

      assert.strictEqual(translator.hasTranslation('如果'), true);
      assert.strictEqual(translator.hasTranslation('匹配于'), true);
      assert.strictEqual(translator.hasTranslation('返回'), true);
      assert.strictEqual(translator.hasTranslation('驾驶员'), false);
      assert.strictEqual(translator.hasTranslation('if'), false); // 英文关键词不在翻译索引中
    });

    it('getTranslation 应返回正确的翻译（v2 关键字）', () => {
      const translator = createKeywordTranslator(ZH_CN);

      assert.strictEqual(translator.getTranslation('如果'), 'If');
      assert.strictEqual(translator.getTranslation('匹配于'), 'Match');
      assert.strictEqual(translator.getTranslation('返回'), 'Return');
      assert.strictEqual(translator.getTranslation('驾驶员'), undefined);
    });
  });

  describe('完整编译流程集成', () => {
    it('应能解析翻译后的中文 CNL 简单返回语句', () => {
      // 中文源代码 - 使用 规则 关键词
      const zhSource = '规则 identity 包含 id，产出：\n  返回 id。';

      // 步骤 1: 规范化
      const canonical = canonicalize(zhSource, ZH_CN);

      // 步骤 2: 词法分析
      const tokens = lex(canonical, ZH_CN);

      // 步骤 3: 关键词翻译
      const translator = createKeywordTranslator(ZH_CN);
      const translatedTokens = translator.translateTokens(tokens);

      // 验证关键词已翻译（翻译值来自 Java 源 en-US lexicon）
      const allTokens = translatedTokens;
      const hasRule = allTokens.some(t => (t.value as string)?.toLowerCase() === 'rule');
      const hasWith = allTokens.some(t => (t.value as string)?.toLowerCase() === 'with');
      const hasProduce = allTokens.some(t => (t.value as string)?.toLowerCase() === 'produce');
      const hasReturn = allTokens.some(t => (t.value as string)?.toLowerCase() === 'return');

      assert.ok(hasRule, '应有翻译后的 "Rule" 关键词');
      assert.ok(hasWith, '应有翻译后的 "with" 关键词');
      assert.ok(hasProduce, '应有翻译后的 "produce" 关键词');
      assert.ok(hasReturn, '应有翻译后的 "Return" 关键词');

      // 步骤 4: 解析（使用翻译后的 token）
      const ast = parse(translatedTokens).ast;

      // 验证 AST 结构
      assert.ok(ast, '应生成 AST');
      assert.ok(ast.decls.length > 0, '应有声明');
    });

    it('应能解析翻译后的中文 CNL 类型定义', () => {
      // 中文类型定义
      const zhSource = '定义 Driver 包含 age 作为 整数。';

      // 完整编译流程
      const canonical = canonicalize(zhSource, ZH_CN);
      const tokens = lex(canonical, ZH_CN);
      const translator = createKeywordTranslator(ZH_CN);
      const translatedTokens = translator.translateTokens(tokens);

      // 验证关键词翻译（翻译值来自 Java 源 en-US lexicon）
      const allTokens = translatedTokens;
      const hasDefine = allTokens.some(t => (t.value as string)?.toLowerCase() === 'define');
      const hasWith = allTokens.some(t => (t.value as string)?.toLowerCase() === 'with');
      const hasInt = allTokens.some(t => (t.value as string)?.toLowerCase() === 'int');

      assert.ok(hasDefine, '应有翻译后的 "Define" 关键词');
      assert.ok(hasWith, '应有翻译后的 "with" 关键词');
      assert.ok(hasInt, '应有翻译后的 "Int" 类型');

      // 解析
      const ast = parse(translatedTokens).ast;
      assert.ok(ast, '应生成 AST');

      // 验证类型定义
      const dataDef = ast.decls.find(d => d.kind === 'Data');
      assert.ok(dataDef, '应有 Data 类型定义');
    });

    it('应能解析翻译后的中文 CNL If 语句', () => {
      // 中文 If 语句 - 使用 规则 标记关键词
      const zhSource = `规则 check 包含 x，产出：
  如果 1 小于 2
    返回 1。
  返回 0。`;

      // 完整编译流程
      const canonical = canonicalize(zhSource, ZH_CN);
      const tokens = lex(canonical, ZH_CN);
      const translator = createKeywordTranslator(ZH_CN);
      const translatedTokens = translator.translateTokens(tokens);

      // 验证关键词翻译（使用大小写不敏感比较，值来自 Java 源 en-US lexicon）
      const identTokens = translatedTokens.filter(t => t.kind === TokenKind.IDENT || t.kind === TokenKind.TYPE_IDENT);
      const hasIf = identTokens.some(t => (t.value as string)?.toLowerCase() === 'if');
      const hasReturn = identTokens.some(t => (t.value as string)?.toLowerCase() === 'return');

      assert.ok(hasIf, '应有翻译后的 "If" 关键词');
      assert.ok(hasReturn, '应有翻译后的 "Return" 关键词');

      // 解析
      const ast = parse(translatedTokens).ast;
      assert.ok(ast, '应生成 AST');
    });

    it('英文 CNL 不受影响（规范路径，无别名）', () => {
      // 英文源代码
      const enSource = 'Rule id, produce Int:\n  Return 1.';

      // 完整编译流程（无别名英文不需要翻译，测试流程不会出错）
      const canonical = canonicalize(enSource, EN_NO_ALIAS);
      const tokens = lex(canonical, EN_NO_ALIAS);

      // 无别名英文不需要翻译
      assert.strictEqual(needsKeywordTranslation(EN_NO_ALIAS), false);

      // 直接解析
      const ast = parse(tokens).ast;
      assert.ok(ast, '应生成 AST');
      assert.ok(ast.decls.length > 0, '应有声明');
    });
  });
});
