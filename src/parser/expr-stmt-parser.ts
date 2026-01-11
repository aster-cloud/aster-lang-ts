import type {
  Block,
  Case,
  ConstructField,
  Expression,
  Parameter,
  Pattern,
  Span,
  Statement,
  StepStmt,
  Token,
  Type,
  RetryPolicy,
  Timeout,
  WorkflowStmt,
} from '../types.js';
import type { ParserContext } from './context.js';
import { kwParts, tokLowerAt } from './context.js';
import { TokenKind, KW } from '../frontend/tokens.js';
import { Node } from '../ast/ast.js';
import { parseType, parseEffectList } from './type-parser.js';
import { parseConstraints } from './constraint-parser.js';
import { inferFieldType, refineInferredType } from './type-inference.js';
import {
  assignSpan,
  cloneSpan,
  lastConsumedToken,
  spanFromSources,
  spanFromTokens,
} from './span-utils.js';

const WAIT_FOR_PARTS = kwParts(KW.WAIT_FOR);
const MAX_ATTEMPTS_PARTS = kwParts(KW.MAX_ATTEMPTS);

function peekKeywordIgnoringLayout(ctx: ParserContext, startIndex: number = ctx.index): string | null {
  let idx = startIndex;
  while (idx < ctx.tokens.length) {
    const tok = ctx.tokens[idx]!;
    if (
      tok.kind === TokenKind.NEWLINE ||
      tok.kind === TokenKind.INDENT ||
      tok.kind === TokenKind.DEDENT
    ) {
      idx++;
      continue;
    }
    if (tok.kind === TokenKind.IDENT || tok.kind === TokenKind.TYPE_IDENT || tok.kind === TokenKind.KEYWORD) {
      const value = (tok.value as string) || '';
      return value.toLowerCase();
    }
    return null;
  }
  return null;
}

function spanFromToken(token: Token): Span {
  return spanFromTokens(token, token);
}

function assignTokenSpan<T extends { span: Span }>(node: T, token: Token): T {
  return assignSpan(node, spanFromToken(token));
}

function assignSpanFromSources<T extends { span: Span }>(
  node: T,
  ...sources: Array<Token | { span: Span }>
): T {
  return assignSpan(node, spanFromSources(...sources));
}

/**
 * 解析代码块（Block）
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 * @returns Block 节点
 */
export function parseBlock(
  ctx: ParserContext,
  error: (msg: string) => never
): Block {
  const statements: Statement[] = [];
  ctx.consumeNewlines();
  // Check if we have an INDENT token (new indented block)
  const hasIndent = ctx.at(TokenKind.INDENT);

  if (hasIndent) {
    // Standard indented block: consume INDENT and parse until DEDENT
    ctx.next();
    while (!ctx.at(TokenKind.DEDENT) && !ctx.at(TokenKind.EOF)) {
      ctx.consumeNewlines();
      if (ctx.at(TokenKind.DEDENT) || ctx.at(TokenKind.EOF)) break;
      statements.push(parseStatement(ctx, error));
      ctx.consumeNewlines();
    }
    if (!ctx.at(TokenKind.DEDENT)) error('Expected dedent');
    const endTok = ctx.peek();
    ctx.next();
    const b = Node.Block(statements);
    if (statements.length > 0) {
      const firstStmt = statements[0]!;
      const lastStmt = statements[statements.length - 1]!;
      assignSpan(b, spanFromSources(firstStmt, lastStmt));
    } else {
      assignSpan(b, spanFromSources(endTok));
    }
    return b;
  } else {
    // Already in an indented context (multi-line parameters case):
    // Parse statements until we hit DEDENT or EOF
    const startTok = ctx.peek();
    while (!ctx.at(TokenKind.DEDENT) && !ctx.at(TokenKind.EOF)) {
      ctx.consumeNewlines();
      if (ctx.at(TokenKind.DEDENT) || ctx.at(TokenKind.EOF)) break;
      statements.push(parseStatement(ctx, error));
      ctx.consumeNewlines();
    }
    if (statements.length === 0) error('Expected at least one statement in function body');
    const endTok = ctx.tokens[ctx.index - 1] || startTok;
    const b = Node.Block(statements);
    if (statements.length > 0) {
      const firstStmt = statements[0]!;
      const lastStmt = statements[statements.length - 1]!;
      assignSpan(b, spanFromSources(firstStmt, lastStmt));
    } else {
      assignSpan(b, spanFromSources(startTok, endTok));
    }
    // Don't consume DEDENT here - let the caller handle it
    return b;
  }
}

/**
 * 期望语句以句号结束
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 */
function expectPeriodEnd(
  ctx: ParserContext,
  error: (msg: string) => never
): void {
  if (!ctx.at(TokenKind.DOT)) error("Expected '.' at end of statement");
  ctx.next();
}

/**
 * 期望语句以句号或换行符结束
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 */
function expectPeriodEndOrLine(
  ctx: ParserContext,
  error: (msg: string) => never
): void {
  if (ctx.at(TokenKind.DOT)) {
    ctx.next();
    return;
  }
  // Tolerate newline/dedent/EOF terminators inside blocks for certain statements (e.g., Return)
  if (ctx.at(TokenKind.NEWLINE) || ctx.at(TokenKind.DEDENT) || ctx.at(TokenKind.EOF)) return;
  error("Expected '.' at end of statement");
}

/**
 * 解析语句
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 * @returns Statement 节点
 */
export function parseStatement(
  ctx: ParserContext,
  error: (msg: string) => never
): Statement {
  if (ctx.isKeyword(KW.LET)) {
    const letTok = ctx.peek();
    ctx.nextWord();
    const nameTok = ctx.peek();
    const name = parseIdent(ctx, error);
    expectKeyword(ctx, error, KW.BE, "Use 'be' in bindings: 'Let x be ...'.");
    // Special-case lambda block form to avoid trailing '.'
    if ((ctx.isKeyword('a') && tokLowerAt(ctx, ctx.index + 1) === 'function') || ctx.isKeyword('function')) {
      if (ctx.isKeyword('a')) ctx.nextWord(); // optional 'a'
      const functionTok = ctx.nextWord(); // 'function'
      const params = parseParamList(ctx, error);
      expectCommaOr(ctx);
      expectKeyword(ctx, error, KW.PRODUCE, "Expected 'produce' and return type");
      let retType: Type;
      if (ctx.at(TokenKind.COLON)) {
        retType = Node.TypeName('Unknown');
        assignSpan(retType, spanFromTokens(ctx.peek(), ctx.peek()));
      } else {
        retType = parseType(ctx, error);
      }
      if (!ctx.at(TokenKind.COLON)) error("Expected ':' after return type in lambda");
      ctx.next();
      expectNewline(ctx, error);
      const body = parseBlock(ctx, error);
      const lambda = Node.Lambda(params, retType, body);
      const lambdaEnd = lastConsumedToken(ctx);
      assignSpan(lambda, spanFromTokens(functionTok, lambdaEnd));
      const nd = Node.Let(name, lambda);
      assignSpan(nd, spanFromTokens(letTok, lambdaEnd));
      if (nameTok) (nd as any).nameSpan = spanFromToken(nameTok);
      return nd;
    }
    const expr = parseExpr(ctx, error);
    expectPeriodEnd(ctx, error);
    const nd = Node.Let(name, expr);
    const endTok = lastConsumedToken(ctx);
    assignSpan(nd, spanFromTokens(letTok, endTok));
    if (nameTok) (nd as any).nameSpan = spanFromToken(nameTok);
    return nd;
  }
  if (ctx.isKeyword(KW.SET)) {
    const setTok = ctx.peek();
    ctx.nextWord();
    const name = parseIdent(ctx, error);
    expectKeyword(ctx, error, KW.TO_WORD, "Use 'to' in assignments: 'Set x to ...'.");
    const expr = parseExpr(ctx, error);
    expectPeriodEnd(ctx, error);
    const nd = Node.Set(name, expr);
    const endTok = lastConsumedToken(ctx);
    assignSpan(nd, spanFromTokens(setTok, endTok));
    return nd;
  }
  if (ctx.isKeyword(KW.RETURN)) {
    const retTok = ctx.peek();
    ctx.nextWord();
    const expr = parseExpr(ctx, error);
    expectPeriodEndOrLine(ctx, error);
    // Allow trailing effect sentence immediately after a Return: 'It performs io.'
    // This attaches to the enclosing function's effects if present.
    if ((tokLowerAt(ctx, ctx.index) === 'it' && tokLowerAt(ctx, ctx.index + 1) === 'performs') || tokLowerAt(ctx, ctx.index) === 'performs') {
      if (tokLowerAt(ctx, ctx.index) === 'it') ctx.nextWord();
      if (tokLowerAt(ctx, ctx.index) === 'performs') {
        ctx.nextWord();
        const effs = parseEffectList(ctx, error);
        expectPeriodEnd(ctx, error);
        if (Array.isArray(ctx.collectedEffects)) ctx.collectedEffects.push(...effs);
      }
    }
    const nd = Node.Return(expr);
    const endTok = lastConsumedToken(ctx);
    assignSpan(nd, spanFromTokens(retTok, endTok));
    return nd;
  }
  if (ctx.isKeyword(KW.AWAIT)) {
    const awaitTok = ctx.nextWord();
    if (!ctx.at(TokenKind.LPAREN)) error("Expected '(' after await");
    const args = parseArgList(ctx, error);
    if (args.length !== 1) error('await(expr) takes exactly one argument');
    const target = assignTokenSpan(Node.Name('await'), awaitTok);
    const callSpanEnd = lastConsumedToken(ctx);
    const aw = Node.Call(target, args);
    assignSpan(aw, spanFromTokens(awaitTok, callSpanEnd));
    expectPeriodEnd(ctx, error);
    return aw as unknown as Statement;
  }
  if (ctx.isKeyword(KW.IF)) {
    const ifTok = ctx.peek();
    ctx.nextWord();
    const cond = parseExpr(ctx, error);
    // CNL 改进: 移除冗余逗号，只保留冒号 (If condition: → 更自然)
    if (!ctx.at(TokenKind.COLON)) error("Expected ':' after condition in If");
    ctx.next();
    expectNewline(ctx, error);
    const thenBlock = parseBlock(ctx, error);
    let elseBlock: Block | null = null;
    if (ctx.isKeyword(KW.OTHERWISE)) {
      ctx.nextWord();
      // CNL 改进: 移除冗余逗号，只保留冒号 (Otherwise: → 更自然)
      if (!ctx.at(TokenKind.COLON)) error("Expected ':' after Otherwise");
      ctx.next();
      expectNewline(ctx, error);
      elseBlock = parseBlock(ctx, error);
    }
    const nd = Node.If(cond, thenBlock, elseBlock);
    const endTok = lastConsumedToken(ctx);
    assignSpan(nd, spanFromTokens(ifTok, endTok));
    return nd;
  }
  if (ctx.isKeyword(KW.MATCH)) {
    const mTok = ctx.peek();
    ctx.nextWord();
    const expr = parseExpr(ctx, error);
    if (!ctx.at(TokenKind.COLON)) error("Expected ':' after match expression");
    ctx.next();
    expectNewline(ctx, error);
    const cases = parseCases(ctx, error);
    const nd = Node.Match(expr, cases);
    const endTok = lastConsumedToken(ctx);
    assignSpan(nd, spanFromTokens(mTok, endTok));
    return nd;
  }
  if (ctx.isKeyword(KW.WORKFLOW)) {
    return parseWorkflow(ctx, error);
  }
  // Plain bare expression as statement (allow method calls, constructions) ending with '.'
  if (
    ctx.at(TokenKind.IDENT) ||
    ctx.at(TokenKind.TYPE_IDENT) ||
    ctx.at(TokenKind.STRING) ||
    ctx.at(TokenKind.INT) ||
    ctx.at(TokenKind.BOOL) ||
    ctx.at(TokenKind.NULL) ||
    ctx.at(TokenKind.LPAREN)
  ) {
    const exprStart = ctx.index;
    try {
      const _e = parseExpr(ctx, error);
      expectPeriodEnd(ctx, error);
      return _e as Statement; // Not lowering; in v0, only Return statements are valid side-effects.
    } catch {
      // rewind
      ctx.index = exprStart;
    }
  }
  if (ctx.isKeyword(KW.WITHIN)) {
    ctx.nextWord();
    expectKeyword(ctx, error, KW.SCOPE, "Expected 'scope' after 'Within'");
    if (!ctx.at(TokenKind.COLON)) error("Expected ':' after 'scope'");
    ctx.next();
    expectNewline(ctx, error);
    return parseBlock(ctx, error); // Lowering later
  }
  if (ctx.isKeyword(KW.START)) {
    const startTok = ctx.nextWord();
    const name = parseIdent(ctx, error);
    expectKeyword(ctx, error, KW.AS, "Expected 'as' after name");
    expectKeyword(ctx, error, KW.ASYNC, "Expected 'async'");
    const expr = parseExpr(ctx, error);
    expectPeriodEnd(ctx, error);
    const nd = Node.Start(name, expr);
    const endTok = lastConsumedToken(ctx);
    assignSpan(nd, spanFromTokens(startTok, endTok));
    return nd as Statement;
  }
  if (ctx.isKeywordSeq(WAIT_FOR_PARTS)) {
    const waitStart = ctx.peek();
    ctx.nextWords(WAIT_FOR_PARTS);
    const names: string[] = [];
    names.push(parseIdent(ctx, error));
    while (ctx.isKeyword(KW.AND) || ctx.at(TokenKind.COMMA)) {
      if (ctx.isKeyword(KW.AND)) {
        ctx.nextWord();
        names.push(parseIdent(ctx, error));
      } else {
        ctx.next();
        names.push(parseIdent(ctx, error));
      }
    }
    expectPeriodEnd(ctx, error);
    const nd = Node.Wait(names);
    const endTok = lastConsumedToken(ctx);
    assignSpan(nd, spanFromTokens(waitStart, endTok));
    return nd as Statement;
  }

  error('Unknown statement');
}

function parseWorkflow(
  ctx: ParserContext,
  error: (msg: string) => never
): WorkflowStmt {
  const workflowTok = ctx.peek();
  expectKeyword(ctx, error, KW.WORKFLOW, "Expected 'workflow'");
  if (!ctx.at(TokenKind.COLON)) error("Expected ':' after 'workflow'");
  ctx.next();
  expectNewline(ctx, error);
  if (!ctx.at(TokenKind.INDENT)) error('Expected indent after workflow header');
  ctx.next();
  ctx.consumeNewlines();
  const steps: StepStmt[] = [];
  while (ctx.isKeyword(KW.STEP)) {
    steps.push(parseStep(ctx, error));
    ctx.consumeNewlines();
  }
  if (steps.length === 0) error('Workflow must declare at least one step');
  let retry: RetryPolicy | undefined;
  if (ctx.isKeyword(KW.RETRY)) {
    retry = parseRetryPolicy(ctx, error);
    ctx.consumeNewlines();
  }
  let timeout: Timeout | undefined;
  if (ctx.isKeyword(KW.TIMEOUT)) {
    timeout = parseTimeout(ctx, error);
    ctx.consumeNewlines();
  }
  if (!ctx.at(TokenKind.DEDENT)) error('Expected dedent after workflow body');
  ctx.next();
  ctx.consumeNewlines();
  expectPeriodEnd(ctx, error);
  const workflow = Node.Workflow(steps, retry, timeout);
  const endTok = lastConsumedToken(ctx);
  assignSpan(workflow, spanFromTokens(workflowTok, endTok));
  return workflow;
}

function parseStep(
  ctx: ParserContext,
  error: (msg: string) => never
): StepStmt {
  const stepTok = ctx.peek();
  expectKeyword(ctx, error, KW.STEP, "Expected 'step'");
  const name = parseIdent(ctx, error);
  const dependencies: string[] = [];
  if (ctx.isKeyword(KW.DEPENDS)) {
    ctx.nextWord();
    expectKeyword(ctx, error, KW.ON, "Expected 'on' after 'depends'");
    if (!ctx.at(TokenKind.LBRACKET)) error("Expected '[' after 'depends on'");
    ctx.next();
    if (!ctx.at(TokenKind.RBRACKET)) {
      while (true) {
        if (!ctx.at(TokenKind.STRING)) error('Expected string dependency name');
        const depTok = ctx.next();
        dependencies.push(depTok.value as string);
        if (ctx.at(TokenKind.COMMA)) {
          ctx.next();
          continue;
        }
        if (ctx.at(TokenKind.RBRACKET)) {
          break;
        }
        error("Expected ',' or ']' after dependency name");
      }
    }
    if (!ctx.at(TokenKind.RBRACKET)) error("Expected ']' to close dependency list");
    ctx.next();
  }
  if (!ctx.at(TokenKind.COLON)) error("Expected ':' after step name");
  ctx.next();
  expectNewline(ctx, error);
  const body = parseBlock(ctx, error);
  ctx.consumeNewlines();
  let compensate: Block | undefined;
  if (ctx.isKeyword(KW.COMPENSATE)) {
    ctx.nextWord();
    if (!ctx.at(TokenKind.COLON)) error("Expected ':' after 'compensate'");
    ctx.next();
    expectNewline(ctx, error);
    compensate = parseBlock(ctx, error);
    ctx.consumeNewlines();
  }
  const step = Node.Step(name, body, compensate, dependencies);
  const endTok = lastConsumedToken(ctx);
  assignSpan(step, spanFromTokens(stepTok, endTok));
  return step;
}

function parseRetryPolicy(
  ctx: ParserContext,
  error: (msg: string) => never
): RetryPolicy {
  expectKeyword(ctx, error, KW.RETRY, "Expected 'retry'");
  if (!ctx.at(TokenKind.COLON)) error("Expected ':' after 'retry'");
  ctx.next();
  expectNewline(ctx, error);
  if (!ctx.at(TokenKind.INDENT)) error('Expected indent for retry policy');
  ctx.next();
  ctx.consumeNewlines();
  let maxAttempts: number | null = null;
  let backoff: RetryPolicy['backoff'] | null = null;
  while (!ctx.at(TokenKind.DEDENT)) {
    if (ctx.isKeywordSeq(MAX_ATTEMPTS_PARTS)) {
      ctx.nextWords(MAX_ATTEMPTS_PARTS);
      if (!ctx.at(TokenKind.COLON)) error("Expected ':' after 'max attempts'");
      ctx.next();
      if (!ctx.at(TokenKind.INT)) error("Expected integer after 'max attempts'");
      const attempts = ctx.next().value as number;
      if (attempts <= 0) error("'max attempts' must be greater than zero");
      maxAttempts = attempts;
      expectPeriodEnd(ctx, error);
    } else if (ctx.isKeyword(KW.BACKOFF)) {
      ctx.nextWord();
      if (!ctx.at(TokenKind.COLON)) error("Expected ':' after 'backoff'");
      ctx.next();
      const modeTok = ctx.nextWord();
      const mode = String(modeTok.value ?? '').toLowerCase();
      if (mode !== 'exponential' && mode !== 'linear') {
        error("Backoff must be either 'exponential' or 'linear'");
      }
      backoff = mode as RetryPolicy['backoff'];
      expectPeriodEnd(ctx, error);
    } else {
      error('Unknown retry directive');
    }
    ctx.consumeNewlines();
  }
  ctx.next();
  if (maxAttempts === null) error("Retry section must include 'max attempts'");
  if (backoff === null) error("Retry section must include 'backoff'");
  return { maxAttempts, backoff };
}

function parseTimeout(
  ctx: ParserContext,
  error: (msg: string) => never
): Timeout {
  expectKeyword(ctx, error, KW.TIMEOUT, "Expected 'timeout'");
  if (!ctx.at(TokenKind.COLON)) error("Expected ':' after 'timeout'");
  ctx.next();
  if (!ctx.at(TokenKind.INT)) error('Expected integer timeout value');
  const secondsTok = ctx.next();
  const seconds = secondsTok.value as number;
  if (seconds < 0) error('Timeout value must be non-negative');
  if (!(ctx.isKeyword('seconds') || ctx.isKeyword('second'))) {
    error("Timeout must specify time unit 'seconds'");
  }
  ctx.nextWord();
  expectPeriodEnd(ctx, error);
  return { milliseconds: seconds * 1000 };
}

/**
 * 解析 Match 语句的 Case 列表
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 * @returns Case 节点数组
 */
function parseCases(
  ctx: ParserContext,
  error: (msg: string) => never
): Case[] {
  const cases: Case[] = [];
  if (!ctx.at(TokenKind.INDENT)) error('Expected indent for cases');
  ctx.next();
  while (!ctx.at(TokenKind.DEDENT)) {
    if (!ctx.isKeyword(KW.WHEN)) error("Expected 'When'");
    const whenTok = ctx.nextWord();
    const pat = parsePattern(ctx, error);
    if (!ctx.at(TokenKind.COMMA)) error("Expected ',' after pattern");
    ctx.next();
    const body = parseCaseBody(ctx, error);
    const caseNode = Node.Case(pat, body);
    const endTok = lastConsumedToken(ctx);
    assignSpan(caseNode, spanFromTokens(whenTok, endTok));
    cases.push(caseNode);
    while (ctx.at(TokenKind.NEWLINE)) ctx.next();
  }
  ctx.next();
  return cases;
}

/**
 * 解析 Case 的 Body 部分（可以是 Return 语句或 Block）
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 * @returns Block 或 Return 节点
 */
function parseCaseBody(
  ctx: ParserContext,
  error: (msg: string) => never
): Block | import('../types.js').Return {
  if (ctx.isKeyword(KW.RETURN)) {
    const retTok = ctx.nextWord();
    const e = parseExpr(ctx, error);
    expectPeriodEnd(ctx, error);
    const nd = Node.Return(e);
    const endTok = lastConsumedToken(ctx);
    assignSpan(nd, spanFromTokens(retTok, endTok));
    return nd;
  }
  return parseBlock(ctx, error);
}

/**
 * 解析表达式
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 * @returns Expression 节点
 */
export function parseExpr(
  ctx: ParserContext,
  error: (msg: string) => never
): Expression {
  return parseNot(ctx, error);
}

/**
 * 解析逻辑非表达式（not）
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 * @returns Expression 节点
 */
function parseNot(
  ctx: ParserContext,
  error: (msg: string) => never
): Expression {
  if (ctx.isKeyword(KW.NOT)) {
    const notTok = ctx.nextWord();
    const expr = parseNot(ctx, error);
    const notName = assignTokenSpan(Node.Name('not'), notTok);
    const call = Node.Call(notName, [expr]);
    assignSpan(call, spanFromSources(notTok, expr));
    return call;
  }
  return parseComparison(ctx, error);
}

/**
 * 解析比较表达式
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 * @returns Expression 节点
 */
function parseComparison(
  ctx: ParserContext,
  error: (msg: string) => never
): Expression {
  let left = parseAddition(ctx, error);

  const lessThanParts = kwParts(KW.LESS_THAN);
  const greaterThanParts = kwParts(KW.GREATER_THAN);
  const equalsToParts = kwParts(KW.EQUALS_TO);
  const atLeastParts = kwParts(KW.AT_LEAST);
  const atMostParts = kwParts(KW.AT_MOST);

  let more = true;
  while (more) {
    if (ctx.isKeyword(KW.LESS_THAN) || ctx.isKeywordSeq(lessThanParts)) {
      const opTok = ctx.peek();
      if (ctx.isKeywordSeq(lessThanParts)) {
        ctx.nextWords(lessThanParts);
      } else {
        ctx.nextWord();
      }
      const right = parseAddition(ctx, error);
      const target = assignTokenSpan(Node.Name('<'), opTok);
      const call = Node.Call(target, [left, right]);
      assignSpan(call, spanFromSources(left, opTok, right));
      left = call;
    } else if (ctx.isKeyword(KW.GREATER_THAN) || ctx.isKeywordSeq(greaterThanParts)) {
      const opTok = ctx.peek();
      if (ctx.isKeywordSeq(greaterThanParts)) {
        ctx.nextWords(greaterThanParts);
      } else {
        ctx.nextWord();
      }
      const right = parseAddition(ctx, error);
      const target = assignTokenSpan(Node.Name('>'), opTok);
      const call = Node.Call(target, [left, right]);
      assignSpan(call, spanFromSources(left, opTok, right));
      left = call;
    } else if (ctx.isKeyword(KW.EQUALS_TO) || ctx.isKeywordSeq(equalsToParts)) {
      const opTok = ctx.peek();
      if (ctx.isKeywordSeq(equalsToParts)) {
        ctx.nextWords(equalsToParts);
      } else {
        ctx.nextWord();
      }
      const right = parseAddition(ctx, error);
      const target = assignTokenSpan(Node.Name('=='), opTok);
      const call = Node.Call(target, [left, right]);
      assignSpan(call, spanFromSources(left, opTok, right));
      left = call;
    } else if (ctx.isKeyword(KW.AT_LEAST) || ctx.isKeywordSeq(atLeastParts)) {
      const opTok = ctx.peek();
      if (ctx.isKeywordSeq(atLeastParts)) {
        ctx.nextWords(atLeastParts);
      } else {
        ctx.nextWord();
      }
      const right = parseAddition(ctx, error);
      const target = assignTokenSpan(Node.Name('>='), opTok);
      const call = Node.Call(target, [left, right]);
      assignSpan(call, spanFromSources(left, opTok, right));
      left = call;
    } else if (ctx.isKeyword(KW.AT_MOST) || ctx.isKeywordSeq(atMostParts)) {
      const opTok = ctx.peek();
      if (ctx.isKeywordSeq(atMostParts)) {
        ctx.nextWords(atMostParts);
      } else {
        ctx.nextWord();
      }
      const right = parseAddition(ctx, error);
      const target = assignTokenSpan(Node.Name('<='), opTok);
      const call = Node.Call(target, [left, right]);
      assignSpan(call, spanFromSources(left, opTok, right));
      left = call;
    } else {
      more = false;
    }
  }
  return left;
}

/**
 * 解析加减法表达式
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 * @returns Expression 节点
 */
function parseAddition(
  ctx: ParserContext,
  error: (msg: string) => never
): Expression {
  let left = parseMultiplication(ctx, error);

  let more = true;
  while (more) {
    if (ctx.isKeyword(KW.PLUS)) {
      const opTok = ctx.nextWord();
      const right = parseMultiplication(ctx, error);
      const target = assignTokenSpan(Node.Name('+'), opTok);
      const call = Node.Call(target, [left, right]);
      assignSpan(call, spanFromSources(left, opTok, right));
      left = call;
    } else if (ctx.isKeyword(KW.MINUS)) {
      const opTok = ctx.nextWord();
      const right = parseMultiplication(ctx, error);
      const target = assignTokenSpan(Node.Name('-'), opTok);
      const call = Node.Call(target, [left, right]);
      assignSpan(call, spanFromSources(left, opTok, right));
      left = call;
    } else {
      more = false;
    }
  }
  return left;
}

/**
 * 解析乘除法表达式
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 * @returns Expression 节点
 */
function parseMultiplication(
  ctx: ParserContext,
  error: (msg: string) => never
): Expression {
  let left = parsePrimary(ctx, error);

  const dividedByParts = kwParts(KW.DIVIDED_BY);

  let more = true;
  while (more) {
    if (ctx.isKeyword(KW.TIMES)) {
      const opTok = ctx.nextWord();
      const right = parsePrimary(ctx, error);
      const target = assignTokenSpan(Node.Name('*'), opTok);
      const call = Node.Call(target, [left, right]);
      assignSpan(call, spanFromSources(left, opTok, right));
      left = call;
    } else if (ctx.isKeyword(KW.DIVIDED_BY) || ctx.isKeywordSeq(dividedByParts)) {
      const opTok = ctx.peek();
      if (ctx.isKeywordSeq(dividedByParts)) {
        ctx.nextWords(dividedByParts);
      } else {
        ctx.nextWord();
      }
      const right = parsePrimary(ctx, error);
      const target = assignTokenSpan(Node.Name('/'), opTok);
      const call = Node.Call(target, [left, right]);
      assignSpan(call, spanFromSources(left, opTok, right));
      left = call;
    } else {
      more = false;
    }
  }
  return left;
}

/**
 * 解析基础表达式
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 * @returns Expression 节点
 */
function parsePrimary(
  ctx: ParserContext,
  error: (msg: string) => never
): Expression {
  // Minimal: construction, literals, names, Ok/Err/Some/None, call with dotted names and parens args
  // Lambda (block form): 'a function' (or 'function') ... 'produce' Type ':' \n Block
  if ((ctx.isKeyword('a') && tokLowerAt(ctx, ctx.index + 1) === 'function') || ctx.isKeyword('function')) {
    const optionalATok = ctx.isKeyword('a') ? ctx.nextWord() : null; // optional 'a'
    const functionTok = ctx.nextWord(); // 'function'
    const params = parseParamList(ctx, error);
    expectCommaOr(ctx);
    expectKeyword(ctx, error, KW.PRODUCE, "Expected 'produce' and return type");
    let retType: Type;
    if (ctx.at(TokenKind.COLON)) {
      retType = Node.TypeName('Unknown');
      assignSpan(retType, spanFromTokens(ctx.peek(), ctx.peek()));
    } else {
      retType = parseType(ctx, error);
    }
    if (!ctx.at(TokenKind.COLON)) error("Expected ':' after return type in lambda");
    ctx.next();
    expectNewline(ctx, error);
    const body = parseBlock(ctx, error);
    const lambda = Node.Lambda(params, retType, body);
    const lambdaEnd = lastConsumedToken(ctx);
    const lambdaStart = optionalATok ?? functionTok;
    assignSpan(lambda, spanFromTokens(lambdaStart, lambdaEnd));
    return lambda;
  }
  // Lambda (short form): (x: Text, y: Int) => expr
  if (ctx.at(TokenKind.LPAREN)) {
    const save = ctx.index;
    const lparenTok = ctx.peek();
    try {
      ctx.next(); // consume '('
      const params: Parameter[] = [];
      let first = true;
      while (!ctx.at(TokenKind.RPAREN)) {
        if (!first) {
          if (ctx.at(TokenKind.COMMA)) {
            ctx.next();
          } else {
            throw new Error('comma');
          }
        }
        const nameTok = ctx.peek();
        const pname = parseIdent(ctx, error);
        let ptype: Type;
        let colonTok: Token | undefined;
        let typeInferred = false;
        if (ctx.at(TokenKind.COLON)) {
          colonTok = ctx.next();
          ptype = parseType(ctx, error);
        } else {
          typeInferred = true;
          ptype = inferFieldType(pname);
          assignSpan(ptype, spanFromTokens(nameTok, nameTok));
        }
        const param: Parameter = {
          name: pname,
          type: ptype,
          ...(typeInferred ? { typeInferred: true } : {}),
          span: colonTok
            ? spanFromSources(nameTok, colonTok, ptype)
            : spanFromSources(nameTok, ptype),
        };
        params.push(param);
        first = false;
      }
      const rparenTok = ctx.peek();
      ctx.next(); // consume ')'
      if (!(ctx.at(TokenKind.EQUALS) && ctx.tokens[ctx.index + 1] && ctx.tokens[ctx.index + 1]!.kind === TokenKind.GT)) {
        throw new Error('arrow');
      }
      const eqTok = ctx.next(); // '='
      const gtTok = ctx.next(); // '>'
      // Expression body; infer return type when possible
      const bodyExpr = parseExpr(ctx, error);
      const returnNode = Node.Return(bodyExpr);
      assignSpanFromSources(returnNode, bodyExpr);
      const body = Node.Block([returnNode]);
      assignSpanFromSources(body, bodyExpr);
      const retType = inferLambdaReturnType(bodyExpr);
      const lambda = Node.Lambda(params, retType, body);
      assignSpan(lambda, spanFromSources(lparenTok, rparenTok, eqTok, gtTok, body));
      return lambda;
    } catch {
      // rewind and treat as parenthesized expression
      ctx.index = save;
    }
  }
  if (ctx.isKeywordSeq(KW.OK_OF)) {
    const tokens = kwParts(KW.OK_OF).map(() => ctx.nextWord());
    const expr = parseExpr(ctx, error);
    const node = Node.Ok(expr);
    assignSpanFromSources(node, tokens[0]!, expr);
    return node;
  }
  if (ctx.isKeywordSeq(KW.ERR_OF)) {
    const tokens = kwParts(KW.ERR_OF).map(() => ctx.nextWord());
    const expr = parseExpr(ctx, error);
    const node = Node.Err(expr);
    assignSpanFromSources(node, tokens[0]!, expr);
    return node;
  }
  if (ctx.isKeywordSeq(KW.SOME_OF)) {
    const tokens = kwParts(KW.SOME_OF).map(() => ctx.nextWord());
    const expr = parseExpr(ctx, error);
    const node = Node.Some(expr);
    assignSpanFromSources(node, tokens[0]!, expr);
    return node;
  }
  if (ctx.isKeyword(KW.NONE)) {
    const tok = ctx.nextWord();
    const node = Node.None();
    assignSpan(node, spanFromToken(tok));
    return node;
  }
  if (ctx.at(TokenKind.STRING)) {
    const tok = ctx.next();
    const node = Node.String(tok.value as string);
    assignSpan(node, spanFromToken(tok));
    return node;
  }
  if (ctx.at(TokenKind.BOOL)) {
    const tok = ctx.next();
    const node = Node.Bool(tok.value as boolean);
    assignSpan(node, spanFromToken(tok));
    return node;
  }
  if (ctx.isKeyword(KW.NULL)) {
    const tok = ctx.nextWord();
    const node = Node.Null();
    assignSpan(node, spanFromToken(tok));
    return node;
  }
  if (ctx.at(TokenKind.NULL)) {
    const tok = ctx.next();
    const node = Node.Null();
    assignSpan(node, spanFromToken(tok));
    return node;
  }
  if (ctx.at(TokenKind.INT)) {
    const tok = ctx.next();
    const node = Node.Int(tok.value as number);
    assignSpan(node, spanFromToken(tok));
    return node;
  }
  if (ctx.at(TokenKind.LONG)) {
    const tok = ctx.next();
    const node = Node.Long(tok.value as string);
    assignSpan(node, spanFromToken(tok));
    return node;
  }
  if (ctx.at(TokenKind.FLOAT)) {
    const tok = ctx.next();
    const node = Node.Double(tok.value as number);
    assignSpan(node, spanFromToken(tok));
    return node;
  }
  if (ctx.isKeyword(KW.AWAIT)) {
    const awaitTok = ctx.nextWord();
    const args = parseArgList(ctx, error);
    if (args.length !== 1) error('await(expr) takes exactly one argument');
    const target = assignTokenSpan(Node.Name('await'), awaitTok);
    const call = Node.Call(target, args);
    const endTok = lastConsumedToken(ctx);
    assignSpan(call, spanFromSources(awaitTok, endTok));
    return call;
  }

  // Parenthesized expressions
  if (ctx.at(TokenKind.LPAREN)) {
    const lparenTok = ctx.next();
    const expr = parseExpr(ctx, error);
    if (!ctx.at(TokenKind.RPAREN)) error("Expected ')' after expression");
    const rparenTok = ctx.next();
    assignSpanFromSources(expr, lparenTok, rparenTok, expr);
    return expr;
  }

  // Construction: Type with a = expr and b = expr
  if (ctx.at(TokenKind.TYPE_IDENT)) {
    const typeTok = ctx.next();
    const typeName = typeTok.value as string;
    if (ctx.isKeyword(KW.WITH)) {
      const withTok = ctx.nextWord();
      const fields: ConstructField[] = [];
      let hasMore = true;
      while (hasMore) {
        const nameTok = ctx.peek();
        const name = parseIdent(ctx, error);
        if (!ctx.at(TokenKind.EQUALS)) error("Expected '=' in construction");
        const equalsTok = ctx.peek();
        ctx.next();
        const e = parseExpr(ctx, error);
        const fld: ConstructField = {
          name,
          expr: e,
          span: spanFromSources(nameTok, equalsTok, e),
        };
        fields.push(fld);
        if (ctx.isKeyword(KW.AND)) {
          ctx.nextWord();
          continue;
        }
        if (ctx.at(TokenKind.COMMA)) {
          ctx.next();
          continue;
        }
        hasMore = false;
      }
      const constructNode = Node.Construct(typeName, fields);
      const endTok = lastConsumedToken(ctx);
      assignSpan(constructNode, spanFromSources(typeTok, withTok, endTok));
      return constructNode;
    }
    // Dotted chain after TypeIdent (e.g., AuthRepo.verify)
    let full = typeName;
    const consumedTokens: Token[] = [typeTok];
    while (
      ctx.at(TokenKind.DOT) &&
      ctx.tokens[ctx.index + 1] &&
      (ctx.tokens[ctx.index + 1]!.kind === TokenKind.IDENT || ctx.tokens[ctx.index + 1]!.kind === TokenKind.TYPE_IDENT)
    ) {
      const dotTok = ctx.next();
      consumedTokens.push(dotTok);
      if (ctx.at(TokenKind.IDENT)) {
        const partTok = ctx.peek();
        const part = parseIdent(ctx, error);
        consumedTokens.push(partTok);
        full += '.' + part;
      } else if (ctx.at(TokenKind.TYPE_IDENT)) {
        const partTok = ctx.next();
        consumedTokens.push(partTok);
        full += '.' + (partTok.value as string);
      } else {
        error('Expected identifier after dot');
      }
    }
    const target = Node.Name(full);
    assignSpan(target, spanFromSources(...consumedTokens));
    if (ctx.at(TokenKind.LPAREN)) {
      const args = parseArgList(ctx, error);
      const call = Node.Call(target, args);
      const endTok = lastConsumedToken(ctx);
      assignSpan(call, spanFromSources(target, endTok));
      return call;
    }
    return target;
  }

  if (ctx.at(TokenKind.IDENT)) {
    const nameTok = ctx.peek();
    const name = parseIdent(ctx, error);
    // dotted chain
    let full = name;
    const consumedTokens: Token[] = [nameTok];
    while (
      ctx.at(TokenKind.DOT) &&
      ctx.tokens[ctx.index + 1] &&
      (ctx.tokens[ctx.index + 1]!.kind === TokenKind.IDENT || ctx.tokens[ctx.index + 1]!.kind === TokenKind.TYPE_IDENT)
    ) {
      const dotTok = ctx.next();
      consumedTokens.push(dotTok);
      if (ctx.at(TokenKind.IDENT)) {
        const partTok = ctx.peek();
        full += '.' + parseIdent(ctx, error);
        consumedTokens.push(partTok);
      } else if (ctx.at(TokenKind.TYPE_IDENT)) {
        const partTok = ctx.next();
        full += '.' + (partTok.value as string);
        consumedTokens.push(partTok);
      }
    }
    const target = Node.Name(full);
    assignSpan(target, spanFromSources(...consumedTokens));
    if (ctx.at(TokenKind.LPAREN)) {
      const args = parseArgList(ctx, error);
      const call = Node.Call(target, args);
      const endTok = lastConsumedToken(ctx);
      assignSpan(call, spanFromSources(target, endTok));
      return call;
    }
    return target;
  }

  error('Unexpected expression');
}

/**
 * 解析参数列表
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 * @returns Expression 数组
 */
export function parseArgList(
  ctx: ParserContext,
  error: (msg: string) => never
): Expression[] {
  if (!ctx.at(TokenKind.LPAREN)) error("Expected '('");
  ctx.next();
  const args: Expression[] = [];
  while (!ctx.at(TokenKind.RPAREN)) {
    args.push(parseExpr(ctx, error));
    if (ctx.at(TokenKind.COMMA)) {
      ctx.next();
      continue;
    } else break;
  }
  if (!ctx.at(TokenKind.RPAREN)) error("Expected ')'");
  ctx.next();
  return args;
}

/**
 * 解析模式（Pattern）
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 * @returns Pattern 节点
 */
export function parsePattern(
  ctx: ParserContext,
  error: (msg: string) => never
): Pattern {
  if (ctx.isKeyword(KW.NULL) || ctx.at(TokenKind.NULL)) {
    const tok = ctx.at(TokenKind.NULL) ? ctx.next() : ctx.nextWord();
    const node = Node.PatternNull();
    assignSpan(node, spanFromToken(tok));
    return node;
  }
  if (ctx.at(TokenKind.INT)) {
    const tok = ctx.next();
    const node = Node.PatternInt(tok.value as number);
    assignSpan(node, spanFromToken(tok));
    return node;
  }
  if (ctx.at(TokenKind.TYPE_IDENT)) {
    const typeTok = ctx.next();
    const typeName = typeTok.value as string;
    if (ctx.at(TokenKind.LPAREN)) {
      const lparenTok = ctx.next();
      const names: string[] = [];
      const nameTokens: Token[] = [];
      while (!ctx.at(TokenKind.RPAREN)) {
        const nameTok = ctx.peek();
        names.push(parseIdent(ctx, error));
        nameTokens.push(nameTok);
        if (ctx.at(TokenKind.COMMA)) {
          ctx.next();
          continue;
        } else break;
      }
      if (!ctx.at(TokenKind.RPAREN)) error("Expected ')' in pattern");
      const rparenTok = ctx.next();
      const node = Node.PatternCtor(typeName, names);
      assignSpan(node, spanFromSources(typeTok, lparenTok, rparenTok, ...nameTokens));
      return node;
    }
    // No LPAREN: treat bare TypeIdent as a variant name pattern (enum member)
    const node = Node.PatternName(typeName);
    assignSpan(node, spanFromToken(typeTok));
    return node;
  }
  const nameTok = ctx.peek();
  const name = parseIdent(ctx, error);
  const node = Node.PatternName(name);
  assignSpan(node, spanFromToken(nameTok));
  return node;
}

/**
 * 解析参数列表（函数声明）
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 * @returns Parameter 数组
 */
export function parseParamList(
  ctx: ParserContext,
  error: (msg: string, tok?: import('../types.js').Token) => never
): Parameter[] {
  const params: Parameter[] = [];
  // 'with' params
  if (ctx.isKeyword(KW.WITH)) {
    ctx.nextWord();
    let hasMore = true;
    while (hasMore) {
      // 在开始解析参数前，先消费换行和缩进，支持多行格式
      ctx.consumeNewlines();
      ctx.consumeIndent();

      const nameTok = ctx.peek();
      const name = parseIdent(ctx, error);
      let type: Type;
      let colonTok: Token | undefined;
      let typeInferred = false;
      if (ctx.at(TokenKind.COLON)) {
        colonTok = ctx.next();
        type = parseType(ctx, error);
      } else {
        typeInferred = true;
        type = inferFieldType(name);
        assignSpan(type, spanFromTokens(nameTok, nameTok));
      }

      // 解析可选的约束列表（在类型之后）
      const { constraints, lastToken: constraintEndToken } = parseConstraints(ctx, error);

      if (typeInferred && constraints.length > 0) {
        type = refineInferredType(type, constraints);
        assignSpan(type, spanFromTokens(nameTok, nameTok));
      }

      const spanEnd = constraintEndToken || type;
      const paramSpan = colonTok
        ? spanFromSources(nameTok, colonTok, spanEnd)
        : spanFromSources(nameTok, spanEnd);
      const param: Parameter =
        constraints.length > 0
          ? { name, type, constraints, ...(typeInferred ? { typeInferred: true } : {}), span: paramSpan }
          : { name, type, ...(typeInferred ? { typeInferred: true } : {}), span: paramSpan };
      params.push(param);
      if (ctx.at(TokenKind.IDENT) && ((ctx.peek().value as string) || '').toLowerCase() === KW.AND) {
        ctx.nextWord();
        // 'and' 后允许换行和缩进
        ctx.consumeNewlines();
        ctx.consumeIndent();
        continue;
      }
      if (ctx.at(TokenKind.COMMA)) {
        ctx.next();
        // 逗号后允许换行
        ctx.consumeNewlines();
        const after = peekKeywordIgnoringLayout(ctx);
        if (after === KW.PRODUCE) {
          hasMore = false;
        } else {
          // 不是 'produce'，继续解析参数（可能有 INDENT 表示增加了缩进）
          ctx.consumeIndent();
          continue;
        }
      } else {
        hasMore = false;
      }
    }
    return params;
  }
  // Bare params: name: Type [constraints] [(and|,) name: Type [constraints]]*
  if (ctx.at(TokenKind.IDENT) && ctx.tokens[ctx.index + 1] && ctx.tokens[ctx.index + 1]!.kind === TokenKind.COLON) {
    let hasMore = true;
    while (hasMore) {
      // 在开始解析参数前，先消费换行和缩进，支持多行格式
      ctx.consumeNewlines();
      ctx.consumeIndent();

      const nameTok = ctx.peek();
      const name = parseIdent(ctx, error);
      let type: Type;
      let colonTok: Token | undefined;
      let typeInferred = false;
      if (ctx.at(TokenKind.COLON)) {
        colonTok = ctx.next();
        type = parseType(ctx, error);
      } else {
        typeInferred = true;
        type = inferFieldType(name);
        assignSpan(type, spanFromTokens(nameTok, nameTok));
      }

      // 解析可选的约束列表（在类型之后）
      const { constraints, lastToken: constraintEndToken } = parseConstraints(ctx, error);

      if (typeInferred && constraints.length > 0) {
        type = refineInferredType(type, constraints);
        assignSpan(type, spanFromTokens(nameTok, nameTok));
      }

      const spanEnd = constraintEndToken || type;
      const paramSpan = colonTok
        ? spanFromSources(nameTok, colonTok, spanEnd)
        : spanFromSources(nameTok, spanEnd);
      const param: Parameter =
        constraints.length > 0
          ? { name, type, constraints, ...(typeInferred ? { typeInferred: true } : {}), span: paramSpan }
          : { name, type, ...(typeInferred ? { typeInferred: true } : {}), span: paramSpan };
      params.push(param);
      // Accept 'and' or ',' between parameters
      if (ctx.at(TokenKind.IDENT) && ((ctx.peek().value as string) || '').toLowerCase() === KW.AND) {
        ctx.nextWord();
        // 'and' 后允许换行和缩进
        ctx.consumeNewlines();
        ctx.consumeIndent();
        continue;
      }
      if (ctx.at(TokenKind.COMMA)) {
        ctx.next();
        // 逗号后允许换行
        ctx.consumeNewlines();
        const after = peekKeywordIgnoringLayout(ctx);
        if (after === KW.PRODUCE || after === KW.WITH) {
          hasMore = false;
        } else {
          // 不是终止关键字，继续解析参数
          ctx.consumeIndent();
          continue;
        }
      } else {
        hasMore = false;
      }
    }
  }
  return params;
}

/**
 * 推断 Lambda 返回类型（用于短形式 Lambda）
 * @param e Expression
 * @returns Type
 */
export function inferLambdaReturnType(e: Expression): Type {
  const attachSpan = <T extends Type>(node: T): T => {
    assignSpan(node, cloneSpan(e.span));
    return node;
  };
  switch (e.kind) {
    case 'String':
      return attachSpan(Node.TypeName('Text'));
    case 'Int':
      return attachSpan(Node.TypeName('Int'));
    case 'Bool':
      return attachSpan(Node.TypeName('Bool'));
    case 'Call': {
      if (e.target.kind === 'Name') {
        const n = e.target.name;
        if (n === 'Text.concat') return attachSpan(Node.TypeName('Text'));
        if (n === 'Text.length') return attachSpan(Node.TypeName('Int'));
        if (n === '+') return attachSpan(Node.TypeName('Int'));
        if (n === 'not') return attachSpan(Node.TypeName('Bool'));
        if (n === '<' || n === '>' || n === '<=' || n === '>=' || n === '==' || n === '!=')
          return attachSpan(Node.TypeName('Bool'));
      }
      return attachSpan(Node.TypeName('Unknown'));
    }
    default:
      return attachSpan(Node.TypeName('Unknown'));
  }
}

// ===== 辅助函数 =====

/**
 * 解析标识符
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 * @returns 标识符字符串
 */
function parseIdent(
  ctx: ParserContext,
  error: (msg: string) => never
): string {
  if (!ctx.at(TokenKind.IDENT)) {
    error('Expected identifier');
  }
  return ctx.next().value as string;
}

/**
 * 期望关键字
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 * @param kw 关键字
 * @param msg 错误消息
 */
function expectKeyword(
  ctx: ParserContext,
  error: (msg: string) => never,
  kw: string,
  msg: string
): void {
  if (!ctx.isKeyword(kw)) error(msg);
  ctx.nextWord();
}

/**
 * 期望逗号或允许省略
 * @param ctx Parser 上下文
 */
function expectCommaOr(ctx: ParserContext): void {
  if (ctx.at(TokenKind.COMMA)) {
    ctx.next();
  }
}

/**
 * 期望换行符
 * @param ctx Parser 上下文
 * @param error 错误报告函数
 */
function expectNewline(
  ctx: ParserContext,
  error: (msg: string) => never
): void {
  if (!ctx.at(TokenKind.NEWLINE)) error('Expected newline');
  ctx.next();
}
