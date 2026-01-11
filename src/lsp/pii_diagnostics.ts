import type { Diagnostic, Range } from 'vscode-languageserver/node.js';
import { DiagnosticSeverity } from 'vscode-languageserver/node.js';
import type { Core, Origin, Span } from '../types.js';
import { Effect } from '../types.js';
import { DefaultCoreVisitor } from '../core/visitor.js';
import { config } from './config.js';
import { ErrorCode } from '../diagnostics/error_codes.js';

// PII 敏感 sink 类型
type SinkKind = 'http' | 'database' | 'console' | 'file';

// 已知的 console/log sink 函数
const CONSOLE_SINKS = new Set([
  'print', 'IO.print', 'IO.println', 'log', 'Log.info', 'Log.debug', 'Log.warn', 'Log.error', 'Console.log'
]);

// 数据库写入操作（读取操作不视为 sink）
const DATABASE_WRITE_METHODS = new Set(['insert', 'update', 'delete', 'exec', 'execute', 'save', 'persist']);

// 文件写入操作
const FILE_WRITE_METHODS = new Set(['write', 'writeFile', 'append', 'save']);

// 同意检查函数（调用这些函数表示已进行同意检查）
const CONSENT_CHECK_FUNCTIONS = new Set([
  'checkConsent', 'requireConsent', 'verifyConsent',
  'Consent.check', 'Consent.require', 'Consent.verify',
  'GDPR.checkConsent', 'GDPR.requireConsent',
  'hasConsent', 'isConsentGiven'
]);

// 使用 Map 记录变量是否带有 PII 污染
type VarState = { tainted: boolean };
type Env = Map<string, VarState>;

interface ParsedEffect {
  kind: 'io' | 'cpu';
  capability?: string;
}

interface EffectCacheEntry {
  readonly cache: Map<string, boolean>;
  readonly visiting: Set<string>;
}

interface AnalysisContext {
  readonly functions: Map<string, Core.Func>;
  readonly datas: Map<string, Core.Data>;
  readonly effectCaches: Map<string, EffectCacheEntry>;
  env: Env;
  currentFunc: Core.Func | null;
}

let activeContext: AnalysisContext | null = null;

/**
 * 主入口：遍历 Core.Module 中的函数体，查找 PII 数据通过 HTTP IO 发送的行为。
 */
export function checkPiiFlow(core: Core.Module): Diagnostic[] {
  const ctx: AnalysisContext = {
    functions: collectFunctions(core),
    datas: collectDatas(core),
    effectCaches: new Map<string, EffectCacheEntry>(),
    env: new Map<string, VarState>(),
    currentFunc: null,
  };
  const prevCtx = activeContext;
  activeContext = ctx;
  try {
    const diagnostics: Diagnostic[] = [];
    for (const decl of core.decls) {
      if (decl.kind !== 'Func') continue;
      const env: Env = new Map<string, VarState>();
      let hasPiiParam = false;
      for (const param of decl.params) {
        const isPii = isTypePii(param.type);
        env.set(param.name, { tainted: isPii });
        if (isPii) hasPiiParam = true;
      }
      const prevEnv = ctx.env;
      ctx.env = env;
      ctx.currentFunc = decl;
      runPiiVisitor(decl.body, env, diagnostics);

      // 检查处理 PII 数据的函数是否有同意检查
      if (hasPiiParam && !hasConsentAnnotation(decl) && !hasConsentCheckInBody(decl.body)) {
        diagnostics.push(createConsentMissingDiagnostic(decl));
      }

      ctx.currentFunc = null;
      ctx.env = prevEnv;
    }
    return diagnostics;
  } finally {
    activeContext = prevCtx;
  }
}

/**
 * 判断表达式是否带有 PII 污染。
 */
export function isPiiTainted(expr: Core.Expression): boolean {
  const ctx = ensureContext();
  const env = ctx.env;
  const annotated = getAnnotatedType(expr);
  if (annotated && isTypePii(annotated)) return true;

  switch (expr.kind) {
    case 'Name': {
      const state = env.get(expr.name);
      return state?.tainted ?? false;
    }
    case 'Call': {
      const target = expr.target;
      if (target.kind === 'Name' && functionReturnsPii(target.name)) {
        return true;
      }
      if (annotated && isTypePii(annotated)) return true;
      // 保守处理：如果任一参数被污染，则认为返回值也被污染
      return expr.args.some(arg => evaluateWithEnv(arg, env));
    }
    case 'Construct':
      return expr.fields.some(field => evaluateWithEnv(field.expr, env));
    case 'Ok':
    case 'Err':
    case 'Some':
      return evaluateWithEnv(expr.expr, env);
    default:
      return false;
  }
}

/**
 * 判断函数表达式是否具备指定效果。
 */
export function hasEffect(func: Core.Expression, effect: string): boolean {
  const ctx = ensureContext();
  const parsed = parseEffect(effect);
  if (!parsed) return false;

  switch (parsed.kind) {
    case 'io':
      return expressionHasCapability(func, parsed, ctx);
    case 'cpu':
      return expressionHasCapability(func, parsed, ctx);
    default:
      return false;
  }
}

class PiiVisitor extends DefaultCoreVisitor<Env> {
  constructor(private readonly diagnostics: Diagnostic[]) { super(); }
  override visitBlock(block: Core.Block, env: Env): void {
    const ctx = ensureContext();
    const prevEnv = ctx.env;
    ctx.env = env;
    try {
      super.visitBlock(block, env);
    } finally {
      ctx.env = prevEnv;
    }
  }
  override visitStatement(stmt: Core.Statement, env: Env): void {
    switch (stmt.kind) {
      case 'Let':
      case 'Set': {
        super.visitStatement(stmt, env);
        const tainted = evaluateWithEnv(stmt.expr, env);
        env.set((stmt as Core.Let | Core.Set).name, { tainted });
        return;
      }
      case 'Match': {
        // matched expression taint guides pattern bindings
        const matchedTaint = evaluateWithEnv((stmt as Core.Match).expr, env);
        for (const kase of (stmt as Core.Match).cases) {
          const branchEnv = cloneEnv(env);
          bindPattern(kase.pattern, branchEnv, matchedTaint);
          if (kase.body.kind === 'Return') this.visitExpression(kase.body.expr, branchEnv);
          else this.visitBlock(kase.body, branchEnv);
        }
        return;
      }
    }
    super.visitStatement(stmt, env);
  }
  override visitExpression(expr: Core.Expression, env: Env): void {
    if (expr.kind === 'Call') {
      const sinkInfo = detectPiiSink(expr, env);
      if (sinkInfo) {
        this.diagnostics.push(createPiiDiagnostic(sinkInfo.kind, expr, sinkInfo.funcName));
      }
    }
    super.visitExpression(expr, env);
  }
}

/**
 * 检测 PII 数据流向敏感 sink 的情况
 */
function detectPiiSink(call: Core.Call, env: Env): { kind: SinkKind; funcName: string } | null {
  const hasTaintedArg = call.args.some(arg => evaluateWithEnv(arg, env));
  if (!hasTaintedArg) return null;

  const target = call.target;
  let funcName = '';

  // 提取函数名
  if (target.kind === 'Name') {
    funcName = target.name;
  } else if (target.kind === 'Call' && target.target.kind === 'Name') {
    // 处理链式调用如 Http.post(...)
    funcName = target.target.name;
  }

  // 检测 HTTP sink
  if (hasEffect(call.target, 'IO[Http]')) {
    return { kind: 'http', funcName: funcName || 'Http' };
  }

  // 检测 console/log sink
  if (CONSOLE_SINKS.has(funcName)) {
    return { kind: 'console', funcName };
  }

  // 检测数据库写入 sink
  const lowerName = funcName.toLowerCase();
  if (lowerName.startsWith('db.') || lowerName.startsWith('sql.') || lowerName.startsWith('database.')) {
    const method = lowerName.split('.')[1] ?? '';
    if (DATABASE_WRITE_METHODS.has(method)) {
      return { kind: 'database', funcName };
    }
  }

  // 检测文件写入 sink
  if (lowerName.startsWith('fs.') || lowerName.startsWith('file.') || lowerName.startsWith('io.')) {
    const method = lowerName.split('.')[1] ?? '';
    if (FILE_WRITE_METHODS.has(method)) {
      return { kind: 'file', funcName };
    }
  }

  return null;
}

/**
 * 创建 PII 诊断信息
 */
function createPiiDiagnostic(kind: SinkKind, expr: Core.Expression, funcName: string): Diagnostic {
  const origin = (expr as { origin?: Origin }).origin;
  const range = originToRange(origin);
  const severity = config.strictPiiMode ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning;

  switch (kind) {
    case 'http':
      return {
        severity,
        range,
        message: 'PII data transmitted over HTTP without encryption',
        source: 'aster-pii',
        code: ErrorCode.PII_HTTP_UNENCRYPTED,
        data: { sinkKind: 'http', func: funcName },
      };
    case 'console':
      return {
        severity: DiagnosticSeverity.Warning,
        range,
        message: `PII data may be exposed in logs via ${funcName}`,
        source: 'aster-pii',
        code: ErrorCode.PII_SINK_UNKNOWN,
        data: { sinkKind: 'console', func: funcName },
      };
    case 'database':
      return {
        severity,
        range,
        message: `PII data written to database via ${funcName} - ensure proper encryption`,
        source: 'aster-pii',
        code: ErrorCode.PII_SINK_UNKNOWN,
        data: { sinkKind: 'database', func: funcName },
      };
    case 'file':
      return {
        severity,
        range,
        message: `PII data written to file via ${funcName} - ensure proper access control`,
        source: 'aster-pii',
        code: ErrorCode.PII_SINK_UNKNOWN,
        data: { sinkKind: 'file', func: funcName },
      };
  }
}

function runPiiVisitor(block: Core.Block, env: Env, diagnostics: Diagnostic[]): void {
  new PiiVisitor(diagnostics).visitBlock(block, env);
}

/**
 * 检查函数是否有同意相关的注解
 */
function hasConsentAnnotation(func: Core.Func): boolean {
  const annotations = (func as any).annotations as readonly any[] | undefined;
  if (!annotations) return false;
  return annotations.some((a: any) => {
    const name = (a.name ?? a.kind ?? '').toLowerCase();
    return name === 'consent_required' ||
           name === 'consentrequired' ||
           name === 'gdpr_consent' ||
           name === 'requires_consent' ||
           name === 'consent';
  });
}

/**
 * 检查函数体是否包含同意检查调用
 */
function hasConsentCheckInBody(block: Core.Block): boolean {
  for (const stmt of block.statements) {
    if (statementHasConsentCheck(stmt)) return true;
  }
  return false;
}

/**
 * 检查语句是否包含同意检查调用
 */
function statementHasConsentCheck(stmt: Core.Statement): boolean {
  switch (stmt.kind) {
    case 'Let':
    case 'Set':
    case 'Return':
      return expressionHasConsentCheck(stmt.expr);
    case 'If':
      if (expressionHasConsentCheck(stmt.cond)) return true;
      if (hasConsentCheckInBody(stmt.thenBlock)) return true;
      if (stmt.elseBlock && hasConsentCheckInBody(stmt.elseBlock)) return true;
      return false;
    case 'Match':
      if (expressionHasConsentCheck(stmt.expr)) return true;
      for (const kase of stmt.cases) {
        if (kase.body.kind === 'Return') {
          if (expressionHasConsentCheck(kase.body.expr)) return true;
        } else if (hasConsentCheckInBody(kase.body)) {
          return true;
        }
      }
      return false;
    case 'Scope':
      return hasConsentCheckInBody({ kind: 'Block', statements: stmt.statements } as Core.Block);
    default:
      return false;
  }
}

/**
 * 检查表达式是否包含同意检查调用
 */
function expressionHasConsentCheck(expr: Core.Expression): boolean {
  switch (expr.kind) {
    case 'Call': {
      const target = expr.target;
      let funcName = '';
      if (target.kind === 'Name') {
        funcName = target.name;
      } else if (target.kind === 'Call' && target.target.kind === 'Name') {
        funcName = target.target.name;
      }
      if (CONSENT_CHECK_FUNCTIONS.has(funcName)) return true;
      // 递归检查参数
      for (const arg of expr.args) {
        if (expressionHasConsentCheck(arg)) return true;
      }
      return expressionHasConsentCheck(target);
    }
    case 'Lambda':
      return hasConsentCheckInBody(expr.body);
    case 'Construct':
      return expr.fields.some(f => expressionHasConsentCheck(f.expr));
    case 'Ok':
    case 'Err':
    case 'Some':
      return expressionHasConsentCheck(expr.expr);
    default:
      return false;
  }
}

/**
 * 创建缺失同意检查的诊断信息
 */
function createConsentMissingDiagnostic(func: Core.Func): Diagnostic {
  const origin = (func as { origin?: Origin }).origin;
  const range = originToRange(origin);
  return {
    severity: DiagnosticSeverity.Warning,
    range,
    message: `Function '${func.name}' processes PII data without consent check (GDPR Art. 6)`,
    source: 'aster-pii',
    code: ErrorCode.PII_MISSING_CONSENT_CHECK,
    data: { func: func.name, missingConsent: true },
  };
}

// 旧的 visitStatement/visitExpression 已由 PiiVisitor 替代，移除重复实现

function bindPattern(pattern: Core.Pattern, env: Env, tainted: boolean): void {
  switch (pattern.kind) {
    case 'PatName':
      env.set(pattern.name, { tainted });
      break;
    case 'PatCtor':
      if (pattern.names) {
        for (const name of pattern.names) env.set(name, { tainted });
      }
      if (pattern.args) {
        for (const arg of pattern.args) bindPattern(arg, env, tainted);
      }
      break;
    case 'PatNull':
    case 'PatInt':
      break;
    default:
      break;
  }
}

function evaluateWithEnv(expr: Core.Expression, env: Env): boolean {
  const ctx = ensureContext();
  const prevEnv = ctx.env;
  ctx.env = env;
  try {
    return isPiiTainted(expr);
  } finally {
    ctx.env = prevEnv;
  }
}

function collectFunctions(module: Core.Module): Map<string, Core.Func> {
  const map = new Map<string, Core.Func>();
  for (const decl of module.decls) {
    if (decl.kind === 'Func') map.set(decl.name, decl);
  }
  return map;
}

function collectDatas(module: Core.Module): Map<string, Core.Data> {
  const map = new Map<string, Core.Data>();
  for (const decl of module.decls) {
    if (decl.kind === 'Data') map.set(decl.name, decl);
  }
  return map;
}

function cloneEnv(env: Env): Env {
  const next: Env = new Map<string, VarState>();
  for (const [key, value] of env.entries()) {
    next.set(key, { tainted: value.tainted });
  }
  return next;
}

function ensureContext(): AnalysisContext {
  if (!activeContext) throw new Error('PII diagnostics context not initialized');
  return activeContext;
}

function isTypePii(type?: Core.Type | null): boolean {
  if (!type) return false;
  if (type.kind === 'PiiType') return true;
  return false;
}

function getAnnotatedType(expr: Core.Expression): Core.Type | null {
  const maybe = (expr as { type?: Core.Type }).type;
  return maybe ?? null;
}

function functionReturnsPii(name: string): boolean {
  const ctx = ensureContext();
  const fn = ctx.functions.get(name);
  if (!fn) return false;
  return isTypePii(fn.ret);
}

function expressionHasCapability(expr: Core.Expression, effect: ParsedEffect, ctx: AnalysisContext): boolean {
  switch (expr.kind) {
    case 'Name':
      return nameHasCapability(expr.name, effect, ctx);
    case 'Call':
      if (expressionHasCapability(expr.target, effect, ctx)) return true;
      for (const arg of expr.args) {
        if (expressionHasCapability(arg, effect, ctx)) return true;
      }
      return false;
    case 'Lambda': {
      const innerEnv = cloneEnv(ctx.env);
      const prevEnv = ctx.env;
      ctx.env = innerEnv;
      try {
        for (const param of expr.params) {
          innerEnv.set(param.name, { tainted: isTypePii(param.type) });
        }
        return blockHasCapability(expr.body, effect, ctx);
      } finally {
        ctx.env = prevEnv;
      }
    }
    case 'Construct':
      for (const field of expr.fields) {
        if (expressionHasCapability(field.expr, effect, ctx)) return true;
      }
      return false;
    case 'Ok':
    case 'Err':
    case 'Some':
      return expressionHasCapability(expr.expr, effect, ctx);
    default:
      return false;
  }
}

function blockHasCapability(block: Core.Block, effect: ParsedEffect, ctx: AnalysisContext): boolean {
  for (const stmt of block.statements) {
    if (statementHasCapability(stmt, effect, ctx)) return true;
  }
  return false;
}

function statementHasCapability(stmt: Core.Statement, effect: ParsedEffect, ctx: AnalysisContext): boolean {
  switch (stmt.kind) {
    case 'Let':
    case 'Set':
    case 'Return':
      return expressionHasCapability(stmt.expr, effect, ctx);
    case 'If':
      if (expressionHasCapability(stmt.cond, effect, ctx)) return true;
      if (blockHasCapability(stmt.thenBlock, effect, ctx)) return true;
      if (stmt.elseBlock && blockHasCapability(stmt.elseBlock, effect, ctx)) return true;
      return false;
    case 'Match':
      if (expressionHasCapability(stmt.expr, effect, ctx)) return true;
      for (const kase of stmt.cases) {
        if (kase.body.kind === 'Return') {
          if (expressionHasCapability(kase.body.expr, effect, ctx)) return true;
        } else if (blockHasCapability(kase.body, effect, ctx)) {
          return true;
        }
      }
      return false;
    case 'Scope':
      return blockHasCapability({ kind: 'Block', statements: stmt.statements } as Core.Block, effect, ctx);
    case 'Start':
      return expressionHasCapability(stmt.expr, effect, ctx);
    case 'Wait':
      return false;
    default:
      return false;
  }
}

function nameHasCapability(name: string, effect: ParsedEffect, ctx: AnalysisContext): boolean {
  const effectKey = `${effect.kind}:${effect.capability ?? ''}`;
  let entry = ctx.effectCaches.get(effectKey);
  if (!entry) {
    entry = { cache: new Map<string, boolean>(), visiting: new Set<string>() };
    ctx.effectCaches.set(effectKey, entry);
  }
  const cached = entry.cache.get(name);
  if (cached !== undefined) return cached;
  if (entry.visiting.has(name)) return false;
  entry.visiting.add(name);
  let result = false;

  if (effect.kind === 'io') {
    if (!effect.capability && directIoName(name)) {
      result = true;
    } else if (effect.capability === 'http' && httpLikeName(name)) {
      result = true;
    }
  } else if (effect.kind === 'cpu') {
    if (directCpuName(name)) {
      result = true;
    }
  }

  if (!result) {
    const fn = ctx.functions.get(name);
    if (fn) {
      if (effect.kind === 'io' && fn.effects.some(e => e === Effect.IO)) {
        const meta = fn as unknown as {
          effectCaps: readonly import('../config/semantic.js').CapabilityKind[];
          effectCapsExplicit: boolean;
        };
        const caps = (meta.effectCapsExplicit ? meta.effectCaps : []).map(
          cap => cap.toLowerCase()
        );
        if (!effect.capability) {
          result = true;
        } else if (caps.includes(effect.capability)) {
          result = true;
        }
      }
      if (effect.kind === 'cpu' && fn.effects.some(e => e === Effect.CPU)) {
        result = true;
      }
      if (!result && blockHasCapability(fn.body, effect, ctx)) {
        result = true;
      }
    }
  }

  entry.cache.set(name, result);
  entry.visiting.delete(name);
  return result;
}

function parseEffect(effect: string): ParsedEffect | null {
  const trimmed = effect.trim().toLowerCase();
  if (trimmed.startsWith('io[') && trimmed.endsWith(']')) {
    const cap = trimmed.slice(3, -1).trim();
    if (!cap) return { kind: 'io' };
    return { kind: 'io', capability: cap };
  }
  if (trimmed === 'io') return { kind: 'io' };
  if (trimmed === 'cpu') return { kind: 'cpu' };
  return null;
}

function directIoName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('io.') || lower.startsWith('fs.') || lower.startsWith('db.');
}

function httpLikeName(name: string): boolean {
  return name.startsWith('Http.') || name.startsWith('http.');
}

function directCpuName(name: string): boolean {
  return name.startsWith('Cpu.') || name.startsWith('cpu.');
}

function originToRange(origin: Origin | undefined): Range {
  const span = origin ? ({ start: origin.start, end: origin.end } as Span) : undefined;
  return spanToRange(span);
}

// 复用 spanOrDoc 的 0-based 转换逻辑，避免重复实现
function spanToRange(span: Span | undefined): Range {
  if (span) {
    return {
      start: { line: Math.max(0, span.start.line - 1), character: Math.max(0, span.start.col - 1) },
      end: { line: Math.max(0, span.end.line - 1), character: Math.max(0, span.end.col - 1) },
    };
  }
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
}
