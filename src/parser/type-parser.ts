import type { PiiDataCategory, PiiSensitivityLevel, Token, Type } from '../types.js';
import { kwq } from './keyword-display.js';
import type { ParserContext } from './context.js';
import { kwParts, MAX_TYPE_RECURSION_DEPTH } from './context.js';
import { TokenKind, KW } from '../frontend/tokens.js';
import { Node } from '../ast/ast.js';
import { Diagnostics } from '../diagnostics/diagnostics.js';
import { isCapabilityKind } from '../effects/capabilities.js';
import type { CapabilityKind } from '../config/semantic.js';
import { assignSpan, spanFromSources, spanFromTokens } from './span-utils.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import { acceptedAfterNewline, headerNewlineIssue, Issue, kwParam, lit, tokenName, type ParseErrorFn } from './parse-issue.js';
import { skipAnnotationsFrom } from './annotation-parser.js';

/**
 * 控制流/声明关键词集合——在类型位置出现时不应被视为类型名。
 * 用于非拉丁文脚本的 IDENT 歧义消解。
 */
const CONTROL_KEYWORDS: Set<string> = new Set([
  KW.MODULE_IS, KW.USE, KW.AS, KW.DEFINE, KW.HAS, KW.WITH,
  KW.RULE, KW.GIVEN, KW.PRODUCE, KW.PERFORMS,
  KW.IF, KW.OTHERWISE, KW.MATCH, KW.WHEN,
  KW.RETURN, KW.IN, KW.LET, KW.BE, KW.SET, KW.TO_WORD,
  KW.OR, KW.AND, KW.NOT,
  KW.PLUS, KW.MINUS, KW.TIMES, KW.DIVIDED_BY,
  KW.LESS_THAN, KW.GREATER_THAN, KW.EQUALS_TO, KW.UNDER, KW.OVER, KW.MORE_THAN,
  KW.START, KW.ASYNC, KW.AWAIT,
]);

function isControlKeyword(value: string): boolean {
  return CONTROL_KEYWORDS.has(value);
}

/**
 * aster-lang-core 词法（AsterLexer.g4）保留为关键词 token、因而不是 IDENT 的小写单词。
 * core 文法 `IT PERFORMS IDENT` 在效果名位置拒绝它们；ts 词法把它们当 IDENT，
 * 所以接受未知效果名时须按同一集合排除，保持两端结论一致（#304）。
 * 只列 core 的保留词：ts 的软关键词（如 maybe、profile、in）在 core 是 IDENT，照常接受。
 * true / false / null 在 ts 已是字面量 token，不会走到这里。
 */
const CORE_RESERVED_WORDS: ReadonlySet<string> = new Set([
  'times', 'modulo', 'plus', 'minus', 'module', 'rule', 'given', 'to', 'with', 'and', 'or',
  'produce', 'has', 'set', 'define', 'type', 'as', 'one', 'of', 'use', 'version', 'let', 'be',
  'return', 'apply', 'if', 'then', 'else', 'otherwise', 'match', 'when', 'not', 'start', 'wait',
  'for', 'async', 'workflow', 'step', 'retry', 'timeout', 'depends', 'on', 'compensate', 'max',
  'attempts', 'backoff', 'seconds', 'second', 'required', 'between', 'function', 'performs',
]);

/**
 * 解析效果列表（io, cpu, 能力等）
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 * @returns 效果字符串数组
 */
export function parseEffectList(
  ctx: ParserContext,
  error: ParseErrorFn,
  funcName = ''
): string[] {
  const effs: string[] = [];

  // Parse base effect (io or cpu)
  if (ctx.isKeyword(KW.IO)) {
    ctx.nextWord();
    effs.push('io');
  }
  if (ctx.isKeyword(KW.CPU)) {
    ctx.nextWord();
    effs.push('cpu');
  }
  // 其它基效果名（如 pure、teleport）原样接受，与 aster-lang-core 文法 `IT PERFORMS IDENT` 一致（#304）：
  // 未知名不在解析期报错，检查阶段按 pure 处理，名字原样保留到 IR。能力名一律是 TYPE_IDENT，不会走到这里；
  // core 的保留词（return、to、async、with、and 等）不是 IDENT，同样不接受。
  if (effs.length === 0 && ctx.at(TokenKind.IDENT) && !CORE_RESERVED_WORDS.has(String(ctx.peek().value).toLowerCase())) {
    effs.push(ctx.next().value as string);
  }
  // 效应位置上的大写名字（ADR 0055 #5，与 Java AstBuilder.classifyEffectClause 一致）：已声明的效应参数是效应变量；
  // 未声明的报 E210，IR 中因此不会出现未声明的效应变量
  if (effs.length === 0 && ctx.at(TokenKind.TYPE_IDENT)) {
    const tok = ctx.peek();
    const written = String(tok.value);
    if (!ctx.currentEffectVars.has(written) && !['io', 'cpu', 'pure'].includes(written.toLowerCase())) {
      error({
        code: ErrorCode.EFFECT_VAR_UNDECLARED,
        params: { var: written, func: funcName },
        message: `Effect variable ${written} undeclared in '${funcName}'`,
      }, tok);
    }
    ctx.next();
    effs.push(written);
  }

  // Parse optional capability list with 'with' keyword
  // Example: io with Http and Sql and Time
  if (ctx.isKeyword(KW.WITH)) {
    ctx.nextWord(); // consume 'with'

    // First capability after 'with'
    if (!ctx.at(TokenKind.TYPE_IDENT)) {
      error(Issue.expectedAfter(tokenName('capabilityName'), kwParam(KW.WITH), `Expected capability name (capitalized identifier) after ${kwq(ctx, KW.WITH)}`));
    }
    const cap = ctx.next().value as string;
    effs.push(cap);

    // Additional capabilities with 'and' separator
    while (ctx.isKeyword(KW.AND)) {
      ctx.nextWord(); // consume 'and'
      if (!ctx.at(TokenKind.TYPE_IDENT)) {
        error(Issue.expectedAfter(tokenName('capabilityName'), kwParam(KW.AND), `Expected capability name (capitalized identifier) after ${kwq(ctx, KW.AND)}`));
      }
      const cap2 = ctx.next().value as string;
      effs.push(cap2);
    }

    return effs;
  }

  // Parse optional capability list with 'and' separator
  // Example: io and Http and Sql and Time
  while (ctx.isKeyword(KW.AND)) {
    ctx.nextWord(); // consume 'and'

    // Capabilities are TYPE_IDENT (capitalized names like Http, Sql, Time)
    if (!ctx.at(TokenKind.TYPE_IDENT)) {
      // Could also be another effect keyword (io/cpu)
      if (ctx.isKeyword(KW.IO)) {
        ctx.nextWord();
        effs.push('io');
        continue;
      }
      if (ctx.isKeyword(KW.CPU)) {
        ctx.nextWord();
        effs.push('cpu');
        continue;
      }
      error(Issue.expectedAfter(tokenName('capabilityName'), kwParam(KW.AND), `Expected capability name (capitalized identifier) after ${kwq(ctx, KW.AND)}`));
    }
    const cap = ctx.next().value as string;
    effs.push(cap);
  }

  // Parse optional capability brackets [Cap1, Cap2, Cap3]
  if (ctx.at(TokenKind.LBRACKET)) {
    ctx.next(); // consume '['
    while (!ctx.at(TokenKind.RBRACKET) && !ctx.at(TokenKind.EOF)) {
      // Capabilities are TYPE_IDENT (capitalized names like Http, Sql, Time)
      if (!ctx.at(TokenKind.TYPE_IDENT)) {
        error(Issue.expected(tokenName('capabilityName'), "Expected capability name (capitalized identifier)"));
      }
      const cap = ctx.next().value as string;
      effs.push(cap);

      if (ctx.at(TokenKind.COMMA)) {
        ctx.next();
      } else {
        break;
      }
    }
    if (!ctx.at(TokenKind.RBRACKET)) error(Issue.expectedAfter(lit(']'), tokenName('capabilityList'), "Expected ']' after capability list"));
    ctx.next(); // consume ']'
  }

  return effs;
}

/**
 * 分离基础效果和能力类型
 * @param effects 效果字符串数组
 * @param error 错误报告函数
 * @returns 基础效果、能力类型和是否有显式能力声明
 */
export function separateEffectsAndCaps(
  effects: string[],
  error: ParseErrorFn,
  effectVars?: ReadonlySet<string>
): {
  baseEffects: string[];
  effectCaps: CapabilityKind[];
  hasExplicitCaps: boolean;
  effectVars: string[];
} {
  const baseEffects: string[] = [];
  const rawCaps: string[] = [];
  const effectVarRefs: string[] = [];
  const baseEffectSet = new Set(['io', 'cpu', 'pure']);

  for (const eff of effects) {
    const lower = eff.toLowerCase();
    if (baseEffectSet.has(lower)) {
      baseEffects.push(lower);
      continue;
    }
     if (effectVars?.has(eff)) {
       effectVarRefs.push(eff);
       continue;
     }
    // 能力名一律首字母大写（TYPE_IDENT）；其余名字是未知基效果，原样保留（#304）
    if (!/^[A-Z]/.test(eff)) {
      baseEffects.push(eff);
      continue;
    }
    rawCaps.push(eff);
  }

  const effectCaps: CapabilityKind[] = [];
  const seenCaps = new Set<CapabilityKind>();
  const appendCaps = (caps: readonly CapabilityKind[]): void => {
    for (const cap of caps) {
      if (seenCaps.has(cap)) continue;
      seenCaps.add(cap);
      effectCaps.push(cap);
    }
  };

  // IR 只记源码写下的能力（ADR 0056 §4.1）：没有显式能力时 effectCaps 为空，裸 io / cpu 不展开为预置列表，
  // 需要时由读方按 shared/capabilities.json 的 class 自行展开。
  for (const capText of rawCaps) {
    if (isCapabilityKind(capText)) {
      appendCaps([capText as CapabilityKind]);
      continue;
    }
    if (effectVars?.has(capText)) {
      if (!effectVarRefs.includes(capText)) effectVarRefs.push(capText);
      continue;
    }
    // 未知能力名按原样保留、不报错（与 aster-lang-core 一致：core 只在类型检查给 INFO 多余能力，truffle 运行时不读 effectCaps；#294）
    appendCaps([capText as CapabilityKind]);
  }

  return {
    baseEffects,
    effectCaps,
    hasExplicitCaps: rawCaps.length > 0,
    effectVars: effectVarRefs,
  };
}

/**
 * 解析类型表达式
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 * @returns 类型节点
 */
type PiiAnnotation = {
  readonly startToken: Token;
  readonly level: PiiSensitivityLevel;
  readonly category: PiiDataCategory;
};

function consumeKeywordSequence(ctx: ParserContext, words: string | string[]): Token[] {
  const parts = Array.isArray(words) ? words : kwParts(words);
  return parts.map(() => ctx.nextWord());
}

/** `->`：词法上是相邻的 `-` 与 `>` 两个记号（不新增 ARROW 记号，免得波及 CST/高亮）；`- >` 不算箭头 */
function atArrow(ctx: ParserContext): boolean {
  if (!ctx.at(TokenKind.MINUS)) return false;
  const minus = ctx.peek();
  const gt = ctx.peek(1);
  return gt.kind === TokenKind.GT && gt.start.line === minus.end.line && gt.start.col === minus.end.col;
}

/**
 * `(` 开头的类型，与 aster-lang-core 文法一致：
 *   `(T1, T2) -> R`：函数类型，至少一个参数，参数可带注解，返回类型递归解析（`?` 归返回类型）；
 *   `(T)`：括号类型，即内部类型本身（内部不允许注解，与 Java ParenType 的 `type` 一致）。
 */
function parseParenOrFuncType(
  ctx: ParserContext,
  error: ParseErrorFn
): Type {
  const lparen = ctx.next();
  const params: Type[] = [];
  let annotated = false;
  ctx.typeListDepth++;
  try {
    do {
      if (params.length > 0) ctx.next(); // 消费 ','
      annotated ||= ctx.at(TokenKind.AT);
      params.push(parseType(ctx, error));
    } while (ctx.at(TokenKind.COMMA));
  } finally {
    ctx.typeListDepth--;
  }
  if (!ctx.at(TokenKind.RPAREN)) error(Issue.expectedAfter(lit(')'), tokenName('type'), "Expected ')' after type"));
  ctx.next(); // 消费 ')'

  if (atArrow(ctx)) {
    ctx.next(); // '-'
    ctx.next(); // '>'
    const ret = parseType(ctx, error);
    const node = Node.FuncType(params, ret);
    assignSpan(node, spanFromSources(lparen, ret));
    return node;
  }
  if (params.length > 1) error(Issue.expectedAfter(lit('->'), tokenName('functionParameterTypes'), "Expected '->' after function parameter types"));
  if (annotated) error(Issue.expectedAfter(lit('->'), tokenName('annotatedFunctionParameterType'), "Expected '->' after annotated function parameter type"));
  return params[0]!;
}

/** 记号能否开始一个类型（与 parseTypePrimary / parseTypeInner 的入口一致）。 */
function canStartType(tok: Token | undefined): boolean {
  if (!tok) return false;
  if (tok.kind === TokenKind.LPAREN || tok.kind === TokenKind.AT || tok.kind === TokenKind.TYPE_IDENT) return true;
  return tok.kind === TokenKind.IDENT && !isControlKeyword(String(tok.value ?? '').toLowerCase());
}

/**
 * 当前记号是 `X of A` 之后的分隔符（`and` / `,`），且它引出的是 X 的下一个类型参数（调用方已按元数判定 X 还能接参数）。
 *
 * 与 core 文法 ofTypeArgs 的前瞻一致（parity 清扫 1.0.48）：
 * - 分隔符后是「名字 as」：它开始的是下一个形参 / 字段，分隔符留给外层（`given x as Pair of Int, y as Text`）；
 * - 分隔符后的记号不能开始类型（如 `produce`）：同样留给外层；
 * - 否则归 X。在括号类型表里，逗号此时也可以读作类型表的下一项（`(result of Int, Text) -> Bool`），
 *   是真歧义：报 E064，要求写 `and` 或给 X 加括号，与 core AstBuilder 同码。
 */
function continuesOfTypeArgs(ctx: ParserContext, error: ParseErrorFn): boolean {
  const comma = ctx.at(TokenKind.COMMA);
  if (!comma && !ctx.isKeyword(KW.AND)) return false;
  const next = ctx.peek(1);
  if (startsNamedItem(ctx, 1) || !canStartType(next)) return false;
  const nameAt = skipAnnotationsFrom(ctx, 1);
  if (nameAt >= 0 && (isBareLowercaseName(ctx, nameAt) || isAmbiguousLowercaseTypeArg(ctx, nameAt))) {
    const nameTok = ctx.peek(nameAt);
    const name = String(nameTok.value);
    error(Issue.expected(tokenName('typeName'),
      `Expected type name: '${name}' would be read as another type argument; write '${name} as <Type>' or wrap the generic type in parentheses`), nameTok);
  }
  if (comma && ctx.typeListDepth > 0) {
    error(Issue.unexpectedConstruct(lit(','),
      "Ambiguous ',' in a parenthesised type list: write 'and' for another type argument, or wrap the generic type in parentheses"));
  }
  return true;
}

/** 小写开头、却只能读成类型名的词：内建类型关键词与 `maybe T` / `map K to V` 的引导词，见 isBareLowercaseName。 */
const LOWERCASE_TYPE_WORDS: ReadonlySet<string> = new Set([KW.TEXT, KW.INT, KW.FLOAT, KW.BOOL_TYPE, KW.MAYBE, 'map']);

/**
 * 偏移 offset 处是一个裸的小写拉丁名字（后面不是 `of` / `<`，本身也不是内建类型关键词）。
 *
 * 它出现在 `X of A` 的分隔符（及可选的前置注解）之后时有两种读法：X 的下一个类型参数，或下一个无类型的形参 / 字段
 * （`given x as Pair of Int, y, produce …`、`, @audit y`）。core 的类型名只收大写开头（typeIdent），ts 此前静默读成
 * 类型参数（aster-lang-ts#334）；两引擎现在都在名字上报 E055，码、参数、文案相同（core AsterParser.rejectBareLowercaseTypeArg）。
 * 天城文等无大小写文字（core 的 R53 放行）与由本地化关键词还原的标识符（core 归 TYPE_IDENT）不在此列。
 */
function isBareLowercaseName(ctx: ParserContext, offset: number): boolean {
  const tok = ctx.peek(offset);
  if (tok.kind !== TokenKind.IDENT || tok.originalValue !== undefined) return false;
  const text = String(tok.value ?? '');
  if (!/^\p{Ll}/u.test(text) || LOWERCASE_TYPE_WORDS.has(text.toLowerCase())) return false;
  const after = ctx.peek(offset + 1);
  if (after.kind === TokenKind.LT) return false;
  return !((after.kind === TokenKind.IDENT || after.kind === TokenKind.TYPE_IDENT) && String(after.value ?? '').toLowerCase() === 'of');
}

/**
 * 分隔符之后的小写 `map`（#338 第 4 项）或小写名字 + `of`（第 3 项，内建 list / option / result 除外）：与裸小写名字一样也可能是下一个
 * 形参 / 字段的名字，两引擎同码报 E055（ADR 0056 修订 A4 §1.3，core AsterParser.rejectBareLowercaseTypeArg）。大写 `Map` 不在此列。
 */
function isAmbiguousLowercaseTypeArg(ctx: ParserContext, offset: number): boolean {
  const tok = ctx.peek(offset);
  if (tok.kind !== TokenKind.IDENT || tok.originalValue !== undefined) return false;
  const text = String(tok.value ?? '');
  if (!/^\p{Ll}/u.test(text)) return false;
  const lower = text.toLowerCase();
  if (lower === 'map') return true;
  const after = ctx.peek(offset + 1);
  const isOf = (after.kind === TokenKind.IDENT || after.kind === TokenKind.TYPE_IDENT) && String(after.value ?? '').toLowerCase() === 'of';
  return isOf && !OF_GENERIC_WORDS.has(lower);
}

/** 内建的小写 `X of` 泛型名：分隔符之后照旧是类型参数。 */
const OF_GENERIC_WORDS: ReadonlySet<string> = new Set(['list', 'option', 'result']);

/** 类型位置上的裸小写拉丁名字：小写开头、不是本地化关键词还原的记号、不是 `maybe` / `map`、后面不是 `of` / `<`。 */
function isBareLowercaseTypeAt(ctx: ParserContext, offset: number): boolean {
  const tok = ctx.peek(offset);
  if (tok.kind !== TokenKind.IDENT || tok.originalValue !== undefined) return false;
  const text = String(tok.value ?? '');
  if (!/^\p{Ll}/u.test(text)) return false;
  const lower = text.toLowerCase();
  if (lower === KW.MAYBE || lower === 'map') return false;
  const after = ctx.peek(offset + 1);
  if (after.kind === TokenKind.LT) return false;
  return !((after.kind === TokenKind.IDENT || after.kind === TokenKind.TYPE_IDENT) && String(after.value ?? '').toLowerCase() === 'of');
}

/**
 * 偏移 offset 处开始的是「名字 as」（下一个形参 / 字段），前面可以有形参注解（`, @pii(L1, email) y as Text`，aster-lang-ts#328）。
 * 注解后面不是「名字 as」时（`, @pii(L1, email) Text`）它是带注解的类型参数。
 */
function startsNamedItem(ctx: ParserContext, offset: number): boolean {
  const at = skipAnnotationsFrom(ctx, offset);
  if (at < 0) return false;
  const name = ctx.peek(at);
  const as = ctx.peek(at + 1);
  return (name.kind === TokenKind.IDENT || name.kind === TokenKind.TYPE_IDENT)
    && as.kind === TokenKind.IDENT && String(as.value ?? '').toLowerCase() === KW.AS;
}

function parseTypePrimary(
  ctx: ParserContext,
  error: ParseErrorFn
): Type {
  if (ctx.at(TokenKind.LPAREN)) return parseParenOrFuncType(ctx, error);

  if (ctx.isKeyword(KW.MAYBE)) {
    const maybeTok = ctx.nextWord();
    // `maybe T`（≡ `T?`）不带 of：`maybe of T` 两引擎都在 of 上报 E061，与 core AstBuilder 同码同文案（aster-lang-ts#328）
    if (ctx.isKeyword('of')) error(Issue.unexpected(lit('of'), MAYBE_OF_MESSAGE));
    const inner = parseType(ctx, error);
    const node = Node.Maybe(inner);
    assignSpan(node, spanFromSources(maybeTok, inner));
    return node;
  }

  if (ctx.isKeywordSeq(KW.OPTION_OF)) {
    const optionToks = consumeKeywordSequence(ctx, KW.OPTION_OF);
    const inner = parseType(ctx, error);
    const node = Node.Option(inner);
    assignSpan(node, spanFromSources(optionToks[0]!, inner));
    return node;
  }

  if (ctx.isKeywordSeq(KW.RESULT_OF)) {
    const resultToks = consumeKeywordSequence(ctx, KW.RESULT_OF);
    const ok = parseType(ctx, error);

    // Error type is optional - if not specified, defaults to Text
    let err: Type;
    let connectorTok: Token | null = null;

    // 失败类型只用 `and` / `,` 引出，与 core 文法 ofTypeArgs 一致；`or` 不是分隔符（aster-lang-ts#328）。
    // core 在 `or` 上报 E062（ANTLR mismatched input），这里同码同位置，并指明要写 and
    if (ctx.isKeyword(KW.OR)) {
      error(Issue.unexpectedExpecting(kwParam(KW.OR), kwParam(KW.AND),
        `Unexpected ${kwq(ctx, KW.OR)}; expected ${kwq(ctx, KW.AND)} before the failure type of result`));
    }
    if (continuesOfTypeArgs(ctx, error)) {
      connectorTok = ctx.next();
      err = parseType(ctx, error);
    } else {
      // Default error type is Text
      err = Node.TypeName('Text');
      assignSpan(err, spanFromTokens(resultToks[resultToks.length - 1]!, resultToks[resultToks.length - 1]!));
    }

    const node = Node.Result(ok, err);
    if (connectorTok) {
      assignSpan(node, spanFromSources(resultToks[0]!, ok, connectorTok, err));
    } else {
      assignSpan(node, spanFromSources(resultToks[0]!, ok));
    }
    return node;
  }

  if (ctx.isKeywordSeq(['list', 'of'])) {
    const listTok = ctx.nextWord();
    const ofTok = ctx.nextWord();
    const inner = parseOfArgument(ctx, error);
    const node = Node.List(inner);
    assignSpan(node, spanFromSources(listTok, ofTok, inner));
    return node;
  }

  if (ctx.isKeyword('map')) {
    const mapTok = ctx.nextWord();
    const keyType = parseType(ctx, error);
    if (!ctx.isKeyword(KW.TO_WORD)) {
      Diagnostics.expectedKeyword(KW.TO_WORD, ctx.peek().start)
        .withErrorCode(ErrorCode.PARSE_EXPECTED_IN, { token: kwParam(KW.TO_WORD), context: tokenName('mapType') })
        .withMessage(`Expected ${kwq(ctx, KW.TO_WORD)} in map type`)
        .throw();
    }
    const toTok = ctx.nextWord();
    const valueType = parseType(ctx, error);
    const node = Node.Map(keyType, valueType);
    assignSpan(node, spanFromSources(mapTok, keyType, toTok, valueType));
    return node;
  }

  // 裸小写类型名（`as text`、`as foo`）：类型名以大写开头，两引擎都在名字上报 E055（ADR 0056 修订 A4 §1.2，#338 第 2 项）。
  // 本地化关键词还原的记号（originalValue）与 `maybe` / `map` 引导词不在此列。
  if (isBareLowercaseTypeAt(ctx, 0)) {
    error(Issue.expected(tokenName('typeName'), 'Expected type name'), ctx.peek());
  }

  if (ctx.isKeyword(KW.TEXT)) {
    const tok = ctx.nextWord();
    const node = Node.TypeName('Text');
    assignSpan(node, spanFromTokens(tok, tok));
    return node;
  }
  if (ctx.isKeyword(KW.INT)) {
    const tok = ctx.nextWord();
    const node = Node.TypeName('Int');
    assignSpan(node, spanFromTokens(tok, tok));
    return node;
  }
  if (ctx.isKeyword(KW.FLOAT)) {
    // 本地化的浮点类型关键词（de Dezimal、zh 小数）与 en-US 的 Float 降为同一名字 Float，与 Java 一致（X1 裁决）；
    // 类型检查中 Float 与 Double 互通
    const tok = ctx.nextWord();
    const node = Node.TypeName('Float');
    assignSpan(node, spanFromTokens(tok, tok));
    return node;
  }
  if (ctx.isKeyword(KW.BOOL_TYPE)) {
    const tok = ctx.nextWord();
    const node = Node.TypeName('Bool');
    assignSpan(node, spanFromTokens(tok, tok));
    return node;
  }

  if (ctx.at(TokenKind.IDENT)) {
    const tok = ctx.peek();
    const value = tok.value as string;
    if (value === 'Int' || value === 'Bool' || value === 'Text' || value === 'Float') {
      ctx.nextWord();
      const mapped = value === 'Float' ? 'Float' : value;
      const node = Node.TypeName(mapped);
      assignSpan(node, spanFromTokens(tok, tok));
      return node;
    }
    // 非拉丁文类型名（如中文「申请人类型」）无大小写区分，
    // lexer 将其标记为 IDENT 而非 TYPE_IDENT。
    // 当 IDENT 出现在类型位置且不是控制流/声明关键词时，视为用户定义类型。
    if (value && !isControlKeyword(value.toLowerCase())) {
      ctx.next();
      const node = Node.TypeName(value);
      assignSpan(node, spanFromTokens(tok, tok));
      return node;
    }
  }

  if (ctx.at(TokenKind.TYPE_IDENT)) {
    const typeTok = ctx.next();
    const name = typeTok.value as string;
    if (ctx.isKeyword('of')) {
      const ofTok = ctx.nextWord();
      const args: Type[] = [];
      let more = true;
      while (more) {
        args.push(args.length === 0 ? parseOfArgument(ctx, error) : parseType(ctx, error));
        if (continuesOfTypeArgs(ctx, error)) {
          ctx.next(); // 消费 `and` / `,`
          continue;
        }
        more = false;
      }
      const node = Node.TypeApp(name, args);
      assignSpan(node, spanFromSources(typeTok, ofTok, ...args));
      return node;
    }
    if (ctx.currentTypeVars.has(name)) {
      const node = Node.TypeVar(name);
      assignSpan(node, spanFromTokens(typeTok, typeTok));
      return node;
    }
    if (ctx.currentEffectVars.has(name)) {
      const ev = Node.EffectVar(name);
      assignSpan(ev, spanFromTokens(typeTok, typeTok));
      return ev;
    }
    const node = Node.TypeName(name);
    assignSpan(node, spanFromTokens(typeTok, typeTok));
    return node;
  }

  error(Issue.expected(tokenName('type'), 'Expected type'));
}

/**
 * `of` 之后的第一个类型参数。`of` 之后直接换行时与 core 同码，报在换行处（aster-lang-ts#389）：core 的 ANTLR 先试单 token
 * 删除，下一行同列续写一个类型起始记号时报 E061，缩进、空行、文件末或其它记号时报 E062。
 */
function parseOfArgument(ctx: ParserContext, error: ParseErrorFn): Type {
  if (ctx.at(TokenKind.NEWLINE)) {
    error(headerNewlineIssue(
      acceptedAfterNewline(ctx, () => ctx.at(TokenKind.TYPE_IDENT) || ctx.at(TokenKind.IDENT) || ctx.at(TokenKind.LPAREN) || ctx.at(TokenKind.AT)),
      tokenName('type'),
      'a type',
    ));
  }
  return parseType(ctx, error);
}

/** 与 aster-lang-core AstBuilder.visitOfGenericType 的文案逐字相同。 */
const MAYBE_OF_MESSAGE = "Unexpected 'of': write 'maybe T' or 'T?' for an optional type";

/** 与 aster-lang-core AstBuilder.visitGenericType 的文案逐字相同。 */
const ANGLE_BRACKET_GENERIC_MESSAGE =
  "Expected 'of' after type name: angle-bracket type arguments are not supported, write 'Pair of Int and Text'";

/**
 * 尖括号泛型 `Pair<Int, Text>` 不是 Aster 语法，正式写法是 `Pair of Int and Text`（aster-lang-ts#328）。
 * 类型名后紧跟 `<` 时在 `<` 上报 E056，码、参数与 core 相同；类型之后没有其它语法以 `<` 开头
 * （效应参数 `<E>` 写在规则名之后，不经类型解析）。
 */
function rejectAngleBracketTypeArgs(ctx: ParserContext, node: Type, error: ParseErrorFn): void {
  if (!ctx.at(TokenKind.LT)) return;
  if (node.kind !== 'TypeName' && node.kind !== 'TypeVar' && node.kind !== 'EffectVar') return;
  error(Issue.expectedAfter(lit('of'), tokenName('typeName'), ANGLE_BRACKET_GENERIC_MESSAGE));
}

export function parseType(
  ctx: ParserContext,
  error: ParseErrorFn
): Type {
  // ★类型递归的深度护栏（issue #145）。
  //
  //   MAX_RECURSION_DEPTH 的设计目标就是「病态输入不许打爆原生栈」，但它此前
  //   **只接在 parseExpr 上**；而 parseType → parseTypePrimary → parseType 的
  //   类型递归完全无护栏。实测 `'maybe '.repeat(5000) + 'Int'`（约 30KB）触发
  //   原生 RangeError，被 decl-parser 的 catch-all 转成 span 恒为 1:1 的**假诊断**
  //   （用户看到「Maximum call stack size exceeded」，既不知道是哪一行、
  //   也不知道真正的原因是嵌套过深）。对照 400 层括号则正确报
  //   「nesting too deep (exceeds limit of N)」——同一份护栏，只是没接上。
  //
  //   接在 parseType 入口即可覆盖全部递归分支（maybe / option of / list of /
  //   map of / result of 等都经由它回环）。上限用 MAX_TYPE_RECURSION_DEPTH，与 core 的
  //   词法期类型守卫同值同单位（aster-lang-core#250）：只数类型，不与表达式深度共用计数器，
  //   否则 lambda 里的类型会因外层表达式深度提前超限，与 core 不一致。先判后加，抛出时不泄漏深度。
  if (ctx.typeRecursionDepth + 1 > MAX_TYPE_RECURSION_DEPTH) {
    Diagnostics.nestingTooDeep(MAX_TYPE_RECURSION_DEPTH, ctx.peek().start).throw();
  }
  ctx.typeRecursionDepth++;
  try {
    return parseTypeInner(ctx, error);
  } finally {
    ctx.typeRecursionDepth--;
  }
}

function parseTypeInner(
  ctx: ParserContext,
  error: ParseErrorFn
): Type {
  let annotation: PiiAnnotation | null = null;
  if (ctx.at(TokenKind.AT)) {
    const atTok = ctx.next();
    if (!ctx.isKeyword('pii')) {
      error(Issue.expectedAfter(lit('pii'), lit('@'), "Expected 'pii' after '@'"));
    }
    ctx.nextWord(); // consume 'pii'
    if (!ctx.at(TokenKind.LPAREN)) {
      error(Issue.expectedAfter(lit('('), lit('@pii'), "Expected '(' after '@pii'"));
    }
    ctx.next(); // consume '('

    if (!ctx.at(TokenKind.TYPE_IDENT) && !ctx.at(TokenKind.IDENT)) {
      error(Issue.expected(tokenName('piiLevel'), 'Expected PII level (e.g., L1, L2, L3)'));
    }
    const levelTok = ctx.next();
    if (!ctx.at(TokenKind.COMMA)) {
      error(Issue.expectedAfter(lit(','), tokenName('piiLevel'), "Expected ',' after PII level"));
    }
    ctx.next(); // consume ','
    if (!ctx.at(TokenKind.IDENT)) {
      error(Issue.expected(tokenName('piiCategory'), 'Expected PII category (e.g., email, phone, ssn)'));
    }
    const categoryTok = ctx.next();
    if (!ctx.at(TokenKind.RPAREN)) {
      error(Issue.expectedAfter(lit(')'), tokenName('piiCategory'), "Expected ')' after PII category"));
    }
    ctx.next(); // consume ')'

    annotation = {
      startToken: atTok,
      level: levelTok.value as PiiSensitivityLevel,
      category: categoryTok.value as PiiDataCategory,
    };
  }

  let node = parseTypePrimary(ctx, error);
  rejectAngleBracketTypeArgs(ctx, node, error);

  while (ctx.at(TokenKind.QUESTION)) {
    const questionTok = ctx.next();
    const maybeNode = Node.Maybe(node);
    assignSpan(maybeNode, spanFromSources(node, questionTok));
    node = maybeNode;
  }

  if (annotation) {
    const annotated = Node.TypePii(
      node,
      annotation.level,
      annotation.category
    );
    assignSpan(annotated, spanFromSources(annotation.startToken, node));
    node = annotated;
  }

  return node;
}
