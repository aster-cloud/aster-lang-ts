/**
 * @module config/lexicons/identifiers/examples/canonicalizer-integration
 *
 * 示例：如何在 Canonicalizer 中集成标识符映射。
 *
 * 这个文件展示了标识符翻译功能如何与现有的关键词翻译功能配合工作。
 */

import {
  vocabularyRegistry,
  initBuiltinVocabularies,
  IdentifierIndex,
  canonicalizeIdentifier,
  localizeIdentifier,
} from '../index.js';

/**
 * 示例：标识符规范化器。
 *
 * 在 Canonicalizer 的处理流程中，这个类负责将本地化标识符转换为规范化名称。
 */
export class IdentifierCanonicalizer {
  private index: IdentifierIndex | undefined;

  constructor(
    private readonly domain: string,
    private readonly locale: string
  ) {
    this.index = vocabularyRegistry.getIndex(domain, locale);
  }

  /**
   * 将源代码中的标识符规范化。
   *
   * @param source - 原始源代码
   * @returns 规范化后的源代码
   */
  canonicalize(source: string): string {
    if (!this.index) {
      return source; // 没有词汇表，返回原始代码
    }

    let result = source;

    // 遍历所有映射，替换本地化名称为规范化名称
    for (const [localized, canonical] of this.index.toCanonical) {
      // 使用正则表达式进行全词匹配替换
      // 注意：需要处理中文没有空格分隔的特点
      const regex = new RegExp(this.escapeRegExp(localized), 'gi');
      result = result.replace(regex, canonical);
    }

    return result;
  }

  /**
   * 将规范化后的代码本地化（用于显示）。
   *
   * @param source - 规范化的源代码
   * @returns 本地化后的源代码
   */
  localize(source: string): string {
    if (!this.index) {
      return source;
    }

    let result = source;

    for (const [canonical, localized] of this.index.toLocalized) {
      const regex = new RegExp(`\\b${this.escapeRegExp(canonical)}\\b`, 'gi');
      result = result.replace(regex, localized);
    }

    return result;
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// ===========================================
// 使用示例
// ===========================================

/**
 * 演示：将中文策略代码规范化。
 */
function demo() {
  // 1. 初始化词汇表
  initBuiltinVocabularies();

  // 2. 创建标识符规范化器
  const canonicalizer = new IdentifierCanonicalizer('insurance.auto', 'zh-CN');

  // 3. 原始中文代码
  const chineseSource = `
【模块】保险.汽车。

【定义】驾驶员 包含 年龄：整数，驾龄：整数，事故次数：整数。

【定义】报价结果 包含 批准：布尔，原因：文本，月保费：整数。

生成报价 入参 驾驶员：驾驶员，产出 报价结果：
  若 驾驶员.年龄 小于 18：
    返回 报价结果 with 批准 = 假, 原因 = "未满18岁", 月保费 = 0.
  令 因子 为 计算年龄因子(驾驶员.年龄)。
  返回 报价结果 with 批准 = 真, 原因 = "审批通过", 月保费 = 因子.
  `;

  // 4. 规范化（标识符翻译）
  const canonicalized = canonicalizer.canonicalize(chineseSource);

  console.log('=== 原始中文代码 ===');
  console.log(chineseSource);
  console.log('\n=== 规范化后代码 ===');
  console.log(canonicalized);

  // 5. 预期输出（标识符已翻译）：
  // 【模块】保险.汽车。
  //
  // 【定义】Driver 包含 age：整数，drivingYears：整数，accidents：整数。
  //
  // 【定义】QuoteResult 包含 approved：布尔，reason：文本，monthlyPremium：整数。
  //
  // generateQuote 入参 driver：Driver，产出 QuoteResult：
  //   若 driver.age 小于 18：
  //     返回 QuoteResult with approved = 假, reason = "未满18岁", monthlyPremium = 0.
  //   令 因子 为 calculateAgeFactor(driver.age)。
  //   返回 QuoteResult with approved = 真, reason = "审批通过", monthlyPremium = 因子.

  // 注意：关键词（若、令、返回）由现有的 Canonicalizer 处理
  // 标识符映射只负责结构体、字段、函数名称的翻译
}

/**
 * 演示：完整的翻译流程。
 *
 * 1. 标识符规范化（本模块）
 * 2. 关键词规范化（现有 Canonicalizer）
 * 3. ANTLR 解析
 */
function fullPipelineDemo() {
  console.log(`
===========================================
完整翻译流程
===========================================

用户输入（纯中文）:
  【定义】驾驶员 包含 年龄：整数。

步骤 1 - 标识符翻译（本模块）:
  【定义】Driver 包含 age：整数。

步骤 2 - 关键词翻译（Canonicalizer）:
  Define Driver with age: Int.

步骤 3 - ANTLR 解析:
  AST: TypeDef(name="Driver", fields=[Field(name="age", type="Int")])
  `);
}

// 如果直接运行此文件
if (typeof require !== 'undefined' && require.main === module) {
  demo();
  fullPipelineDemo();
}

export { demo, fullPipelineDemo };
