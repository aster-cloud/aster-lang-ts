import type { Token } from '../types.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { TokenKind } from '../frontend/tokens.js';
import { ConfigService } from '../config/config-service.js';
import { Diagnostics } from '../diagnostics/diagnostics.js';
import { createLogger } from '../utils/logger.js';

/**
 * Parser 上下文接口
 * 包含词法标记流和解析状态
 */
export interface ParserContext {
  readonly tokens: readonly Token[];
  readonly lexicon?: Lexicon;
  index: number;
  moduleName: string | null;
  declaredTypes: Set<string>;
  currentTypeVars: Set<string>;
  currentEffectVars: Set<string>;
  collectedEffects: string[] | null;
  effectSnapshots: Array<string[] | null>;
  debug: { enabled: boolean; depth: number; log(message: string): void };
  /** 当前复合模式上下文栈（用于验证上下文敏感关键词） */
  compoundContextStack: string[];
  /** 跳过当前位置所有 trivia Token（如注释） */
  skipTrivia(): void;
  /** 查看第 N 个非 trivia Token（内部使用，不跳过 trivia） */
  peekToken(offset?: number): Token;
  /** 查看第 N 个 Token（自动跳过 trivia） */
  peek(offset?: number): Token;
  /** 消费当前 Token 并前进（自动跳过 trivia） */
  next(): Token;
  at(kind: TokenKind, value?: Token['value']): boolean;
  expect(kind: TokenKind, message: string): Token;
  isKeyword(kw: string): boolean;
  isKeywordSeq(words: string | string[]): boolean;
  nextWord(): Token;
  nextWords(words: string[]): void;
  consumeIndent(): void;
  consumeNewlines(): void;
  pushEffect(effects: string[]): void;
  snapshotEffects(): string[] | null;
  restoreEffects(snapshot: string[] | null): void;
  withTypeScope<T>(names: Iterable<string>, body: () => T): T;
  /** 进入复合模式上下文 */
  pushCompoundContext(opener: string): void;
  /** 退出复合模式上下文 */
  popCompoundContext(): void;
  /** 检查是否在指定复合模式上下文内 */
  inCompoundContext(opener: string): boolean;
}

/**
 * 将关键字短语拆分为单词数组
 * @param phrase 关键字短语（如 "module is"）
 * @returns 单词数组
 */
export function kwParts(phrase: string): string[] {
  return phrase.split(' ');
}

/**
 * 获取指定位置的词法标记的小写值
 * @param ctx Parser 上下文
 * @param idx 标记索引
 * @returns 小写的标记值，如果不是标识符则返回 null
 */
export function tokLowerAt(ctx: ParserContext, idx: number): string | null {
  const tok = ctx.tokens[idx];
  if (!tok) return null;
  if (
    tok.kind !== TokenKind.IDENT &&
    tok.kind !== TokenKind.TYPE_IDENT &&
    tok.kind !== TokenKind.KEYWORD
  )
    return null;
  return ((tok.value as string) || '').toLowerCase();
}

const parserLogger = createLogger('parser');

export function createParserContext(tokens: readonly Token[], lexicon?: Lexicon): ParserContext {
  const compoundContextStack: string[] = [];

  // R30+ audit P2：peekToken / next / skipTrivia 都在 token stream 上
  // 一次次扫 trivia，对长 source 形成 O(n²) 行为。预先把 non-trivia 的
  // 下标抽出来，peek 改成 binary-style 单步查找。trivia 占总 token 通常
  // 不到 20%，nonTriviaIndices 数组大小可控；建表 O(n) 摊销到一次。
  //
  // 设计点：建表用闭包数组 + 二分；token stream 是 readonly，不需要
  // 增量维护。
  const nonTriviaIndices: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.channel !== 'trivia') nonTriviaIndices.push(i);
  }
  /** 返回大于等于 fromIdx 的第 k 个 non-trivia token 的 tokens[] 下标，
   *  超出末尾返回 tokens.length-1（与原实现的 fallback 一致）。 */
  function nthNonTriviaAtOrAfter(fromIdx: number, offset: number): number {
    // 二分找到第一个 >= fromIdx 的 nonTriviaIndices 位置
    let lo = 0, hi = nonTriviaIndices.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (nonTriviaIndices[mid]! < fromIdx) lo = mid + 1;
      else hi = mid;
    }
    const target = lo + offset;
    if (target >= nonTriviaIndices.length) {
      return tokens.length - 1;
    }
    return nonTriviaIndices[target]!;
  }

  const ctx: ParserContext = {
    tokens,
    ...(lexicon !== undefined && { lexicon }),
    index: 0,
    moduleName: null,
    declaredTypes: new Set<string>(),
    currentTypeVars: new Set<string>(),
    currentEffectVars: new Set<string>(),
    collectedEffects: null,
    effectSnapshots: [],
    compoundContextStack,
    debug: {
      enabled: ConfigService.getInstance().debugTypes,
      depth: 0,
      log: (message: string): void => {
        if (!ctx.debug.enabled) return;
        parserLogger.debug(`[parseType] ${message}`, { depth: ctx.debug.depth });
      },
    },
    skipTrivia: (): void => {
      while (ctx.index < ctx.tokens.length) {
        const tok = ctx.tokens[ctx.index]!;
        if (tok.channel === 'trivia') {
          ctx.index++;
        } else {
          break;
        }
      }
    },
    peekToken: (offset = 0): Token => {
      // R30+ audit P2：O(1) lookup via pre-built nonTriviaIndices + 二分。
      return ctx.tokens[nthNonTriviaAtOrAfter(ctx.index, offset)]!;
    },
    peek: (offset = 0): Token => ctx.peekToken(offset),
    next: (): Token => {
      const tok = ctx.peek();
      let idx = ctx.index;
      let found = false;
      while (idx < ctx.tokens.length) {
        const current = ctx.tokens[idx]!;
        if (current.channel !== 'trivia' && current === tok) {
          ctx.index = idx + 1;
          found = true;
          break;
        }
        idx++;
      }
      if (!found && ctx.index < ctx.tokens.length) {
        ctx.index++;
      }
      ctx.skipTrivia();
      return tok;
    },
    at: (kind: TokenKind, value?: Token['value']): boolean => {
      const t = ctx.peek();
      if (!t) return false;
      if (t.kind !== kind) return false;
      if (value === undefined) return true;
      return t.value === value;
    },
    expect: (kind: TokenKind, message: string): Token => {
      const tok = ctx.next();
      if (tok.kind !== kind) {
        Diagnostics.expectedToken(kind, tok.kind, tok.start).withMessage(message).throw();
      }
      return tok;
    },
    isKeyword: (kw: string): boolean => {
      const v = tokLowerAt(ctx, ctx.index);
      return v === kw;
    },
    isKeywordSeq: (words: string | string[]): boolean => {
      const list = Array.isArray(words) ? words : kwParts(words);
      for (let k = 0; k < list.length; k++) {
        const v = tokLowerAt(ctx, ctx.index + k);
        if (v !== list[k]) return false;
      }
      return true;
    },
    nextWord: (): Token => {
      const tok = ctx.peek();
      if (
        tok.kind !== TokenKind.IDENT &&
        tok.kind !== TokenKind.TYPE_IDENT &&
        tok.kind !== TokenKind.KEYWORD
      ) {
        Diagnostics.unexpectedToken(tok.kind, tok.start)
          .withMessage('Expected keyword/identifier')
          .throw();
      }
      return ctx.next();
    },
    nextWords: (words: string[]): void => {
      words.forEach(() => ctx.nextWord());
    },
    consumeIndent: (): void => {
      while (ctx.at(TokenKind.INDENT)) ctx.next();
    },
    consumeNewlines: (): void => {
      while (ctx.at(TokenKind.NEWLINE)) ctx.next();
    },
    pushEffect: (effects: string[]): void => {
      if (ctx.collectedEffects === null) {
        ctx.collectedEffects = [...effects];
      } else {
        ctx.collectedEffects.push(...effects);
      }
    },
    snapshotEffects: (): string[] | null => {
      const snapshot = ctx.collectedEffects === null ? null : [...ctx.collectedEffects];
      ctx.effectSnapshots.push(snapshot);
      return snapshot;
    },
    restoreEffects: (snapshot: string[] | null): void => {
      ctx.collectedEffects = snapshot === null ? null : [...snapshot];
    },
    withTypeScope: <T>(names: Iterable<string>, body: () => T): T => {
      const saved = new Set(ctx.currentTypeVars);
      for (const name of names) {
        ctx.currentTypeVars.add(name);
      }
      try {
        return body();
      } finally {
        ctx.currentTypeVars = saved;
      }
    },
    pushCompoundContext: (opener: string): void => {
      compoundContextStack.push(opener);
    },
    popCompoundContext: (): void => {
      compoundContextStack.pop();
    },
    inCompoundContext: (opener: string): boolean => {
      return compoundContextStack.includes(opener);
    },
  };

  return ctx;
}
