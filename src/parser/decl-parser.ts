/**
 * 顶层声明解析器
 * 负责解析数据类型定义（Define）和函数定义（Rule）
 */

import { KW, TokenKind } from '../frontend/tokens.js';
import { Node } from '../ast/ast.js';
import type { Annotation, AnnotationArg, AnnotationValue, Block, Declaration, Token, Type } from '../types.js';
import type { Diagnostic } from '../diagnostics/diagnostics.js';
import { toDiagnostic } from '../diagnostics/diagnostics.js';
import type { ParserContext } from './context.js';
import { kwParts, tokLowerAt } from './context.js';
import type { ParserTools } from './parser-tools.js';
import { parseModuleHeader, parseImport } from './import-parser.js';
import { parseType, parseEffectList, separateEffectsAndCaps } from './type-parser.js';
import { parseBlock, parseParamList } from './expr-stmt-parser.js';
import { parseFieldList, parseVariantList } from './field-variant-parser.js';
import { assignSpan, spanFromSources, lastConsumedToken, spanFromTokens } from './span-utils.js';
import type { Span } from '../types.js';

/**
 * R30+ audit P1：原本写满 14 处 {@code (node as any).nameSpan = ...} / variantSpans。
 * 把单一职责的辅助器抽出来：保留 readonly 字段的设计意图（声明阶段不可改），
 * 但允许 parser 在构造完成那一刻一次性写入。所有 nameSpan / variantSpans
 * 在 types.ts 已经声明为 readonly optional，下面的 helper 是唯一允许
 * 突破 readonly 的窗口。
 */
function attachNameSpan<T extends object>(node: T, nameSpan: Span | undefined): T {
  if (nameSpan) {
    (node as { nameSpan?: Span }).nameSpan = nameSpan;
  }
  return node;
}

function attachVariantSpans<T extends object>(node: T, variantSpans: readonly Span[] | undefined): T {
  if (variantSpans && variantSpans.length > 0) {
    (node as { variantSpans?: readonly Span[] }).variantSpans = variantSpans;
  }
  return node;
}

function parseEffectParams(
  ctx: ParserContext,
  skipLayoutTrivia: () => void,
  error: (msg: string) => never
): string[] {
  if (!ctx.at(TokenKind.LT)) return [];
  const names: string[] = [];
  ctx.next(); // consume '<'
  skipLayoutTrivia();
  let more = true;
  while (more) {
    skipLayoutTrivia();
    if (!ctx.at(TokenKind.TYPE_IDENT)) {
      error("Expected effect type parameter (capitalized identifier)");
    }
    names.push(ctx.next().value as string);
    skipLayoutTrivia();
    if (ctx.at(TokenKind.COMMA)) {
      ctx.next();
      skipLayoutTrivia();
      continue;
    }
    if (ctx.isKeyword(KW.AND)) {
      ctx.nextWord();
      skipLayoutTrivia();
      continue;
    }
    more = false;
  }
  if (!ctx.at(TokenKind.GT)) {
    error("Expected '>' after effect parameter list");
  }
  ctx.next(); // consume '>'
  skipLayoutTrivia();
  return names;
}

function parseAnnotationValue(ctx: ParserContext, error: (msg: string, tok?: Token) => never): AnnotationValue {
  const tok = ctx.peek();
  switch (tok.kind) {
    case TokenKind.STRING:
    case TokenKind.INT:
    case TokenKind.FLOAT:
    case TokenKind.LONG:
    case TokenKind.BOOL:
    case TokenKind.NULL:
      ctx.next();
      return tok.value as AnnotationValue;
    case TokenKind.IDENT:
    case TokenKind.TYPE_IDENT:
      ctx.next();
      return tok.value as string;
    default:
      error('Expected annotation argument value', tok);
  }
}

function parseAnnotationArgs(ctx: ParserContext, error: (msg: string, tok?: Token) => never): readonly AnnotationArg[] | undefined {
  if (!ctx.at(TokenKind.LPAREN)) return undefined;
  ctx.next();
  const args: AnnotationArg[] = [];
  while (!ctx.at(TokenKind.RPAREN) && !ctx.at(TokenKind.EOF)) {
    if (!ctx.at(TokenKind.IDENT) && !ctx.at(TokenKind.TYPE_IDENT)) {
      error('Expected annotation argument name');
    }
    const name = String(ctx.next().value);
    if (!ctx.at(TokenKind.COLON)) {
      error("Expected ':' after annotation argument name");
    }
    ctx.next();
    const value = parseAnnotationValue(ctx, error);
    args.push({ name, value });
    if (ctx.at(TokenKind.COMMA)) {
      ctx.next();
      continue;
    }
    break;
  }
  if (!ctx.at(TokenKind.RPAREN)) {
    error("Expected ')' after annotation arguments");
  }
  ctx.next();
  return args;
}

function parseDeclAnnotations(
  ctx: ParserContext,
  error: (msg: string, tok?: Token) => never
): { annotations: readonly Annotation[]; startTok?: Token } {
  const annotations: Annotation[] = [];
  let startTok: Token | undefined;
  while (ctx.at(TokenKind.AT)) {
    const atTok = ctx.next();
    startTok ??= atTok;
    if (!ctx.at(TokenKind.IDENT) && !ctx.at(TokenKind.TYPE_IDENT)) {
      error("Expected annotation name after '@'");
    }
    const name = String(ctx.next().value);
    const args = parseAnnotationArgs(ctx, error);
    annotations.push(args && args.length > 0 ? { name, args } : { name });
    ctx.consumeNewlines();
  }
  return startTok ? { annotations, startTok } : { annotations };
}

/**
 * 解析数据类型定义
 * 语法: Define User has name: Text and age: Int.
 *
 * @param ctx 解析器上下文
 * @param error 错误报告函数
 * @param expectDot 期望点号的辅助函数
 * @param parseTypeIdent 解析类型标识符的辅助函数
 * @returns 数据类型声明
 */
export function parseDataDecl(
  ctx: ParserContext,
  error: (msg: string, tok?: Token) => never,
  expectDot: () => void,
  parseTypeIdent: () => string
): Declaration {
  // 期望: Define
  const defineTok = ctx.peek();
  ctx.nextWord();

  // 解析类型名
  const typeName = parseTypeIdent();

  // 期望: with / has
  if (!ctx.isKeywordSeq(KW.WITH) && !ctx.isKeywordSeq(KW.HAS)) {
    error("Expected 'has' after type name in data definition");
  }
  ctx.nextWord();

  // 解析字段列表
  const fields = parseFieldList(ctx, error);

  // 期望句点结束
  expectDot();
  const endTok = ctx.tokens[ctx.index - 1] || ctx.peek();

  // 创建 Data 节点并注册类型
  const dataDecl = Node.Data(typeName, fields);
  const lastFieldSource = fields.length > 0 ? fields[fields.length - 1]! : endTok;
  assignSpan(dataDecl, spanFromSources(defineTok, lastFieldSource, endTok));
  ctx.declaredTypes.add(typeName);

  return dataDecl;
}

/**
 * 解析枚举类型定义
 * 语法: Define Status as one of Success, Failure, Pending.
 *
 * @param ctx 解析器上下文
 * @param error 错误报告函数
 * @param expectDot 期望点号的辅助函数
 * @param parseTypeIdent 解析类型标识符的辅助函数
 * @returns 枚举类型声明
 */
export function parseEnumDecl(
  ctx: ParserContext,
  error: (msg: string, tok?: Token) => never,
  expectDot: () => void,
  parseTypeIdent: () => string
): Declaration {
  // 期望: Define
  const defineTok = ctx.peek();
  ctx.nextWord();

  // 解析类型名
  const typeName = parseTypeIdent();

  // 期望: as one of
  if (!ctx.isKeywordSeq(KW.ONE_OF)) {
    error("Expected 'as one of' after type name in enum definition");
  }
  ctx.nextWords(kwParts(KW.ONE_OF));

  // 解析变体列表
  const { variants, variantSpans } = parseVariantList(ctx, error);

  // 期望句点结束
  expectDot();
  const endTok = ctx.tokens[ctx.index - 1] || ctx.peek();

  // 创建 Enum 节点并附加变体 spans
  const en = Node.Enum(typeName, variants);
  if (variantSpans && variantSpans.length > 0) {
    const lastVariantSpan = variantSpans[variantSpans.length - 1]!;
    assignSpan(en, spanFromSources(defineTok, { span: lastVariantSpan }, endTok));
  } else {
    assignSpan(en, spanFromSources(defineTok, endTok));
  }
  attachVariantSpans(en, variantSpans);
  ctx.declaredTypes.add(typeName);

  return en;
}

/**
 * 解析函数定义
 * 语法: Rule greet given name: Text, produce Text. It performs io: ...
 *
 * @param ctx 解析器上下文
 * @param error 错误报告函数
 * @param expectCommaOr 期望逗号或允许省略的辅助函数
 * @param expectKeyword 期望关键字的辅助函数
 * @param expectNewline 期望换行的辅助函数
 * @param parseIdent 解析标识符的辅助函数
 * @returns 函数声明
 */
export function parseFuncDecl(
  ctx: ParserContext,
  error: (msg: string, tok?: Token) => never,
  expectCommaOr: () => void,
  expectKeyword: (kw: string, msg: string) => void,
  expectNewline: () => void,
  parseIdent: () => string,
  annotations: readonly Annotation[] = [],
  declStartTok?: Token
): Declaration {
  // 记录函数起始位置
  const toTok = declStartTok ?? ctx.peek();
  ctx.nextWord(); // 消费 'Rule'

  // 记录函数名位置
  const nameTok = ctx.peek();
  const name = parseIdent();
  // 立即记录函数名结束位置（修复 nameSpan Bug）
  const nameEndTok = ctx.tokens[ctx.index - 1] || nameTok;

  const skipLayoutTrivia = (): void => {
    let prevIndex = -1;
    while (prevIndex !== ctx.index) {
      prevIndex = ctx.index;
      ctx.consumeNewlines();
      while (ctx.at(TokenKind.INDENT) || ctx.at(TokenKind.DEDENT)) {
        ctx.next();
        ctx.consumeNewlines();
      }
    }
  };

  // 允许函数名后换行或缩进
  skipLayoutTrivia();

  // 解析可选的类型参数: 'of' TypeId ('and' TypeId)*
  let typeParams: string[] = [];
  skipLayoutTrivia();
  if (ctx.isKeyword('of')) {
    ctx.nextWord();
    skipLayoutTrivia();
    let more = true;
    while (more) {
      skipLayoutTrivia();
      // 如果遇到参数列表或 produce 子句，停止
      if (ctx.isKeyword(KW.WITH) || ctx.isKeyword(KW.GIVEN) || ctx.isKeyword(KW.PRODUCE) || ctx.at(TokenKind.COLON)) {
        break;
      }
      // 解析类型变量名（优先 TYPE_IDENT，回退到 IDENT）
      const tv = ctx.at(TokenKind.TYPE_IDENT)
        ? (ctx.next().value as string)
        : parseIdent();
      typeParams.push(tv);

      skipLayoutTrivia();
      if (ctx.isKeyword(KW.AND)) {
        ctx.nextWord();
        skipLayoutTrivia();
        continue;
      }
      if (ctx.at(TokenKind.COMMA)) {
        ctx.next();
        skipLayoutTrivia();
        // 如果逗号后面跟 'with'/'given' 或 produce，停止
        if (ctx.isKeyword(KW.WITH) || ctx.isKeyword(KW.GIVEN) || ctx.isKeyword(KW.PRODUCE)) {
          more = false;
          break;
        }
        continue;
      }
      more = false;
    }
  }

  skipLayoutTrivia();

  let effectParams: string[] = [];
  if (ctx.at(TokenKind.LT)) {
    effectParams = parseEffectParams(ctx, skipLayoutTrivia, error);
  }

  // 保存当前类型变量与效应变量作用域，设置新的作用域
  const savedTypeVars = new Set(ctx.currentTypeVars);
  const savedEffectVars = new Set(ctx.currentEffectVars);
  ctx.currentTypeVars = new Set(typeParams);
  ctx.currentEffectVars = new Set(effectParams);
  const activeEffectVars = ctx.currentEffectVars;

  // 解析参数列表
  skipLayoutTrivia();
  const params = parseParamList(ctx, error);
  skipLayoutTrivia();
  if (params.length > 0) expectCommaOr();
  else if (ctx.at(TokenKind.COMMA)) ctx.next();

  // `produce` 子句可选（与 core grammar `(PRODUCE annotatedType?)?` 对齐，ADR 0019 G0）：
  //   - `produce T`：显式返回类型
  //   - `produce`（无类型）/ `produce .` / `produce :`：返回类型推断
  //   - 完全省略 produce（`Rule greet given name:` 直接接块/`.`/`It performs`）：同样推断
  // 省略 produce 时直接走下方场景分派（COLON 块 / DOT 无体 / It performs）。
  skipLayoutTrivia();
  const produceTok = ctx.peek();
  let retType: Type;
  let retTypeInferred = false;
  if (ctx.isKeyword(KW.PRODUCE)) {
    ctx.nextWords(kwParts(KW.PRODUCE));
    skipLayoutTrivia();
    if (
      ctx.at(TokenKind.COLON) ||
      ctx.at(TokenKind.DOT) ||
      ctx.isKeyword(KW.WITH) ||
      ctx.isKeywordSeq(KW.PERFORMS) ||
      (tokLowerAt(ctx, ctx.index) === 'it' && tokLowerAt(ctx, ctx.index + 1) === 'performs')
    ) {
      retTypeInferred = true;
      retType = Node.TypeName('Unknown');
      assignSpan(retType, spanFromTokens(produceTok, produceTok));
    } else {
      retType = parseType(ctx, error);
    }
  } else {
    // 完全省略 produce：返回类型推断，直接进入函数体/效果场景分派。
    retTypeInferred = true;
    retType = Node.TypeName('Unknown');
    assignSpan(retType, spanFromTokens(produceTok, produceTok));
  }

  let effects: string[] = [];
  // 允许在返回类型后声明效果：produce Result ... with IO.
  if (ctx.isKeyword(KW.WITH)) {
    const retTypeEffects = parseEffectList(ctx, error);
    effects.push(...retTypeEffects);
    skipLayoutTrivia();
  }
  // 准备收集函数体内的效果声明
  const prevCollected: string[] | null = ctx.collectedEffects;
  ctx.collectedEffects = [];
  let body: Block | null = null;

  // 解析效果声明和函数体
  // 场景1: produce Type. It performs io: ...
  if (ctx.at(TokenKind.DOT)) {
    ctx.next();
    ctx.consumeNewlines();
    if (
      ctx.isKeywordSeq(KW.PERFORMS) ||
      (tokLowerAt(ctx, ctx.index) === 'it' && tokLowerAt(ctx, ctx.index + 1) === 'performs')
    ) {
      if (!ctx.isKeywordSeq(KW.PERFORMS)) ctx.nextWord();
      ctx.nextWords(kwParts(KW.PERFORMS));
      effects = parseEffectList(ctx, error);
      if (ctx.at(TokenKind.DOT)) {
        ctx.next();
      } else if (ctx.at(TokenKind.COLON)) {
        ctx.next();
        expectNewline();
        body = parseBlock(ctx, error);
        // 如果 parseBlock 没有消费 DEDENT（多行参数情况），这里消费它
        if (ctx.at(TokenKind.DEDENT)) {
          ctx.next();
        }
      } else {
        error("Expected '.' or ':' after effect clause");
      }
    }
  }
  // 场景2: produce Type. It performs io: ...（内联效果）
  else if (
    ctx.isKeywordSeq(KW.PERFORMS) ||
    (tokLowerAt(ctx, ctx.index) === 'it' && tokLowerAt(ctx, ctx.index + 1) === 'performs')
  ) {
    if (!ctx.isKeywordSeq(KW.PERFORMS)) ctx.nextWord();
    ctx.nextWords(kwParts(KW.PERFORMS));
    effects = parseEffectList(ctx, error);
    if (ctx.at(TokenKind.DOT)) {
      ctx.next();
    } else if (ctx.at(TokenKind.COLON)) {
      ctx.next();
      expectNewline();
      body = parseBlock(ctx, error);
      // 如果 parseBlock 没有消费 DEDENT（多行参数情况），这里消费它
      if (ctx.at(TokenKind.DEDENT)) {
        ctx.next();
      }
    } else {
      error("Expected '.' or ':' after effect clause");
    }
  }
  // 场景3: produce Type: ...（直接进入函数体）
  else if (ctx.at(TokenKind.COLON)) {
    ctx.next();
    expectNewline();
    body = parseBlock(ctx, error);
    // 如果 parseBlock 没有消费 DEDENT（多行参数情况），这里消费它
    if (ctx.at(TokenKind.DEDENT)) {
      ctx.next();
    }
  } else {
    error("Expected '.' or ':' after return type");
  }

  // 如果没有显式声明类型参数，尝试从类型使用中推断
  if (typeParams.length === 0) {
    const BUILTINS = new Set(['Int', 'Bool', 'Text', 'Long', 'Double', 'Number', 'Float', 'Option', 'Result', 'List', 'Map']);
    const found = new Set<string>();

    const visitType = (t: Type): void => {
      switch (t.kind) {
        case 'TypeName':
          if (
            /^[A-Z][A-Za-z0-9_]*$/.test(t.name) &&
            !BUILTINS.has(t.name) &&
            !ctx.declaredTypes.has(t.name)
          ) {
            found.add(t.name);
          }
          break;
        case 'TypeApp':
          t.args.forEach(visitType);
          break;
        // R30+ audit P1：TypeScript 在 union 上对 'kind' 已经能精确收窄，
        // 这里直接用收窄后的 t，不需要 as any。
        case 'Maybe':
        case 'Option':
        case 'List':
          visitType(t.type);
          break;
        case 'Result':
          visitType(t.ok);
          visitType(t.err);
          break;
        case 'Map':
          visitType(t.key);
          visitType(t.val);
          break;
        case 'FuncType':
          t.params.forEach(visitType);
          visitType(t.ret);
          break;
        default:
          break;
      }
    };

    for (const p of params) visitType(p.type);
    visitType(retType);
    if (found.size > 0) {
      typeParams = Array.from(found);
    }
  }

  const endTok = ctx.tokens[ctx.index - 1] || ctx.peek();

  // 合并函数体内收集的效果
  if (Array.isArray(ctx.collectedEffects) && ctx.collectedEffects.length > 0) {
    effects = effects.concat(ctx.collectedEffects);
  }

  // 恢复效果收集器和类型参数作用域
  ctx.collectedEffects = prevCollected;
  ctx.currentTypeVars = savedTypeVars;

  // 分离基本效果和能力约束
  const { baseEffects, effectCaps, hasExplicitCaps, effectVars } = separateEffectsAndCaps(
    effects,
    error,
    activeEffectVars
  );
  ctx.currentEffectVars = savedEffectVars;
  const declaredEffects = [...baseEffects, ...effectVars];

  // 创建函数节点并附加元数据
  const fn = Node.Func(
    name,
    typeParams,
    params,
    retType,
    declaredEffects,
    effectCaps,
    hasExplicitCaps,
    body,
    effectParams,
    annotations
  );
  if (retTypeInferred) {
    (fn as { retTypeInferred?: boolean }).retTypeInferred = true;
  }
  const funcEndSource = body ?? endTok;
  assignSpan(fn, spanFromSources(toTok, funcEndSource, endTok));
  // 记录函数名 span 用于精确导航/高亮
  attachNameSpan(fn, spanFromSources(nameTok, nameEndTok));

  return fn;
}

/**
 * 收集模块顶层声明
 * 遍历 token 流，解析模块头、导入、类型定义和函数声明
 *
 * @param ctx 解析器上下文
 * @param tools 解析器工具函数集合
 * @returns 声明数组
 */
/**
 * 同步到下一个声明级 token（错误恢复用）
 *
 * 跳过 token 直到遇到声明起始关键字（Module/Rule/Define/Use）或 EOF。
 * 保证至少推进一个 token 以避免无限循环。
 *
 * <p>多语言安全：调用 syncToNextDecl 时 token 流已经过
 * {@link parseWithLexicon} → {@link createKeywordTranslator} 翻译为
 * canonical 英文，因此这里只需匹配英文字面量。stop-set 直接引用 KW
 * 常量以避免与 collectTopLevelDecls 的 isKeywordSeq(KW.X) 入口集漂移。
 */
const DECL_STOP_KEYWORDS: ReadonlySet<string> = new Set([
  KW.MODULE_IS,
  KW.RULE,
  KW.DEFINE,
  KW.USE,
]);

function syncToNextDecl(ctx: ParserContext): void {
  let advanced = false;
  while (!ctx.at(TokenKind.EOF)) {
    const val = ctx.peek().value;
    if (advanced && val !== null) {
      const lower = typeof val === 'string' ? val.toLowerCase() : '';
      if (DECL_STOP_KEYWORDS.has(lower)) {
        break;
      }
    }
    ctx.next();
    advanced = true;
  }
}

/**
 * 预扫描所有顶层类型声明名（Define / Type alias），先于正式解析填充 ctx.declaredTypes。
 * <p>
 * 与 aster-lang-core 的 AstBuilder 预扫描对齐：Java 在建 AST 前先遍历全部 topLevelDecl
 * 登记类型名，因此【前向引用】的位置式构造（在 Define 之前用 TypeName(...)）也能被识别。
 * TS 原先是单遍顺序解析，类型声明在后面时 declaredTypes 尚未登记 → 与 Java 行为不一致
 * （位置式构造禁止规则一边拦一边放）。本预扫描消除该 parity 破坏。
 *
 * <b>口径收窄</b>：只识别【顶层声明位置】的 `define`/`type`，避免把它们作为字段名/普通词
 * 出现在其它上下文时误登记（如 `Define Event has type Foo` 里的字段名 `type` 不该让 `Foo`
 * 被当类型名）。顶层位置 = 该关键词前一个有意义 token 是 NEWLINE/DEDENT/DOT，或它是流首。
 * 另外 `type` 仅当形如 `type <Name> as`（别名声明）才登记，与字段/注解用法区分。
 */
function prescanDeclaredTypes(ctx: ParserContext): void {
  const tokens = ctx.tokens;
  // 顶层声明起始的边界 token：声明前必是换行/反缩进/上一声明的句末点，或流首。
  const isDeclBoundary = (idx: number): boolean => {
    for (let j = idx - 1; j >= 0; j--) {
      const k = tokens[j]!.kind;
      if (k === TokenKind.INDENT) continue; // 顶层不应有 INDENT，但跳过以稳健
      return k === TokenKind.NEWLINE || k === TokenKind.DEDENT || k === TokenKind.DOT;
    }
    return true; // 流首
  };
  for (let i = 0; i < tokens.length; i++) {
    const v = tokLowerAt(ctx, i);
    if (v !== KW.DEFINE && v !== KW.TYPE) continue;
    if (!isDeclBoundary(i)) continue; // 非顶层声明位置（如字段名 type）跳过
    const nameTok = tokens[i + 1];
    if (!nameTok || (nameTok.kind !== TokenKind.IDENT && nameTok.kind !== TokenKind.TYPE_IDENT)) {
      continue;
    }
    if (v === KW.TYPE) {
      // 类型别名须形如 `type <Name> as ...`；否则 type 是字段名/其它用法，不登记。
      const afterName = tokens[i + 2];
      if (!afterName || (afterName.value as string)?.toLowerCase() !== KW.AS) {
        continue;
      }
      // type alias 别名标量，不可构造 → 只进 declaredTypes（类型解析），不进 record 集。
      ctx.declaredTypes.add(nameTok.value as string);
    } else {
      // Define 记录类型（Data/Enum）：可构造 → 两个集合都进。
      ctx.declaredTypes.add(nameTok.value as string);
      ctx.declaredRecordTypes.add(nameTok.value as string);
    }
  }
}

export function collectTopLevelDecls(
  ctx: ParserContext,
  tools: ParserTools
): { decls: Declaration[]; diagnostics: Diagnostic[] } {
  const decls: Declaration[] = [];
  const diagnostics: Diagnostic[] = [];
  // 预扫描类型名，支持前向引用 + 与 Java 引擎 parity（见函数注释）
  prescanDeclaredTypes(ctx);
  ctx.skipTrivia(); // 跳过开头的注释
  ctx.consumeNewlines();

  while (!ctx.at(TokenKind.EOF)) {
    ctx.consumeNewlines();
    while (ctx.at(TokenKind.DEDENT)) ctx.next();
    while (ctx.at(TokenKind.INDENT)) ctx.next();
    ctx.consumeNewlines();
    if (ctx.at(TokenKind.EOF)) break;

    try {
      // 解析模块头: Module foo.bar.
      if (ctx.isKeywordSeq(KW.MODULE_IS)) {
        parseModuleHeader(ctx, tools.error, tools.expectDot);
      }
      // 解析导入: use foo.bar. 或 use foo.bar as Baz.
      else if (ctx.isKeyword(KW.USE)) {
        const startTok = ctx.peek();
        const { name, version, asName } = parseImport(ctx, tools.error, tools.expectDot, tools.parseIdent);
        const endTok = lastConsumedToken(ctx);
        const importNode = Node.Import(name, asName, version);
        assignSpan(importNode, spanFromTokens(startTok, endTok));
        decls.push(importNode);
      }
      // 解析类型定义: Define ...
      else if (ctx.isKeyword(KW.DEFINE)) {
        // 记录起始 token 并消费 'Define' 关键字
        const defineTok = ctx.nextWord();
        // 解析类型名
        const typeName = tools.parseTypeIdent();

        // 判断是 Data 还是 Enum
        if (ctx.isKeywordSeq(KW.WITH) || ctx.isKeywordSeq(KW.HAS)) {
          const startTok = defineTok;
          // Data: Define User with ...
          ctx.nextWord();
          const fields = parseFieldList(ctx, tools.error);
          tools.expectDot();
          const dataDecl = Node.Data(typeName, fields);
          const endTok = lastConsumedToken(ctx);
          assignSpan(dataDecl, spanFromTokens(startTok, endTok));
          ctx.declaredTypes.add(typeName);
          decls.push(dataDecl);
        } else if (ctx.isKeywordSeq(KW.ONE_OF)) {
          const startTok = defineTok;
          // Enum: Define Status as one of ...
          ctx.nextWords(kwParts(KW.ONE_OF));
          const { variants, variantSpans } = parseVariantList(ctx, tools.error);
          tools.expectDot();
          const en = Node.Enum(typeName, variants);
          const endTok = lastConsumedToken(ctx);
          assignSpan(en, spanFromTokens(startTok, endTok));
          if (variantSpans && Array.isArray(variantSpans)) {
            attachVariantSpans(en, variantSpans);
          }
          ctx.declaredTypes.add(typeName);
          decls.push(en);
        } else {
          tools.error("Expected 'has' or 'as one of' after type name");
        }
      }
      // 解析类型别名: Type Score as Int.
      // 与 aster-lang-core 对齐：别名是纯语法/类型层构造，Core IR 不为其产出任何
      // 声明（Java 的 CoreLowering 对 TypeAlias 静默跳过）。这里消费语法并把别名
      // 名登记进 declaredTypes（供后续类型引用解析），但不向 AST 推入声明，从而两
      // 引擎的 Core IR 保持一致（皆无 type-alias 节点）。
      else if (ctx.isKeyword(KW.TYPE)) {
        ctx.nextWord(); // 消费 'Type'
        const aliasName = tools.parseTypeIdent();
        tools.expectKeyword(KW.AS, "Expected 'as' after type alias name");
        parseType(ctx, tools.error); // 消费别名目标类型（值被丢弃）
        tools.expectDot();
        ctx.declaredTypes.add(aliasName);
      }
      // 解析带声明级注解的函数: @entry Rule ...
      else if (ctx.at(TokenKind.AT)) {
        const { annotations, startTok } = parseDeclAnnotations(ctx, tools.error);
        if (!ctx.isKeyword(KW.RULE)) {
          tools.error("Expected 'Rule' after declaration annotations");
        }
        decls.push(parseFuncDecl(ctx, tools.error, tools.expectCommaOr, tools.expectKeyword, tools.expectNewline, tools.parseIdent, annotations, startTok));
      }
      // 解析函数: Rule ...
      else if (ctx.isKeyword(KW.RULE)) {
        decls.push(parseFuncDecl(ctx, tools.error, tools.expectCommaOr, tools.expectKeyword, tools.expectNewline, tools.parseIdent));
      }
      // 容忍顶层的空白/缩进/反缩进
      else if (ctx.at(TokenKind.NEWLINE) || ctx.at(TokenKind.DEDENT) || ctx.at(TokenKind.INDENT)) {
        ctx.next();
      }
      // 其他情况报错
      else {
        tools.error('Unexpected token at top level');
      }
    } catch (e) {
      diagnostics.push(toDiagnostic(e));
      syncToNextDecl(ctx);
    }

    ctx.consumeNewlines();
  }

  return { decls, diagnostics };
}
