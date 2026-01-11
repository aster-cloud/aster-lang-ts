import type { Token } from '../types.js';
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
  index: number;
  moduleName: string | null;
  declaredTypes: Set<string>;
  currentTypeVars: Set<string>;
  currentEffectVars: Set<string>;
  collectedEffects: string[] | null;
  effectSnapshots: Array<string[] | null>;
  debug: { enabled: boolean; depth: number; log(message: string): void };
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

export function createParserContext(tokens: readonly Token[]): ParserContext {
  const ctx: ParserContext = {
    tokens,
    index: 0,
    moduleName: null,
    declaredTypes: new Set<string>(),
    currentTypeVars: new Set<string>(),
    currentEffectVars: new Set<string>(),
    collectedEffects: null,
    effectSnapshots: [],
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
      let idx = ctx.index;
      let count = 0;
      while (idx < ctx.tokens.length) {
        const tok = ctx.tokens[idx]!;
        if (tok.channel !== 'trivia') {
          if (count === offset) return tok;
          count++;
        }
        idx++;
      }
      return ctx.tokens[ctx.tokens.length - 1]!;
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
  };

  return ctx;
}
