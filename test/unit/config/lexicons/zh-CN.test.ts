/**
 * @module tests/unit/lexicons/zh-CN.test
 *
 * 中文词法表测试 - 验证端到端中文 CNL 处理。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalize } from '../../../../src/frontend/canonicalizer.js';
import { lex } from '../../../../src/frontend/lexer.js';
import { ZH_CN } from '../../../../src/config/lexicons/zh-CN.js';
import { EN_US } from '../../../../src/config/lexicons/en-US.js';
import { LexiconRegistry, initializeDefaultLexicons } from '../../../../src/config/lexicons/index.js';
import { SemanticTokenKind } from '../../../../src/config/token-kind.js';
import { TokenKind } from '../../../../src/frontend/tokens.js';
import type { Token } from '../../../../src/types.js';

// ============================================================================
// 文件级辅助函数（Codex 审查建议：消除重复定义）
// ============================================================================

/**
 * 查找具有指定值的标识符 token。
 *
 * 注意：Aster lexer 将关键词输出为 IDENT，在 parser 阶段才识别为关键词。
 */
const findIdent = (tokens: Token[], value: string): Token | undefined =>
  tokens.find((t: Token) => t.kind === TokenKind.IDENT && t.value === value);

/**
 * 统计具有指定值的标识符 token 数量。
 */
const countIdent = (tokens: Token[], value: string): number =>
  tokens.filter((t: Token) => t.kind === TokenKind.IDENT && t.value === value).length;

/**
 * 统计指定类型的 token 数量。
 */
const countTokenKind = (tokens: Token[], kind: TokenKind): number =>
  tokens.filter((t: Token) => t.kind === kind).length;

/**
 * 跨语言 token 类型分布比较的容差值。
 *
 * 允许较大差异，因为：
 * 1. 中文语法结构与英文有差异（如「入参」「产出」vs「to...with...produce」）
 * 2. 中文标点处理方式不同
 */
const CROSS_LANG_IDENT_TOLERANCE = 15;

describe('ZH_CN Lexicon 测试套件', () => {
  // 初始化注册表
  initializeDefaultLexicons();

  describe('Lexicon 注册与获取', () => {
    it('应成功注册中文词法表', () => {
      assert.ok(LexiconRegistry.has('zh-CN'));
      const lexicon = LexiconRegistry.get('zh-CN');
      assert.ok(lexicon);
      assert.strictEqual(lexicon.id, 'zh-CN');
      assert.strictEqual(lexicon.name, '简体中文');
    });

    it('应成功注册英文词法表', () => {
      assert.ok(LexiconRegistry.has('en-US'));
      const lexicon = LexiconRegistry.get('en-US');
      assert.ok(lexicon);
      assert.strictEqual(lexicon.id, 'en-US');
    });
  });

  describe('中文关键字映射', () => {
    it('应正确映射控制流关键字', () => {
      assert.strictEqual(ZH_CN.keywords[SemanticTokenKind.IF], '如果');
      assert.strictEqual(ZH_CN.keywords[SemanticTokenKind.OTHERWISE], '否则');
      assert.strictEqual(ZH_CN.keywords[SemanticTokenKind.RETURN], '返回');
      assert.strictEqual(ZH_CN.keywords[SemanticTokenKind.MATCH], '若');
      assert.strictEqual(ZH_CN.keywords[SemanticTokenKind.WHEN], '为');
    });

    it('应正确映射类型定义关键字', () => {
      assert.strictEqual(ZH_CN.keywords[SemanticTokenKind.TYPE_DEF], '定义');
      assert.strictEqual(ZH_CN.keywords[SemanticTokenKind.TYPE_WITH], '包含');
      assert.strictEqual(ZH_CN.keywords[SemanticTokenKind.TYPE_ONE_OF], '为以下之一');
    });

    it('应正确映射变量操作关键字', () => {
      assert.strictEqual(ZH_CN.keywords[SemanticTokenKind.LET], '令');
      assert.strictEqual(ZH_CN.keywords[SemanticTokenKind.BE], '为');
      assert.strictEqual(ZH_CN.keywords[SemanticTokenKind.SET], '将');
    });

    it('应正确映射布尔和null字面量', () => {
      assert.strictEqual(ZH_CN.keywords[SemanticTokenKind.TRUE], '真');
      assert.strictEqual(ZH_CN.keywords[SemanticTokenKind.FALSE], '假');
      assert.strictEqual(ZH_CN.keywords[SemanticTokenKind.NULL], '空');
    });

    it('应正确映射基础类型', () => {
      assert.strictEqual(ZH_CN.keywords[SemanticTokenKind.TEXT], '文本');
      assert.strictEqual(ZH_CN.keywords[SemanticTokenKind.INT_TYPE], '整数');
      assert.strictEqual(ZH_CN.keywords[SemanticTokenKind.FLOAT_TYPE], '小数');
      assert.strictEqual(ZH_CN.keywords[SemanticTokenKind.BOOL_TYPE], '布尔');
    });
  });

  describe('中文标点配置', () => {
    it('应使用中文句号作为语句结尾', () => {
      assert.strictEqual(ZH_CN.punctuation.statementEnd, '。');
    });

    it('应使用中文逗号作为列表分隔符', () => {
      assert.strictEqual(ZH_CN.punctuation.listSeparator, '，');
    });

    it('应使用直角引号作为字符串引号', () => {
      assert.strictEqual(ZH_CN.punctuation.stringQuotes.open, '「');
      assert.strictEqual(ZH_CN.punctuation.stringQuotes.close, '」');
    });

    it('不应有方括号标记（已移除）', () => {
      assert.strictEqual(ZH_CN.punctuation.markers, undefined);
    });
  });

  describe('规范化配置', () => {
    it('应启用全角转半角', () => {
      assert.strictEqual(ZH_CN.canonicalization.fullWidthToHalf, true);
    });

    it('应使用中文空白模式', () => {
      assert.strictEqual(ZH_CN.canonicalization.whitespaceMode, 'chinese');
    });

    it('应禁用冠词移除', () => {
      assert.strictEqual(ZH_CN.canonicalization.removeArticles, false);
    });
  });

  describe('复合关键词模式 (Compound Patterns)', () => {
    it('应在 zh-CN lexicon 中定义复合模式', () => {
      const patterns = ZH_CN.canonicalization.compoundPatterns;
      assert.ok(patterns, '应存在 compoundPatterns 配置');
      assert.strictEqual(patterns.length, 2, '应有 2 个复合模式');

      // match-when 模式：若...为
      const matchWhen = patterns[0]!;
      assert.strictEqual(matchWhen.name, 'match-when');
      assert.strictEqual(matchWhen.opener, SemanticTokenKind.MATCH);
      assert.ok(matchWhen.contextualKeywords.includes(SemanticTokenKind.WHEN));
      assert.strictEqual(matchWhen.closer, 'DEDENT');

      // let-be 模式：令...为
      const letBe = patterns[1]!;
      assert.strictEqual(letBe.name, 'let-be');
      assert.strictEqual(letBe.opener, SemanticTokenKind.LET);
      assert.ok(letBe.contextualKeywords.includes(SemanticTokenKind.BE));
      assert.strictEqual(letBe.closer, 'NEWLINE');
    });

    it('应正确解析包含 若...为 和 为以下之一 的程序', () => {
      const source = `模块 测试。

定义 状态 为以下之一 成功、失败。

规则 检查 包含 状态，产出 文本：
  若 状态：
    为 成功，返回 「成功」。
    为 失败，返回 「失败」。`;
      const can = canonicalize(source, ZH_CN);
      const tokens = lex(can, ZH_CN);

      // 验证 "为以下之一" 作为单独 token
      const oneOfToken = findIdent(tokens, '为以下之一');
      assert.ok(oneOfToken, '应识别 "为以下之一" 为单独 token');

      // 验证 "为" 作为 WHEN 关键词（多次出现）
      const whenCount = countIdent(tokens, '为');
      assert.strictEqual(whenCount, 2, '应有 2 个 "为" token');

      // 验证 "若" 作为 MATCH 关键词
      const matchCount = countIdent(tokens, '若');
      assert.strictEqual(matchCount, 1, '应有 1 个 "若" token');
    });
  });

  describe('Canonicalizer 中文支持', () => {
    it('应保留中文标点', () => {
      const input = '令 变量 为 42。';
      const result = canonicalize(input, ZH_CN);
      assert.ok(result.includes('。'));
    });

    it('应全角数字转半角', () => {
      const input = '１２３';
      const result = canonicalize(input, ZH_CN);
      assert.ok(result.includes('123'));
    });

    it('应全角字母转半角', () => {
      const input = 'ＡＢＣ';
      const result = canonicalize(input, ZH_CN);
      assert.ok(result.includes('ABC'));
    });

    it('应全角运算符转半角', () => {
      const input = '１ ＋ ２';
      const result = canonicalize(input, ZH_CN);
      assert.ok(result.includes('+'));
    });

    it('应全角括号转半角', () => {
      const input = '函数（参数）';
      const result = canonicalize(input, ZH_CN);
      assert.ok(result.includes('('));
      assert.ok(result.includes(')'));
      assert.ok(!result.includes('（'));
      assert.ok(!result.includes('）'));
    });

    it('应全角方括号转半角', () => {
      const input = '数组［索引］';
      const result = canonicalize(input, ZH_CN);
      // 验证半角方括号存在
      assert.ok(result.includes('['), '应含半角左方括号');
      assert.ok(result.includes(']'), '应含半角右方括号');
      // Codex Round 6 建议：验证全角方括号被移除
      assert.ok(!result.includes('［'), '全角左方括号应被移除');
      assert.ok(!result.includes('］'), '全角右方括号应被移除');
    });

    it('应移除英文冠词但保留中文', () => {
      // 英文模式移除冠词
      const enInput = 'define the User has a name.';
      const enResult = canonicalize(enInput, EN_US);
      assert.ok(!enResult.includes(' the '));
      assert.ok(!enResult.includes(' a '));

      // 中文模式不移除冠词（中文没有冠词）
      const zhInput = '定义 用户 包含 名字。';
      const zhResult = canonicalize(zhInput, ZH_CN);
      assert.strictEqual(zhResult, zhInput);
    });

    it('应将智能引号转换为直角引号', () => {
      // 左右智能引号 → 直角引号
      const input = '"你好世界"';
      const result = canonicalize(input, ZH_CN);
      assert.strictEqual(result, '「你好世界」');
    });

    it('应将直引号成对转换为直角引号', () => {
      // 直引号按奇偶位置交替转换
      const input = '"hello" "world"';
      const result = canonicalize(input, ZH_CN);
      assert.strictEqual(result, '「hello」 「world」');
    });

    it('应正确处理混合引号', () => {
      // 智能引号和直引号混合
      const input = '"智能" and "直接"';
      const result = canonicalize(input, ZH_CN);
      assert.strictEqual(result, '「智能」 and 「直接」');
    });
  });

  describe('Lexer 中文支持', () => {
    it('应识别中文标识符', () => {
      const input = '变量名';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      // 过滤掉 EOF
      const nonEofTokens = tokens.filter((t: Token) => t.kind !== TokenKind.EOF);
      assert.strictEqual(nonEofTokens.length, 1);
      assert.strictEqual(nonEofTokens[0]!.kind, TokenKind.IDENT);
      assert.strictEqual(nonEofTokens[0]!.value, '变量名');
    });

    it('应识别中文布尔值', () => {
      const tokens = lex('真', ZH_CN);
      const nonEofTokens = tokens.filter((t: Token) => t.kind !== TokenKind.EOF);
      assert.strictEqual(nonEofTokens.length, 1);
      assert.strictEqual(nonEofTokens[0]!.kind, TokenKind.BOOL);
      assert.strictEqual(nonEofTokens[0]!.value, true);
    });

    it('应识别中文 false', () => {
      const tokens = lex('假', ZH_CN);
      const nonEofTokens = tokens.filter((t: Token) => t.kind !== TokenKind.EOF);
      assert.strictEqual(nonEofTokens.length, 1);
      assert.strictEqual(nonEofTokens[0]!.kind, TokenKind.BOOL);
      assert.strictEqual(nonEofTokens[0]!.value, false);
    });

    it('应识别中文 null', () => {
      const tokens = lex('空', ZH_CN);
      const nonEofTokens = tokens.filter((t: Token) => t.kind !== TokenKind.EOF);
      assert.strictEqual(nonEofTokens.length, 1);
      assert.strictEqual(nonEofTokens[0]!.kind, TokenKind.NULL);
      assert.strictEqual(nonEofTokens[0]!.value, null);
    });

    it('应识别直角引号字符串', () => {
      const tokens = lex('「你好世界」', ZH_CN);
      const nonEofTokens = tokens.filter((t: Token) => t.kind !== TokenKind.EOF);
      assert.strictEqual(nonEofTokens.length, 1);
      assert.strictEqual(nonEofTokens[0]!.kind, TokenKind.STRING);
      assert.strictEqual(nonEofTokens[0]!.value, '你好世界');
    });

    it('应识别中文句号', () => {
      const tokens = lex('变量。', ZH_CN);
      const hasZhPeriod = tokens.some((t: Token) => t.kind === TokenKind.DOT);
      assert.ok(hasZhPeriod);
    });

    it('应识别中文冒号', () => {
      const tokens = lex('定义：', ZH_CN);
      const hasZhColon = tokens.some((t: Token) => t.kind === TokenKind.COLON);
      assert.ok(hasZhColon);
    });

    it('应识别混合中英文标识符', () => {
      const tokens = lex('User用户', ZH_CN);
      const nonEofTokens = tokens.filter((t: Token) => t.kind !== TokenKind.EOF);
      assert.strictEqual(nonEofTokens.length, 1);
      assert.strictEqual(nonEofTokens[0]!.kind, TokenKind.TYPE_IDENT);
      assert.strictEqual(nonEofTokens[0]!.value, 'User用户');
    });
  });

  describe('英文兼容性（默认行为）', () => {
    it('无 lexicon 参数时应使用英文默认行为', () => {
      const input = 'define User has name.';
      const result = canonicalize(input);
      // 应移除冠词
      assert.ok(!result.includes(' the '));

      const tokens = lex(result);
      // 应正确词法分析
      assert.ok(tokens.length > 0);
    });

    it('显式传递 EN_US 应与默认行为一致', () => {
      const input = 'define User has name.';
      const defaultResult = canonicalize(input);
      const explicitResult = canonicalize(input, EN_US);
      assert.strictEqual(defaultResult, explicitResult);
    });
  });

  describe('标点符号数据驱动处理', () => {
    it('应识别中文逗号为列表分隔符', () => {
      const tokens = lex('甲，乙，丙', ZH_CN);
      const commaTokens = tokens.filter((t: Token) => t.kind === TokenKind.COMMA);
      assert.strictEqual(commaTokens.length, 2);
    });

    it('应识别中文顿号为枚举分隔符', () => {
      const tokens = lex('甲、乙、丙', ZH_CN);
      const commaTokens = tokens.filter((t: Token) => t.kind === TokenKind.COMMA);
      assert.strictEqual(commaTokens.length, 2);
    });

    it('应识别模块关键字', () => {
      const tokens = lex('模块', ZH_CN);
      const hasModule = tokens.some((t: Token) => t.kind === TokenKind.IDENT && t.value === '模块');
      assert.ok(hasModule, '应有「模块」标识符');
    });

    it('英文模式应使用英文标点', () => {
      const tokens = lex('a, b, c.', EN_US);
      const commaTokens = tokens.filter((t: Token) => t.kind === TokenKind.COMMA);
      const dotTokens = tokens.filter((t: Token) => t.kind === TokenKind.DOT);
      assert.strictEqual(commaTokens.length, 2);
      assert.strictEqual(dotTokens.length, 1);
    });
  });

  describe('中文控制流语法', () => {
    it('应正确词法分析 如果/否则 二分支条件', () => {
      const input = '如果 年龄 >= 18：\n  返回 「成年」。\n否则：\n  返回 「未成年」。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      // 验证控制流关键词（在 lexer 阶段为 IDENT）
      assert.ok(findIdent(tokens, '如果'), '应识别「如果」标识符');
      assert.ok(findIdent(tokens, '否则'), '应识别「否则」标识符');
      assert.strictEqual(countIdent(tokens, '返回'), 2, '应有两个「返回」标识符');
    });

    it('应正确词法分析 若/为 模式匹配', () => {
      const input = '若 用户：\n  为 空，返回 「访客」。\n  为 用户(编号, 名字)，返回 名字。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      // 验证模式匹配关键词
      assert.ok(findIdent(tokens, '若'), '应识别「若」标识符');
      assert.strictEqual(countIdent(tokens, '为'), 2, '应有两个「为」标识符');
    });

    it('应正确词法分析嵌套条件', () => {
      const input = '如果 甲：\n  如果 乙：\n    返回 「甲乙」。\n  否则：\n    返回 「仅甲」。\n否则：\n  返回 「无」。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.strictEqual(countIdent(tokens, '如果'), 2, '应有两个「如果」标识符');
      assert.strictEqual(countIdent(tokens, '否则'), 2, '应有两个「否则」标识符');
      assert.strictEqual(countIdent(tokens, '返回'), 3, '应有三个「返回」标识符');
    });
  });

  // ============================================================================
  // 补充语法测试（Codex 审查建议：覆盖导入、布尔/算术、循环、工作流语法）
  // ============================================================================

  describe('中文导入语法', () => {
    it('应正确词法分析简单导入', () => {
      const input = '引用 数学。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      // 关键词验证
      assert.ok(findIdent(tokens, '引用'), '应识别「引用」标识符');
      assert.ok(findIdent(tokens, '数学'), '应识别「数学」标识符');
      // Token 结构验证（Codex 审查建议）
      assert.strictEqual(countTokenKind(tokens, TokenKind.DOT), 1, '应有1个句号');
    });

    it('应正确词法分析带别名的导入', () => {
      const input = '引用 外部模块 作为 本地名。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      // 关键词验证
      assert.ok(findIdent(tokens, '引用'), '应识别「引用」标识符');
      assert.ok(findIdent(tokens, '作为'), '应识别「作为」标识符');
      assert.ok(findIdent(tokens, '外部模块'), '应识别模块名标识符');
      assert.ok(findIdent(tokens, '本地名'), '应识别别名标识符');
      // Token 结构验证
      assert.strictEqual(countTokenKind(tokens, TokenKind.DOT), 1, '应有1个句号');
      assert.strictEqual(countTokenKind(tokens, TokenKind.IDENT), 4, '应有4个标识符');
    });

    it('应正确词法分析多个导入', () => {
      const input = '引用 模块甲。\n引用 模块乙 作为 乙。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.strictEqual(countIdent(tokens, '引用'), 2, '应有2个「引用」');
      assert.strictEqual(countIdent(tokens, '作为'), 1, '应有1个「作为」');
      // Token 结构验证
      assert.strictEqual(countTokenKind(tokens, TokenKind.DOT), 2, '应有2个句号');
    });
  });

  describe('中文布尔运算语法', () => {
    it('应正确词法分析「或」运算', () => {
      const input = '甲 或 乙。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '或'), '应识别「或」标识符');
      // Token 结构验证
      assert.strictEqual(countTokenKind(tokens, TokenKind.IDENT), 3, '应有3个标识符');
      assert.strictEqual(countTokenKind(tokens, TokenKind.DOT), 1, '应有1个句号');
    });

    it('应正确词法分析「且」运算', () => {
      const input = '甲 且 乙。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '且'), '应识别「且」标识符');
      // Token 结构验证
      assert.strictEqual(countTokenKind(tokens, TokenKind.IDENT), 3, '应有3个标识符');
    });

    it('应正确词法分析「非」运算', () => {
      const input = '非 甲。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '非'), '应识别「非」标识符');
      // Token 结构验证
      assert.strictEqual(countTokenKind(tokens, TokenKind.IDENT), 2, '应有2个标识符');
    });

    it('应正确词法分析复合布尔表达式', () => {
      const input = '(甲 且 乙) 或 (非 丙)。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.strictEqual(countIdent(tokens, '且'), 1, '应有1个「且」');
      assert.strictEqual(countIdent(tokens, '或'), 1, '应有1个「或」');
      assert.strictEqual(countIdent(tokens, '非'), 1, '应有1个「非」');
      // Token 结构验证：括号
      assert.strictEqual(countTokenKind(tokens, TokenKind.LPAREN), 2, '应有2个左括号');
      assert.strictEqual(countTokenKind(tokens, TokenKind.RPAREN), 2, '应有2个右括号');
    });
  });

  describe('中文算术运算语法', () => {
    it('应正确词法分析「加」运算', () => {
      const input = '1 加 2。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '加'), '应识别「加」标识符');
      // Token 结构验证：数字
      assert.strictEqual(countTokenKind(tokens, TokenKind.INT), 2, '应有2个整数');
    });

    it('应正确词法分析「减」运算', () => {
      const input = '5 减 3。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '减'), '应识别「减」标识符');
      // Token 结构验证
      assert.strictEqual(countTokenKind(tokens, TokenKind.INT), 2, '应有2个整数');
    });

    it('应正确词法分析「乘」运算', () => {
      const input = '4 乘 2。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '乘'), '应识别「乘」标识符');
      // Token 结构验证
      assert.strictEqual(countTokenKind(tokens, TokenKind.INT), 2, '应有2个整数');
    });

    it('应正确词法分析「除以」运算', () => {
      const input = '10 除以 2。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '除以'), '应识别「除以」标识符');
      // Token 结构验证
      assert.strictEqual(countTokenKind(tokens, TokenKind.INT), 2, '应有2个整数');
    });

    it('应正确词法分析复合算术表达式', () => {
      const input = '(1 加 2) 乘 (10 除以 5)。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.strictEqual(countIdent(tokens, '加'), 1, '应有1个「加」');
      assert.strictEqual(countIdent(tokens, '乘'), 1, '应有1个「乘」');
      assert.strictEqual(countIdent(tokens, '除以'), 1, '应有1个「除以」');
      // Token 结构验证
      assert.strictEqual(countTokenKind(tokens, TokenKind.INT), 4, '应有4个整数');
      assert.strictEqual(countTokenKind(tokens, TokenKind.LPAREN), 2, '应有2个左括号');
      assert.strictEqual(countTokenKind(tokens, TokenKind.RPAREN), 2, '应有2个右括号');
    });

    // Codex Round 3 建议：新增 FLOAT 和 LONG 测试用例
    it('应正确词法分析浮点数运算', () => {
      const input = '1.5 加 2.5。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '加'), '应识别「加」标识符');
      // Token 结构验证：浮点数
      assert.strictEqual(countTokenKind(tokens, TokenKind.FLOAT), 2, '应有2个浮点数');
      // 验证无整数（避免误解析）
      assert.strictEqual(countTokenKind(tokens, TokenKind.INT), 0, '不应有整数');
    });

    it('应正确词法分析全角数字浮点数运算', () => {
      // 全角数字应被规范化为半角（注意：小数点为半角，全角句点未被规范化）
      const input = '３.１４ 乘 ２.０。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '乘'), '应识别「乘」标识符');
      // Token 结构验证：全角数字转半角后产生浮点数
      assert.strictEqual(countTokenKind(tokens, TokenKind.FLOAT), 2, '应有2个浮点数');
      // 验证规范化后的文本
      assert.ok(result.includes('3.14'), '全角３.１４应规范化为半角3.14');
    });

    it('应正确词法分析长整数运算（大写 L）', () => {
      const input = '1000000000000L 加 500000000000L。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '加'), '应识别「加」标识符');
      // Token 结构验证：长整数
      assert.strictEqual(countTokenKind(tokens, TokenKind.LONG), 2, '应有2个长整数');
      // 验证无普通整数
      assert.strictEqual(countTokenKind(tokens, TokenKind.INT), 0, '不应有普通整数');
    });

    // Codex Round 4 建议：补充小写 l 和全角 ｌ 测试
    it('应正确词法分析长整数运算（小写 l）', () => {
      const input = '100l 减 50l。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '减'), '应识别「减」标识符');
      // Token 结构验证：小写 l 应被识别为长整数
      assert.strictEqual(countTokenKind(tokens, TokenKind.LONG), 2, '应有2个长整数（小写l）');
      assert.strictEqual(countTokenKind(tokens, TokenKind.INT), 0, '不应有普通整数');
    });

    it('应正确词法分析长整数运算（全角 ｌ）', () => {
      // 全角字母 ｌ (U+FF4C) 应被规范化为半角 l
      const input = '100ｌ 乘 2ｌ。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '乘'), '应识别「乘」标识符');
      // Token 结构验证：全角 ｌ 应被规范化后识别为长整数
      assert.strictEqual(countTokenKind(tokens, TokenKind.LONG), 2, '应有2个长整数（全角ｌ转半角后）');
      // Codex Round 5 建议：验证规范化输出（确保 canonicalizer 工作正常）
      assert.ok(result.includes('100l'), '全角 100ｌ 应规范化为半角 100l');
      assert.ok(!result.includes('ｌ'), '规范化后不应再含全角 ｌ');
    });

    it('应正确词法分析混合数值类型表达式', () => {
      const input = '(1 加 1.5) 乘 100L。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      // Token 结构验证：三种数值类型共存
      assert.strictEqual(countTokenKind(tokens, TokenKind.INT), 1, '应有1个整数');
      assert.strictEqual(countTokenKind(tokens, TokenKind.FLOAT), 1, '应有1个浮点数');
      assert.strictEqual(countTokenKind(tokens, TokenKind.LONG), 1, '应有1个长整数');
    });
  });

  describe('中文循环语法', () => {
    it('应正确词法分析「对每个/在」循环', () => {
      const input = '对每个 项目 在 列表：\n  处理 项目。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '对每个'), '应识别「对每个」标识符');
      assert.ok(findIdent(tokens, '在'), '应识别「在」标识符');
      // Token 结构验证（Codex 审查建议）
      assert.strictEqual(countTokenKind(tokens, TokenKind.COLON), 1, '应有1个冒号');
      assert.strictEqual(countTokenKind(tokens, TokenKind.DOT), 1, '应有1个句号');
    });

    it('应正确词法分析嵌套循环', () => {
      const input = '对每个 行 在 表格：\n  对每个 列 在 行：\n    处理 列。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.strictEqual(countIdent(tokens, '对每个'), 2, '应有2个「对每个」');
      assert.strictEqual(countIdent(tokens, '在'), 2, '应有2个「在」');
      // Token 结构验证
      assert.strictEqual(countTokenKind(tokens, TokenKind.COLON), 2, '应有2个冒号');
      assert.strictEqual(countTokenKind(tokens, TokenKind.DOT), 1, '应有1个句号');
    });

    it('应正确词法分析带条件的循环', () => {
      const input = '对每个 数字 在 数列：\n  如果 数字 大于 0：\n    累加 数字。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '对每个'), '应识别「对每个」标识符');
      assert.ok(findIdent(tokens, '在'), '应识别「在」标识符');
      assert.ok(findIdent(tokens, '如果'), '应识别「如果」标识符');
      assert.ok(findIdent(tokens, '大于'), '应识别「大于」标识符');
      // Token 结构验证
      assert.strictEqual(countTokenKind(tokens, TokenKind.COLON), 2, '应有2个冒号（循环体+条件体）');
      assert.strictEqual(countTokenKind(tokens, TokenKind.DOT), 1, '应有1个句号');
    });
  });

  describe('中文工作流语法', () => {
    it('应正确词法分析流程声明', () => {
      const input = '流程 订单处理：\n  步骤 验证订单。\n  步骤 处理支付。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      // 流程和步骤作为纯关键字直接解析
      assert.ok(findIdent(tokens, '流程'), '应识别「流程」标识符');
      assert.strictEqual(countIdent(tokens, '步骤'), 2, '应有2个「步骤」');
      // Token 结构验证
      assert.strictEqual(countTokenKind(tokens, TokenKind.COLON), 1, '应有1个冒号');
      assert.strictEqual(countTokenKind(tokens, TokenKind.DOT), 2, '应有2个句号');
    });

    it('应正确词法分析带依赖的步骤', () => {
      const input = '流程 构建：\n  步骤 编译 依赖 于 下载。\n  步骤 下载。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '依赖'), '应识别「依赖」标识符');
      assert.ok(findIdent(tokens, '于'), '应识别「于」标识符');
    });

    it('应正确词法分析带补偿的步骤', () => {
      const input = '步骤 扣款 补偿 退款。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '步骤'), '应识别「步骤」标识符');
      assert.ok(findIdent(tokens, '补偿'), '应识别「补偿」标识符');
      // Token 结构验证
      assert.strictEqual(countTokenKind(tokens, TokenKind.DOT), 1, '应有1个句号');
    });

    it('应正确词法分析带重试策略的步骤', () => {
      const input = '步骤 调用服务 重试 最多尝试 3 退避 指数。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '重试'), '应识别「重试」标识符');
      assert.ok(findIdent(tokens, '最多尝试'), '应识别「最多尝试」标识符');
      assert.ok(findIdent(tokens, '退避'), '应识别「退避」标识符');
      // Token 结构验证
      assert.strictEqual(countTokenKind(tokens, TokenKind.INT), 1, '应有1个整数（重试次数）');
    });

    it('应正确词法分析带超时的步骤', () => {
      const input = '步骤 长时间操作 超时 30。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '超时'), '应识别「超时」标识符');
      // Token 结构验证
      assert.strictEqual(countTokenKind(tokens, TokenKind.INT), 1, '应有1个整数（超时值）');
    });
  });

  describe('中文 CNL 完整语法', () => {
    it('应正确词法分析模块声明', () => {
      const input = '模块 应用。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      // 模块作为纯关键字直接解析为 IDENT
      const hasModule = tokens.some((t: Token) =>
        t.kind === TokenKind.IDENT && t.value === '模块'
      );

      assert.ok(hasModule, '应识别「模块」标识符');
    });

    it('应正确词法分析类型定义', () => {
      const input = '定义 用户 包含 编号：文本，名字：文本。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '包含'), '应识别「包含」标识符');
      assert.strictEqual(countIdent(tokens, '文本'), 2, '应有两个「文本」类型');
    });

    it('应正确词法分析函数定义', () => {
      const input = '问候 入参 用户：用户，产出 文本：\n  返回 「你好」。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '入参'), '应识别「入参」标识符');
      assert.ok(findIdent(tokens, '产出'), '应识别「产出」标识符');
      assert.ok(findIdent(tokens, '返回'), '应识别「返回」标识符');
    });

    it('应正确词法分析变量绑定', () => {
      const input = '令 结果 为 计算(42)。';
      const result = canonicalize(input, ZH_CN);
      const tokens = lex(result, ZH_CN);

      assert.ok(findIdent(tokens, '令'), '应识别「令」标识符');
      assert.ok(findIdent(tokens, '为'), '应识别「为」标识符');
    });

    it('应正确词法分析完整中文程序', () => {
      const program = `模块 应用。

定义 用户 包含 编号：文本，名字：文本。

问候 入参 用户：可选 用户，产出 文本：
  若 用户：
    为 空，返回 「你好，访客」。
    为 用户(编号, 名字)，返回 「欢迎，」加 名字。`;

      const result = canonicalize(program, ZH_CN);
      const tokens = lex(result, ZH_CN);

      // 验证关键词精确出现次数（在 lexer 阶段为 IDENT）
      // Codex 审查建议：使用精确断言替代宽松的 >= 判断
      assert.strictEqual(countIdent(tokens, '包含'), 1, '应有1个「包含」');
      assert.strictEqual(countIdent(tokens, '入参'), 1, '应有1个「入参」');
      assert.strictEqual(countIdent(tokens, '产出'), 1, '应有1个「产出」');
      assert.strictEqual(countIdent(tokens, '若'), 1, '应有1个「若」');
      assert.strictEqual(countIdent(tokens, '为'), 2, '应有2个「为」');
      assert.strictEqual(countIdent(tokens, '返回'), 2, '应有2个「返回」');
      assert.strictEqual(countIdent(tokens, '可选'), 1, '应有1个「可选」');
    });
  });

  describe('中英文对照验证', () => {
    it('中英文程序应产生相似的 token 结构', () => {
      // 英文程序（Codex Round 6 建议：添加数字字面量以验证 INT 统计）
      const enProgram = `Module app.

Define User has id: Text, name: Text, age: Int.

Rule greet given user: User?, produce Text:
  Match user:
    When null, Return "Hi, guest".
    When User(id, name, 42), Return "Welcome, " plus name.`;

      // 对应的中文程序（Codex Round 6 建议：添加数字字面量以验证 INT 统计）
      const zhProgram = `模块 应用。

定义 用户 包含 编号：文本，名字：文本，年龄：整数。

问候 入参 用户：可选 用户，产出 文本：
  若 用户：
    为 空，返回 「你好，访客」。
    为 用户(编号, 名字, 42)，返回 「欢迎，」加 名字。`;

      const enTokens = lex(canonicalize(enProgram, EN_US), EN_US);
      const zhTokens = lex(canonicalize(zhProgram, ZH_CN), ZH_CN);

      // 获取 token 类型分布（Codex 审查建议：拆分更多 Token 类型以细化比较）
      const getTokenDistribution = (tokens: Token[]) => ({
        // 基础类型
        ident: countTokenKind(tokens, TokenKind.IDENT),
        typeIdent: countTokenKind(tokens, TokenKind.TYPE_IDENT),
        string: countTokenKind(tokens, TokenKind.STRING),
        number: countTokenKind(tokens, TokenKind.INT),
        // 字面量类型
        bool: countTokenKind(tokens, TokenKind.BOOL),
        null: countTokenKind(tokens, TokenKind.NULL),
        // 标点符号（拆分）
        dot: countTokenKind(tokens, TokenKind.DOT),
        colon: countTokenKind(tokens, TokenKind.COLON),
        comma: countTokenKind(tokens, TokenKind.COMMA),
        // 括号类型
        lparen: countTokenKind(tokens, TokenKind.LPAREN),
        rparen: countTokenKind(tokens, TokenKind.RPAREN),
        lbracket: countTokenKind(tokens, TokenKind.LBRACKET),
        rbracket: countTokenKind(tokens, TokenKind.RBRACKET),
      });

      const enDist = getTokenDistribution(enTokens);
      const zhDist = getTokenDistribution(zhTokens);

      // 验证标识符数量差异在容差范围内
      // 使用文件级常量替代魔法值（Codex 审查建议）
      assert.ok(
        Math.abs(zhDist.ident - enDist.ident) <= CROSS_LANG_IDENT_TOLERANCE,
        `中英文标识符数量应相近：中文${zhDist.ident}个，英文${enDist.ident}个（容差${CROSS_LANG_IDENT_TOLERANCE}）`
      );

      // 验证字符串数量相等（都有2个）
      assert.strictEqual(zhDist.string, enDist.string, '中英文字符串数量应相等');

      // 验证括号平衡（左右括号数量应相等）
      assert.strictEqual(zhDist.lparen, zhDist.rparen, '中文左右圆括号应平衡');
      assert.strictEqual(enDist.lparen, enDist.rparen, '英文左右圆括号应平衡');

      // 验证字面量类型数量相等（语义等价）
      assert.strictEqual(zhDist.bool, enDist.bool, '中英文布尔值数量应相等');
      assert.strictEqual(zhDist.null, enDist.null, '中英文 null 数量应相等');

      // Codex Round 3 建议：消费所有收集的分布字段
      // 注意：TYPE_IDENT 是基于首字母大写来区分的，中文没有大小写，
      // 因此所有中文标识符都是 IDENT。这是预期行为，我们验证英文有 TYPE_IDENT 而中文没有。
      assert.ok(enDist.typeIdent > 0, '英文应有类型标识符（首字母大写）');
      assert.strictEqual(zhDist.typeIdent, 0, '中文没有大小写区分，类型标识符应为0');

      // 验证数值类型数量相等（INT 字面量）
      // Codex Round 6 建议：确保数量非零，避免 0===0 恒真失去信号
      assert.ok(zhDist.number > 0, '中文程序应有整数字面量（42）');
      assert.ok(enDist.number > 0, '英文程序应有整数字面量（42）');
      assert.strictEqual(zhDist.number, enDist.number, '中英文整数数量应相等');

      // 验证标点符号数量相等（句号、冒号、逗号应语义等价）
      assert.strictEqual(zhDist.dot, enDist.dot, '中英文句号数量应相等');
      assert.strictEqual(zhDist.colon, enDist.colon, '中英文冒号数量应相等');
      assert.strictEqual(zhDist.comma, enDist.comma, '中英文逗号数量应相等');

      // 验证圆括号数量相等（函数调用等）
      assert.strictEqual(zhDist.lparen, enDist.lparen, '中英文左圆括号数量应相等');
      assert.strictEqual(zhDist.rparen, enDist.rparen, '中英文右圆括号数量应相等');

      // 新语法移除了【】标记，中英文都不应有方括号
      assert.strictEqual(enDist.lbracket, 0, '英文程序不含方括号，应为0');
      assert.strictEqual(enDist.rbracket, 0, '英文程序不含方括号，应为0');
      assert.strictEqual(zhDist.lbracket, 0, '中文程序不再使用【】标记，方括号应为0');
      assert.strictEqual(zhDist.rbracket, 0, '中文程序不再使用【】标记，方括号应为0');
    });

    it('如果/if 和 否则/otherwise 应正确识别为标识符', () => {
      const enTokens = lex(canonicalize('if true: return 1. otherwise: return 0.', EN_US), EN_US);
      const zhTokens = lex(canonicalize('如果 真：返回 1。否则：返回 0。', ZH_CN), ZH_CN);

      // 英文验证（关键词在 lexer 阶段为 IDENT）
      const hasEnIf = enTokens.some((t: Token) => t.kind === TokenKind.IDENT && t.value === 'if');
      const hasEnOtherwise = enTokens.some((t: Token) => t.kind === TokenKind.IDENT && t.value === 'otherwise');
      assert.ok(hasEnIf, '英文应有 if 标识符');
      assert.ok(hasEnOtherwise, '英文应有 otherwise 标识符');

      // 中文验证
      const hasZhIf = zhTokens.some((t: Token) => t.kind === TokenKind.IDENT && t.value === '如果');
      const hasZhOtherwise = zhTokens.some((t: Token) => t.kind === TokenKind.IDENT && t.value === '否则');
      assert.ok(hasZhIf, '中文应有 如果 标识符');
      assert.ok(hasZhOtherwise, '中文应有 否则 标识符');
    });

    it('中英文布尔值应正确识别', () => {
      // 英文
      const enTrueTokens = lex('true', EN_US);
      const enFalseTokens = lex('false', EN_US);
      assert.ok(enTrueTokens.some((t: Token) => t.kind === TokenKind.BOOL && t.value === true));
      assert.ok(enFalseTokens.some((t: Token) => t.kind === TokenKind.BOOL && t.value === false));

      // 中文
      const zhTrueTokens = lex('真', ZH_CN);
      const zhFalseTokens = lex('假', ZH_CN);
      assert.ok(zhTrueTokens.some((t: Token) => t.kind === TokenKind.BOOL && t.value === true));
      assert.ok(zhFalseTokens.some((t: Token) => t.kind === TokenKind.BOOL && t.value === false));
    });

    it('中英文 null 应正确识别', () => {
      // 英文
      const enNullTokens = lex('null', EN_US);
      assert.ok(enNullTokens.some((t: Token) => t.kind === TokenKind.NULL && t.value === null));

      // 中文
      const zhNullTokens = lex('空', ZH_CN);
      assert.ok(zhNullTokens.some((t: Token) => t.kind === TokenKind.NULL && t.value === null));
    });
  });

  describe('LexiconRegistry 默认切换', () => {
    // Codex 审查建议：使用 try/finally 确保状态复位，避免测试串扰
    it('setDefault 应切换默认词法表', () => {
      const originalDefault = LexiconRegistry.getDefault();
      try {
        // 切换到中文
        LexiconRegistry.setDefault('zh-CN');
        const zhDefault = LexiconRegistry.getDefault();
        assert.strictEqual(zhDefault.id, 'zh-CN');

        // 切换回英文
        LexiconRegistry.setDefault('en-US');
        const enDefault = LexiconRegistry.getDefault();
        assert.strictEqual(enDefault.id, 'en-US');
      } finally {
        // 无论断言成功与否都恢复原默认
        LexiconRegistry.setDefault(originalDefault.id);
      }
    });

    it('切换默认后 lex 应使用新默认', () => {
      const originalDefault = LexiconRegistry.getDefault();
      try {
        // 切换到中文并测试中文布尔值
        LexiconRegistry.setDefault('zh-CN');
        const zhTokens = lex('真');
        const zhBool = zhTokens.find((t: Token) => t.kind === TokenKind.BOOL);
        assert.ok(zhBool, '应识别中文布尔值');
        assert.strictEqual(zhBool?.value, true);
      } finally {
        // 无论断言成功与否都恢复原默认
        LexiconRegistry.setDefault(originalDefault.id);
      }
    });
  });

  // ============================================================================
  // 中文 CNL 文件解析测试
  // ============================================================================

  describe('中文 CNL 文件解析', () => {
    // 使用项目根目录解析，因为 .aster 文件不会被编译到 dist
    const zhCNDir = path.resolve(process.cwd(), 'test/cnl/programs/zh-CN');

    /**
     * 读取中文 CNL 文件并进行规范化和词法分析
     */
    const parseZhCNFile = (filename: string) => {
      const filePath = path.join(zhCNDir, filename);
      const source = fs.readFileSync(filePath, 'utf-8');
      const canonical = canonicalize(source, ZH_CN);
      const tokens = lex(canonical, ZH_CN);
      return { source, canonical, tokens };
    };

    it('hello.aster 应正确解析', () => {
      const { tokens } = parseZhCNFile('hello.aster');

      // 验证模块声明关键词（模块 作为纯关键字直接解析为 IDENT）
      assert.ok(findIdent(tokens, '模块'), '应有 模块 关键词');

      // 验证函数关键词
      assert.ok(findIdent(tokens, '入参'), '应有 入参 关键词');
      assert.ok(findIdent(tokens, '产出'), '应有 产出 关键词');
      assert.ok(findIdent(tokens, '返回'), '应有 返回 关键词');

      // 验证字符串
      const stringTokens = tokens.filter((t: Token) => t.kind === TokenKind.STRING);
      assert.ok(stringTokens.length > 0, '应有字符串 token');
    });

    it('loan_decision.aster 应正确解析', () => {
      const { tokens } = parseZhCNFile('loan_decision.aster');

      // 验证类型定义关键词（定义 作为纯关键字直接解析为 IDENT）
      assert.ok(findIdent(tokens, '定义'), '应有 定义 关键词');
      assert.ok(findIdent(tokens, '包含'), '应有 包含 关键词');

      // 验证控制流关键词
      assert.ok(findIdent(tokens, '如果'), '应有 如果 关键词');
      assert.ok(findIdent(tokens, '返回'), '应有 返回 关键词');

      // 验证变量绑定
      assert.ok(findIdent(tokens, '令'), '应有 令 关键词');
      assert.ok(findIdent(tokens, '为'), '应有 为 关键词');

      // 验证布尔值
      const boolTokens = tokens.filter((t: Token) => t.kind === TokenKind.BOOL);
      assert.ok(boolTokens.length >= 2, '应有多个布尔值（真/假）');

      // 验证整数
      const intTokens = tokens.filter((t: Token) => t.kind === TokenKind.INT);
      assert.ok(intTokens.length >= 2, '应有整数字面量（18, 100000）');

      // 新语法不再使用【】标记
      const lbracketCount = countTokenKind(tokens, TokenKind.LBRACKET);
      const rbracketCount = countTokenKind(tokens, TokenKind.RBRACKET);
      assert.strictEqual(lbracketCount, 0, '不应有方括号标记（已移除【】语法）');
      assert.strictEqual(rbracketCount, 0, '不应有方括号标记（已移除【】语法）');

      // 验证中文冒号（类型声明和条件语句）
      const colonCount = countTokenKind(tokens, TokenKind.COLON);
      assert.ok(colonCount >= 5, '应有中文冒号（类型声明、条件语句）');

      // 验证中文逗号（字段分隔和参数分隔）
      const commaCount = countTokenKind(tokens, TokenKind.COMMA);
      assert.ok(commaCount >= 3, '应有中文逗号（字段分隔、参数分隔）');

      // 验证直角引号字符串（「」）
      const stringTokens = tokens.filter((t: Token) => t.kind === TokenKind.STRING);
      assert.ok(stringTokens.length >= 3, '应有字符串（「申请人未满18岁」等）');
    });

    it('user_greeting.aster 应正确解析', () => {
      const { tokens } = parseZhCNFile('user_greeting.aster');

      // 验证模式匹配关键词
      assert.ok(findIdent(tokens, '若'), '应有 若 关键词（模式匹配）');
      assert.ok(findIdent(tokens, '为'), '应有 为 关键词（when）');

      // 可选类型已改为推断，应不再显式出现
      assert.ok(!findIdent(tokens, '可选'), '不应显式出现 可选 关键词');

      // 验证 null 值
      const nullTokens = tokens.filter((t: Token) => t.kind === TokenKind.NULL);
      assert.ok(nullTokens.length > 0, '应有 空 token');
    });

    it('arithmetic.aster 应正确解析', () => {
      const { tokens } = parseZhCNFile('arithmetic.aster');

      // 验证算术运算关键词
      assert.ok(findIdent(tokens, '加'), '应有 加 关键词');
      assert.ok(findIdent(tokens, '减'), '应有 减 关键词');
      assert.ok(findIdent(tokens, '乘'), '应有 乘 关键词');
      assert.ok(findIdent(tokens, '除以'), '应有 除以 关键词');

      // 验证变量绑定
      const letCount = countIdent(tokens, '令');
      const beCount = countIdent(tokens, '为');
      assert.ok(letCount >= 2, '应有多个 令 关键词');
      assert.ok(beCount >= 2, '应有多个 为 关键词');
    });

    it('所有中文 CNL 文件应成功规范化', () => {
      const files = fs.readdirSync(zhCNDir).filter((f: string) => f.endsWith('.aster'));
      assert.ok(files.length >= 4, '应有至少 4 个 .aster 文件');

      for (const file of files) {
        const { canonical } = parseZhCNFile(file);
        // 验证规范化后不包含智能引号
        assert.ok(!canonical.includes('"'), `${file} 不应包含左智能引号`);
        assert.ok(!canonical.includes('"'), `${file} 不应包含右智能引号`);
        // 验证规范化后包含中文标点
        assert.ok(canonical.includes('。'), `${file} 应包含中文句号`);
      }
    });

    it('中文 CNL 文件的 token 分布应合理', () => {
      const { tokens: helloTokens } = parseZhCNFile('hello.aster');
      const { tokens: loanTokens } = parseZhCNFile('loan_decision.aster');

      // hello.aster 应较短（Codex 审查建议：使用相对比较替代硬编码阈值）
      const helloNonEof = helloTokens.filter((t: Token) => t.kind !== TokenKind.EOF);
      const loanNonEof = loanTokens.filter((t: Token) => t.kind !== TokenKind.EOF);

      // 结构化验证：loan_decision 应比 hello 复杂（至少 2 倍 token 数量）
      assert.ok(
        loanNonEof.length > helloNonEof.length * 2,
        `loan_decision(${loanNonEof.length} tokens)应比hello(${helloNonEof.length} tokens)复杂至少2倍`
      );

      // 验证左右括号平衡
      const helloLparen = countTokenKind(helloTokens, TokenKind.LPAREN);
      const helloRparen = countTokenKind(helloTokens, TokenKind.RPAREN);
      assert.strictEqual(helloLparen, helloRparen, 'hello程序的左右圆括号应平衡');

      const loanLparen = countTokenKind(loanTokens, TokenKind.LPAREN);
      const loanRparen = countTokenKind(loanTokens, TokenKind.RPAREN);
      assert.strictEqual(loanLparen, loanRparen, '贷款程序的左右圆括号应平衡');

      // 新语法不再使用【】标记，方括号应为 0
      const loanLbracket = countTokenKind(loanTokens, TokenKind.LBRACKET);
      assert.strictEqual(loanLbracket, 0, '贷款程序不应有方括号标记');

      const helloLbracket = countTokenKind(helloTokens, TokenKind.LBRACKET);
      assert.strictEqual(helloLbracket, 0, 'hello程序不应有方括号标记');
    });
  });
});
