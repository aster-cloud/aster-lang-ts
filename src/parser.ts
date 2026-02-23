/**
 * Aster Language Parser - 主入口
 * 负责协调各个子模块完成整个模块的解析
 *
 * **多语言 CNL 支持**：
 * - `parse()`: 解析已翻译为英文的 token 流（需要预先调用 keyword-translator）
 * - `parseWithLexicon()`: 自动处理多语言关键词翻译（推荐用于非英文 CNL）
 */

import { Node } from './ast/ast.js';
import type { Module, Token } from './types.js';
import type { Lexicon } from './config/lexicons/types.js';
import { createParserContext } from './parser/context.js';
import { createParserTools } from './parser/parser-tools.js';
import { collectTopLevelDecls } from './parser/decl-parser.js';
import {
  assignSpan,
  firstSignificantToken,
  lastSignificantTokenInStream,
  spanFromTokens,
} from './parser/span-utils.js';
import {
  createKeywordTranslator,
  needsKeywordTranslation,
} from './frontend/keyword-translator.js';
import { attachTypeInferenceRules } from './config/lexicons/type-inference-rules.js';
import { EN_US } from './config/lexicons/en-US.js';

/**
 * 解析标记流生成 AST
 *
 * **注意**：此函数期望 token 流已经是规范化的英文关键词。
 * 对于非英文 CNL，请使用 `parseWithLexicon()` 自动处理翻译。
 *
 * @param tokens 词法标记数组（应为英文关键词或已翻译的 token）
 * @returns 模块 AST
 */
export function parse(tokens: readonly Token[], lexicon?: Lexicon): Module {
  const moduleStart = firstSignificantToken(tokens);
  const ctx = createParserContext(tokens, lexicon);
  const tools = createParserTools(ctx);
  const decls = collectTopLevelDecls(ctx, tools);
  const moduleNode = Node.Module(ctx.moduleName, decls);
  const moduleEnd = lastSignificantTokenInStream(tokens);
  assignSpan(moduleNode, spanFromTokens(moduleStart, moduleEnd));
  return moduleNode;
}

/**
 * 使用指定 Lexicon 解析 token 流。
 *
 * 此函数自动处理多语言关键词翻译，是非英文 CNL 的推荐入口。
 *
 * **工作流程**：
 * 1. 检测 token 流是否需要翻译（源 lexicon != en-US）
 * 2. 如需翻译，使用 keyword-translator 将本地化关键词转换为英文
 * 3. 调用 parse() 进行解析
 *
 * @param tokens 词法标记数组（可以是任意语言的关键词）
 * @param lexicon 源词法表（默认 en-US，即不翻译）
 * @returns 模块 AST
 *
 * @example 解析中文 CNL
 * ```typescript
 * import { canonicalize, lex, parseWithLexicon } from '@aster-cloud/aster-lang-ts';
 * import { ZH_CN } from '@aster-cloud/aster-lang-ts/lexicons/zh-CN';
 *
 * const zhSource = '模块 示例。规则 identity 给定 x：返回 x。';
 * const canonical = canonicalize(zhSource, ZH_CN);
 * const tokens = lex(canonical, ZH_CN);
 * const ast = parseWithLexicon(tokens, ZH_CN); // 自动翻译中文关键词
 * ```
 */
export function parseWithLexicon(
  tokens: readonly Token[],
  lexicon: Lexicon = EN_US
): Module {
  // 如果源 lexicon 与目标（en-US）相同，无需翻译
  if (!needsKeywordTranslation(lexicon)) {
    return parse(tokens);
  }

  // 使用 keyword-translator 将本地化关键词翻译为英文
  const translator = createKeywordTranslator(lexicon);
  const translatedTokens = translator.translateTokens(tokens);

  // 附加类型推断规则后传递给 parse
  const effective = attachTypeInferenceRules(lexicon);
  return parse(translatedTokens, effective);
}
