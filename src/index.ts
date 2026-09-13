/**
 * @module @aster-cloud/aster-lang-ts
 *
 * Aster 语言编译器的主要 API 接口。
 *
 * Aster 是一种实用、安全、快速的编程语言，具有人类可读的受控自然语言（CNL）语法，
 * 编译为 JVM 字节码。编译器管道包括：
 *
 * **编译管道**：
 * ```
 * CNL 源代码 → canonicalize → lex → parse → AST → lowerModule → Core IR → typecheck → JVM
 * ```
 *
 * @example 基础用法
 * ```typescript
 * import { canonicalize, lex, parse, lowerModule } from '@aster-cloud/aster-lang-ts';
 *
 * const src = `Module app. Rule id, produce Int: Return 1.`;
 * const canonical = canonicalize(src);  // 规范化源代码
 * const tokens = lex(canonical);         // 词法分析
 * const ast = parse(tokens);             // 语法分析
 * const core = lowerModule(ast);         // 降级到 Core IR
 * console.log(core);
 * ```
 */

// 编译器管道函数
export { canonicalize } from './frontend/canonicalizer.js';
export { lex } from './frontend/lexer.js';
export { parse, parseWithLexicon } from './parser.js';
export type { ParseResult } from './parser.js';
export { lowerModule } from './lower_to_core.js';

// 关键词翻译（多语言 CNL 支持）
export {
  createKeywordTranslator,
  buildKeywordTranslationIndex,
  buildFullTranslationIndex,
  translateTokens,
  translateTokensWithMarkers,
  translateToken,
  needsKeywordTranslation,
} from './frontend/keyword-translator.js';
export type {
  KeywordTranslationIndex,
  MarkerKeywordIndex,
  TranslationIndexResult,
} from './frontend/keyword-translator.js';

// 核心类型和枚举
export { Core, Effect } from './core/core_ir.js';
export { TokenKind, KW } from './frontend/tokens.js';
export { Node } from './ast/ast.js';

// 类型检查
export {
  typecheckModule,
  typecheckModuleWithCapabilities,
  loadImportedEffects,
} from './typecheck.js';
export type { TypecheckDiagnostic, TypecheckOptions } from './typecheck.js';

// 输入值生成器（用于策略执行时自动生成示例输入）
export {
  generateFieldValue,
  generateInputValues,
  getFieldValueHint,
} from './parser/input-generator.js';
export type {
  TypeKind,
  FieldInfo,
  ParameterInfo,
} from './parser/input-generator.js';

// 类型定义重导出
export type * from './types.js';

// ── ADR 0037 可验证语义桥 ────────────────────────────────────────────
// ★接线后才导出：此前六个模块全是死代码（生产调用数 0、不在导出面内）。
//   `runSemanticBridge` 是唯一入口，内部串起
//   SourceIR → QuantityIR → CandidateGenerator → MappingIR。
export { runSemanticBridge } from './mapping/pipeline.js';
export type { BridgeResult, VerifiedCandidate } from './mapping/pipeline.js';
export { parseSourceIr, nodeAtOffset, verifyCoverage } from './mapping/source-ir.js';
export type { SourceNode, SectionKind } from './mapping/source-ir.js';
export { extractQuantities } from './mapping/quantity-ir.js';
export type { Quantity, QuantityKind, EntityCandidate } from './mapping/quantity-ir.js';
export { verifyMapping } from './mapping/mapping-ir.js';
export type { CandidateMapping, VerificationResult, VerificationVerdict,
  VerifiableNode, TextSpan } from './mapping/mapping-ir.js';
