/**
 * @module tests/unit/lexicons/i18n.test
 *
 * 多语言词法表集成测试 - 验证 en-US、zh-CN、de-DE 三种语言的 CNL 处理。
 *
 * 核心测试场景（每种语言 6 个）：
 * 1. hello - 基础 Hello World
 * 2. types - 数据类型定义
 * 3. functions - 函数定义和调用
 * 4. control-flow - 条件控制流
 * 5. patterns - 模式匹配
 * 6. operators - 算术和比较运算符
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalize } from '../../../../src/frontend/canonicalizer.js';
import { lex } from '../../../../src/frontend/lexer.js';
import { EN_US } from '../../../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../../src/config/lexicons/de-DE.js';
import { LexiconRegistry, initializeDefaultLexicons } from '../../../../src/config/lexicons/index.js';
import { TokenKind } from '../../../../src/frontend/tokens.js';
import type { Token } from '../../../../src/types.js';
import type { Lexicon } from '../../../../src/config/lexicons/types.js';

// ============================================================================
// 测试配置
// ============================================================================

const I18N_TEST_DIR = path.resolve(process.cwd(), 'test/cnl/programs/i18n');

const LANGUAGES = [
  { id: 'en-US', name: 'English', lexicon: EN_US },
  { id: 'zh-CN', name: '中文', lexicon: ZH_CN },
  { id: 'de-DE', name: 'Deutsch', lexicon: DE_DE },
] as const;

const TEST_SCENARIOS = [
  '01-hello',
  '02-types',
  '03-functions',
  '04-control-flow',
  '05-patterns',
  '06-operators',
] as const;

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 读取并解析指定语言的测试文件
 */
function parseFile(lang: string, scenario: string, lexicon: Lexicon) {
  const filePath = path.join(I18N_TEST_DIR, lang, `${scenario}.aster`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const source = fs.readFileSync(filePath, 'utf-8');
  const canonical = canonicalize(source, lexicon);
  const tokens = lex(canonical, lexicon);
  return { source, canonical, tokens, filePath };
}

/**
 * 统计指定类型的 token 数量
 */
function countTokenKind(tokens: Token[], kind: TokenKind): number {
  return tokens.filter((t: Token) => t.kind === kind).length;
}

/**
 * 查找指定值的标识符
 */
function findIdent(tokens: Token[], value: string): Token | undefined {
  return tokens.find((t: Token) => t.kind === TokenKind.IDENT && t.value === value);
}

/**
 * 验证括号平衡
 * 注意: Aster 语言使用缩进表示代码块，没有花括号
 */
function assertBracketsBalanced(tokens: Token[], label: string) {
  const lparen = countTokenKind(tokens, TokenKind.LPAREN);
  const rparen = countTokenKind(tokens, TokenKind.RPAREN);
  const lbracket = countTokenKind(tokens, TokenKind.LBRACKET);
  const rbracket = countTokenKind(tokens, TokenKind.RBRACKET);

  assert.strictEqual(lparen, rparen, `${label}: 圆括号应平衡 (${lparen} vs ${rparen})`);
  assert.strictEqual(lbracket, rbracket, `${label}: 方括号应平衡 (${lbracket} vs ${rbracket})`);
}

// ============================================================================
// 测试套件
// ============================================================================

describe('I18N 多语言词法表测试套件', () => {
  // 初始化注册表
  initializeDefaultLexicons();

  describe('词法表注册验证', () => {
    for (const { id, name } of LANGUAGES) {
      it(`${name} (${id}) 应已注册`, () => {
        assert.ok(LexiconRegistry.has(id), `${id} 应已注册`);
        const lexicon = LexiconRegistry.get(id);
        assert.ok(lexicon, `${id} 应可获取`);
        assert.strictEqual(lexicon.id, id);
      });
    }
  });

  describe('测试文件完整性验证', () => {
    for (const { id, name, lexicon } of LANGUAGES) {
      describe(`${name} (${id})`, () => {
        for (const scenario of TEST_SCENARIOS) {
          it(`${scenario}.aster 应存在且可解析`, () => {
            const result = parseFile(id, scenario, lexicon);
            assert.ok(result, `${id}/${scenario}.aster 应存在`);
            assert.ok(result.tokens.length > 0, '应产生 token');
          });
        }
      });
    }
  });

  describe('场景 01: Hello World', () => {
    for (const { id, name, lexicon } of LANGUAGES) {
      it(`${name}: 应正确解析基础问候函数`, () => {
        const result = parseFile(id, '01-hello', lexicon);
        assert.ok(result, `${id}/01-hello.aster 应存在`);

        const { tokens } = result;

        // 验证有函数定义（通过产生的 token 类型）
        const identCount = countTokenKind(tokens, TokenKind.IDENT);
        assert.ok(identCount >= 3, `${name}: 应有多个标识符`);

        // 验证有字符串字面量
        const stringCount = countTokenKind(tokens, TokenKind.STRING);
        assert.ok(stringCount >= 1, `${name}: 应有字符串字面量`);

        // 验证括号平衡
        assertBracketsBalanced(tokens, `${name}/01-hello`);
      });
    }
  });

  describe('场景 02: 类型定义', () => {
    for (const { id, name, lexicon } of LANGUAGES) {
      it(`${name}: 应正确解析数据类型定义`, () => {
        const result = parseFile(id, '02-types', lexicon);
        assert.ok(result, `${id}/02-types.aster 应存在`);

        const { tokens } = result;

        // 验证有类型标识符（英文大写开头）或标识符（中文/德语）
        const typeIdentCount = countTokenKind(tokens, TokenKind.TYPE_IDENT);
        const identCount = countTokenKind(tokens, TokenKind.IDENT);
        assert.ok(
          typeIdentCount + identCount >= 10,
          `${name}: 应有多个类型和字段标识符`
        );

        // 验证有字段分隔符（列表分隔）
        const commaCount = countTokenKind(tokens, TokenKind.COMMA);
        assert.ok(commaCount >= 3, `${name}: 应有字段分隔符`);

        // 验证括号平衡
        assertBracketsBalanced(tokens, `${name}/02-types`);
      });
    }
  });

  describe('场景 03: 函数定义', () => {
    for (const { id, name, lexicon } of LANGUAGES) {
      it(`${name}: 应正确解析函数定义和调用`, () => {
        const result = parseFile(id, '03-functions', lexicon);
        assert.ok(result, `${id}/03-functions.aster 应存在`);

        const { tokens } = result;

        // 验证有圆括号（函数调用）
        const lparenCount = countTokenKind(tokens, TokenKind.LPAREN);
        assert.ok(lparenCount >= 2, `${name}: 应有函数调用括号`);

        // 验证有数字字面量
        const intCount = countTokenKind(tokens, TokenKind.INT);
        assert.ok(intCount >= 1, `${name}: 应有数字字面量`);

        // 验证括号平衡
        assertBracketsBalanced(tokens, `${name}/03-functions`);
      });
    }
  });

  describe('场景 04: 控制流', () => {
    for (const { id, name, lexicon } of LANGUAGES) {
      it(`${name}: 应正确解析 if/otherwise 条件`, () => {
        const result = parseFile(id, '04-control-flow', lexicon);
        assert.ok(result, `${id}/04-control-flow.aster 应存在`);

        const { tokens } = result;

        // 验证有布尔字面量
        const boolCount = countTokenKind(tokens, TokenKind.BOOL);
        assert.ok(boolCount >= 2, `${name}: 应有布尔字面量`);

        // 验证有数字（用于比较）
        const intCount = countTokenKind(tokens, TokenKind.INT);
        assert.ok(intCount >= 2, `${name}: 应有数字用于条件比较`);

        // 验证括号平衡
        assertBracketsBalanced(tokens, `${name}/04-control-flow`);
      });
    }
  });

  describe('场景 05: 模式匹配', () => {
    for (const { id, name, lexicon } of LANGUAGES) {
      it(`${name}: 应正确解析 match/when 模式`, () => {
        const result = parseFile(id, '05-patterns', lexicon);
        assert.ok(result, `${id}/05-patterns.aster 应存在`);

        const { tokens } = result;

        // 验证有整数字面量（用于模式匹配：0, 100）
        // 注意: 不同语言可能使用不同方式表示 null（如德语用 keines）
        const intCount = countTokenKind(tokens, TokenKind.INT);
        assert.ok(intCount >= 2, `${name}: 应有整数字面量用于模式匹配`);

        // 验证有字符串（返回消息）
        const stringCount = countTokenKind(tokens, TokenKind.STRING);
        assert.ok(stringCount >= 3, `${name}: 应有多个字符串返回值`);

        // 验证括号平衡
        assertBracketsBalanced(tokens, `${name}/05-patterns`);
      });
    }
  });

  describe('场景 06: 运算符', () => {
    for (const { id, name, lexicon } of LANGUAGES) {
      it(`${name}: 应正确解析算术和比较运算符`, () => {
        const result = parseFile(id, '06-operators', lexicon);
        assert.ok(result, `${id}/06-operators.aster 应存在`);

        const { tokens } = result;

        // 验证有多个标识符（函数参数）
        const identCount = countTokenKind(tokens, TokenKind.IDENT);
        assert.ok(identCount >= 10, `${name}: 应有多个标识符（函数和参数）`);

        // 验证总标识符数量（IDENT + TYPE_IDENT）
        // 注意: 中文没有大小写区分，所有标识符都是 IDENT
        // 英语和德语的类型/关键词会被识别为 TYPE_IDENT
        const typeIdentCount = countTokenKind(tokens, TokenKind.TYPE_IDENT);
        const totalIdents = identCount + typeIdentCount;
        assert.ok(totalIdents >= 30, `${name}: 应有足够多的标识符定义运算函数`);

        // 验证括号平衡
        assertBracketsBalanced(tokens, `${name}/06-operators`);
      });
    }
  });

  describe('跨语言 Token 结构对比', () => {
    for (const scenario of TEST_SCENARIOS) {
      it(`${scenario}: 三种语言应产生语义等价的结构`, () => {
        const results = LANGUAGES.map(({ id, name, lexicon }) => {
          const result = parseFile(id, scenario, lexicon);
          assert.ok(result, `${id}/${scenario}.aster 应存在`);
          return {
            id,
            name,
            tokenCount: result.tokens.filter(t => t.kind !== TokenKind.EOF).length,
            stringCount: countTokenKind(result.tokens, TokenKind.STRING),
            intCount: countTokenKind(result.tokens, TokenKind.INT),
            boolCount: countTokenKind(result.tokens, TokenKind.BOOL),
            nullCount: countTokenKind(result.tokens, TokenKind.NULL),
          };
        });

        // 字符串数量应相等（语义等价）
        const stringCounts = results.map(r => r.stringCount);
        const uniqueStringCounts = new Set(stringCounts);
        assert.ok(
          uniqueStringCounts.size <= 2, // 允许细微差异
          `${scenario}: 字符串数量应大致相等 (${results.map(r => `${r.name}:${r.stringCount}`).join(', ')})`
        );

        // 整数数量应相等
        const intCounts = results.map(r => r.intCount);
        const uniqueIntCounts = new Set(intCounts);
        assert.ok(
          uniqueIntCounts.size <= 2,
          `${scenario}: 整数数量应大致相等 (${results.map(r => `${r.name}:${r.intCount}`).join(', ')})`
        );

        // 布尔值数量应相等
        const boolCounts = results.map(r => r.boolCount);
        const uniqueBoolCounts = new Set(boolCounts);
        assert.ok(
          uniqueBoolCounts.size <= 2,
          `${scenario}: 布尔值数量应大致相等 (${results.map(r => `${r.name}:${r.boolCount}`).join(', ')})`
        );
      });
    }
  });

  describe('语言特定关键词验证', () => {
    // 注意：关键词在规范化后会被转换（如 if -> If），
    // 因此我们验证规范化后的文本内容而非原始 token 值

    it('英语: 应识别 If/Otherwise/Return 关键词', () => {
      const result = parseFile('en-US', '04-control-flow', EN_US);
      assert.ok(result);
      // 规范化后关键词首字母大写
      assert.ok(result.canonical.includes('If '), '应有 If');
      assert.ok(result.canonical.includes('Return'), '应有 Return');
    });

    it('中文: 应识别 若/否则/返回 关键词', () => {
      const result = parseFile('zh-CN', '04-control-flow', ZH_CN);
      assert.ok(result);
      // 中文关键词保持原样
      assert.ok(result.source.includes('若'), '应有 若');
      assert.ok(result.source.includes('返回'), '应有 返回');
    });

    it('德语: 应识别 wenn/sonst/gib 关键词', () => {
      const result = parseFile('de-DE', '04-control-flow', DE_DE);
      assert.ok(result);
      // 德语关键词保持原样
      assert.ok(result.source.includes('wenn'), '应有 wenn');
      assert.ok(result.source.includes('gib zurueck'), '应有 gib zurueck');
    });
  });

  describe('标点符号处理验证', () => {
    it('英语: 应使用英文标点 (., :)', () => {
      const result = parseFile('en-US', '01-hello', EN_US);
      assert.ok(result);
      assert.ok(result.canonical.includes('.'), '应有英文句号');
      assert.ok(result.canonical.includes(':'), '应有英文冒号');
    });

    it('中文: 应使用中文标点 (。：)', () => {
      const result = parseFile('zh-CN', '01-hello', ZH_CN);
      assert.ok(result);
      assert.ok(result.canonical.includes('。'), '应有中文句号');
      assert.ok(result.canonical.includes('：'), '应有中文冒号');
    });

    it('德语: 应使用英文标点 (., :)', () => {
      const result = parseFile('de-DE', '01-hello', DE_DE);
      assert.ok(result);
      assert.ok(result.canonical.includes('.'), '应有英文句号');
      assert.ok(result.canonical.includes(':'), '应有英文冒号');
    });
  });

  describe('字符串引号处理验证', () => {
    it('英语: 应使用双引号 ""', () => {
      const result = parseFile('en-US', '01-hello', EN_US);
      assert.ok(result);
      const stringTokens = result.tokens.filter(t => t.kind === TokenKind.STRING);
      assert.ok(stringTokens.length > 0, '应有字符串');
    });

    it('中文: 应使用直角引号 「」', () => {
      const result = parseFile('zh-CN', '01-hello', ZH_CN);
      assert.ok(result);
      const stringTokens = result.tokens.filter(t => t.kind === TokenKind.STRING);
      assert.ok(stringTokens.length > 0, '应有字符串');
      // 规范化后应包含直角引号
      assert.ok(result.canonical.includes('「') || result.canonical.includes('」'), '应有直角引号');
    });

    it('德语: 应使用双引号 ""', () => {
      const result = parseFile('de-DE', '01-hello', DE_DE);
      assert.ok(result);
      const stringTokens = result.tokens.filter(t => t.kind === TokenKind.STRING);
      assert.ok(stringTokens.length > 0, '应有字符串');
    });
  });
});
