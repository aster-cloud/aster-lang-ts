import type { PiiDataCategory, PiiSensitivityLevel, Token, Type } from '../types.js';
import type { ParserContext } from './context.js';
import { kwParts } from './context.js';
import { TokenKind, KW } from '../frontend/tokens.js';
import { Node } from '../ast/ast.js';
import { Diagnostics } from '../diagnostics/diagnostics.js';
import { isCapabilityKind, parseLegacyCapability } from '../effects/capabilities.js';
import type { CapabilityKind } from '../config/semantic.js';
import { assignSpan, spanFromSources, spanFromTokens } from './span-utils.js';

/**
 * 解析效果列表（io, cpu, 能力等）
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 * @returns 效果字符串数组
 */
export function parseEffectList(
  ctx: ParserContext,
  error: (msg: string) => never
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

  // Parse optional capability list with 'with' keyword
  // Example: io with Http and Sql and Time
  if (ctx.isKeyword(KW.WITH)) {
    ctx.nextWord(); // consume 'with'

    // First capability after 'with'
    if (!ctx.at(TokenKind.TYPE_IDENT)) {
      error("Expected capability name (capitalized identifier) after 'with'");
    }
    const cap = ctx.next().value as string;
    effs.push(cap);

    // Additional capabilities with 'and' separator
    while (ctx.isKeyword(KW.AND)) {
      ctx.nextWord(); // consume 'and'
      if (!ctx.at(TokenKind.TYPE_IDENT)) {
        error("Expected capability name (capitalized identifier) after 'and'");
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
      error("Expected capability name (capitalized identifier) after 'and'");
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
        error("Expected capability name (capitalized identifier)");
      }
      const cap = ctx.next().value as string;
      effs.push(cap);

      if (ctx.at(TokenKind.COMMA)) {
        ctx.next();
      } else {
        break;
      }
    }
    if (!ctx.at(TokenKind.RBRACKET)) error("Expected ']' after capability list");
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
  error: (msg: string) => never,
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

  if (rawCaps.length > 0) {
    for (const capText of rawCaps) {
      if (isCapabilityKind(capText)) {
        appendCaps([capText as CapabilityKind]);
        continue;
      }
      if (effectVars?.has(capText)) {
        if (!effectVarRefs.includes(capText)) effectVarRefs.push(capText);
        continue;
      }
      error(`Unknown capability '${capText}'`);
    }
  } else {
    for (const eff of baseEffects) {
      if (eff === 'io' || eff === 'cpu') {
        appendCaps(parseLegacyCapability(eff));
      }
    }
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

function parseTypePrimary(
  ctx: ParserContext,
  error: (msg: string) => never
): Type {
  if (ctx.isKeyword(KW.MAYBE)) {
    const maybeTok = ctx.nextWord();
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

    if (ctx.isKeyword(KW.OR) || ctx.isKeyword(KW.AND)) {
      connectorTok = ctx.nextWord();
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
    const inner = parseType(ctx, error);
    const node = Node.List(inner);
    assignSpan(node, spanFromSources(listTok, ofTok, inner));
    return node;
  }

  if (ctx.isKeyword('map')) {
    const mapTok = ctx.nextWord();
    const keyType = parseType(ctx, error);
    if (!ctx.isKeyword(KW.TO_WORD)) {
      Diagnostics.expectedKeyword(KW.TO_WORD, ctx.peek().start)
        .withMessage("Expected 'to' in map type")
        .throw();
    }
    const toTok = ctx.nextWord();
    const valueType = parseType(ctx, error);
    const node = Node.Map(keyType, valueType);
    assignSpan(node, spanFromSources(mapTok, keyType, toTok, valueType));
    return node;
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
    const tok = ctx.nextWord();
    const node = Node.TypeName('Double');
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
  }

  if (ctx.at(TokenKind.TYPE_IDENT)) {
    const typeTok = ctx.next();
    const name = typeTok.value as string;
    if (ctx.isKeyword('of')) {
      const ofTok = ctx.nextWord();
      const args: Type[] = [];
      let more = true;
      while (more) {
        args.push(parseType(ctx, error));
        if (ctx.isKeyword(KW.AND)) {
          ctx.nextWord();
          continue;
        }
        if (ctx.at(TokenKind.COMMA)) {
          ctx.next();
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

  error('Expected type');
}

export function parseType(
  ctx: ParserContext,
  error: (msg: string) => never
): Type {
  let annotation: PiiAnnotation | null = null;
  if (ctx.at(TokenKind.AT)) {
    const atTok = ctx.next();
    if (!ctx.isKeyword('pii')) {
      error("Expected 'pii' after '@'");
    }
    ctx.nextWord(); // consume 'pii'
    if (!ctx.at(TokenKind.LPAREN)) {
      error("Expected '(' after '@pii'");
    }
    ctx.next(); // consume '('

    if (!ctx.at(TokenKind.TYPE_IDENT) && !ctx.at(TokenKind.IDENT)) {
      error("Expected PII level (e.g., L1, L2, L3)");
    }
    const levelTok = ctx.next();
    if (!ctx.at(TokenKind.COMMA)) {
      error("Expected ',' after PII level");
    }
    ctx.next(); // consume ','
    if (!ctx.at(TokenKind.IDENT)) {
      error("Expected PII category (e.g., email, phone, ssn)");
    }
    const categoryTok = ctx.next();
    if (!ctx.at(TokenKind.RPAREN)) {
      error("Expected ')' after PII category");
    }
    ctx.next(); // consume ')'

    annotation = {
      startToken: atTok,
      level: levelTok.value as PiiSensitivityLevel,
      category: categoryTok.value as PiiDataCategory,
    };
  }

  let node = parseTypePrimary(ctx, error);

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
