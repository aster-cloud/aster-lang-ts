/**
 * W709：@pii 输入字段流入返回的 Text（aster-cloud#772 方案 3）。执行输出原样落库并在日志页展示，返回类型没有
 * `@pii` 时无法按声明打码，因此在编译期提醒策略作者。纯函数，作用于名称解析 R2 之后的 Core（只含规范名）。
 * Java 镜像：aster-lang-core/.../typecheck/governance/PiiTextReturnAnalyzer.java，两引擎对同一 Core 必须给出相同结果
 * （共享夹具 shared/governance_pii_text_return_parity.json）。
 *
 * 单个函数内的前向数据流。抽象值记录：来源 @pii 字段路径集合（以参数名为前缀，如 `applicant.name`）、
 * 已知的声明类型（用于继续选字段）、是否已知为 Text、以及它恰好对应的输入访问路径。
 * - 来源：形参的声明类型（逐层解包 PiiType / Option / Maybe）带 `@pii`，或沿点分访问选到的模块内记录字段带 `@pii`；
 *   从已带来源的值上选字段，来源原样保留（`@pii` 包住整个记录时报参数本身）。`@pii` 写在名字前
 *   （`given @pii(L1, name) name as Text`、`has @pii(L2, name) name as Text`）时降级为形参 / 字段的注解而不是 PiiType，
 *   同样算来源（aster-lang-ts#336）；注解名与降级一样不区分大小写。
 * - 传播只经过：变量引用、点分字段访问、`+` 与 `Text.concat` 的实参、if 表达式的两个分支、Let / Set 绑定。
 *   Set 覆盖原值；If / Match 各分支在环境副本上遍历，汇合处对未 Return 的分支取并；块内必然 Return 之后的语句
 *   不可达，不再分析。条件与 Match 主语不传播。
 * - 报告：函数声明返回类型恰为 `Text`（不含 `@pii(...) Text`，后者表示作者已声明输出是 PII），
 *   或返回类型由推断得到且返回值已知为 Text 时，返回值带来源的每个 Return 按字段字典序各报一条。
 *
 * 有意保守，只求没有误报，漏报可以接受：
 * - 不跨函数传播：调用同模块函数、内置函数（`+` 与 `Text.concat` 除外）或任何其他调用的结果都不带来源；
 *   被调函数自己的 `@pii` 形参在被调函数内单独检查。
 * - 不分析集合：List / Map 的元素、记录构造、Ok / Some 等包装都不带来源。
 * - Match 的模式变量、lambda 体与工作流步骤不分析；Scope 与外层共用环境。
 * - 只看声明：类型未标注（`typeInferred`）且没有前置 `@pii` 注解的形参与字段不视为 PII，也不按名字猜测。
 */
import type { Core } from '../types.js';

const TEXT = 'Text';
/** 字符串拼接：实参的来源全部并入结果。 */
const CONCAT: ReadonlySet<string> = new Set(['+', 'Text.concat']);

/** 一条发现：泄露的 @pii 字段路径与 Return 语句的源码位置。 */
export interface PiiTextLeak {
  readonly field: string;
  readonly origin: Core.Origin | undefined;
}

/**
 * 抽象值。pii 为来源字段路径；type 为已知的声明类型（未知为 null）；text 表示值已知为 Text；
 * path 为该值恰好对应的输入访问路径（如 `applicant.contact`），无则为 null。不可变。
 */
interface Val {
  readonly pii: ReadonlySet<string>;
  readonly type: Core.Type | null;
  readonly text: boolean;
  readonly path: string | null;
}

const CLEAN: Val = { pii: new Set(), type: null, text: false, path: null };

type Env = Map<string, Val>;

/** 按 UTF-16 码元比较，与 Java TreeSet<String> 的自然序一致。 */
function sorted(xs: Iterable<string>): string[] {
  return [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** 去掉 PiiType / Option / Maybe 外壳。 */
function unwrap(type: Core.Type | null | undefined): Core.Type | null {
  let t = type ?? null;
  while (t && (t.kind === 'PiiType' || t.kind === 'Option' || t.kind === 'Maybe')) {
    t = t.kind === 'PiiType' ? t.baseType : t.type;
  }
  return t;
}

/** 外壳中任一层是 PiiType。 */
function isPii(type: Core.Type | null | undefined): boolean {
  let t = type ?? null;
  while (t && (t.kind === 'Option' || t.kind === 'Maybe')) t = t.type;
  return t?.kind === 'PiiType';
}

/** 前置写法的 `@pii`：形参 / 字段注解里有名为 pii 的注解（不区分大小写，与 core 的 Locale.ROOT 小写同一判定）。 */
function hasPiiAnnotation(annotations: readonly Core.Annotation[] | undefined): boolean {
  return (annotations ?? []).some((a) => a?.name?.toLowerCase() === 'pii');
}

function isText(type: Core.Type | null | undefined): boolean {
  const t = unwrap(type);
  return t?.kind === 'TypeName' && t.name === TEXT;
}

function sameType(a: Core.Type | null, b: Core.Type | null): boolean {
  if (a === b) return true;
  return a?.kind === 'TypeName' && b?.kind === 'TypeName' && a.name === b.name;
}

function join(a: Val, b: Val): Val {
  return {
    pii: new Set([...a.pii, ...b.pii]),
    type: sameType(a.type, b.type) ? a.type : null,
    text: a.text && b.text,
    path: a.path === b.path ? a.path : null,
  };
}

function merge(a: Env, b: Env): Env {
  const out = new Map(a);
  for (const [k, v] of b) {
    const prev = out.get(k);
    out.set(k, prev === undefined ? v : join(prev, v));
  }
  return out;
}

function replace(env: Env, next: Env): void {
  env.clear();
  for (const [k, v] of next) env.set(k, v);
}

function bind(env: Env, name: string | null | undefined, v: Val): void {
  if (name !== null && name !== undefined) env.set(name, v);
}

/** 模式变量遮蔽同名外层绑定，一律不带来源。 */
function bindPattern(p: Core.Pattern | null | undefined, env: Env): void {
  if (!p) return;
  if (p.kind === 'PatName') bind(env, p.name, CLEAN);
  else if (p.kind === 'PatCtor') for (const a of p.args ?? []) bindPattern(a, env);
}

class Analyzer {
  private readonly records = new Map<string, Core.Data>();
  readonly declaredText: boolean;
  readonly leaks: PiiTextLeak[] = [];

  constructor(module: Pick<Core.Module, 'decls'>, func: Core.Func) {
    for (const d of module.decls ?? []) {
      if (d.kind === 'Data' && d.name !== null && d.name !== undefined && !this.records.has(d.name)) this.records.set(d.name, d);
    }
    this.declaredText = !func.retTypeInferred && func.ret?.kind === 'TypeName' && func.ret.name === TEXT;
  }

  seed(p: Core.Parameter): Val {
    const type = p.typeInferred ? null : p.type;
    return { pii: new Set(isPii(type) || hasPiiAnnotation(p.annotations) ? [p.name] : []), type, text: isText(type), path: p.name };
  }

  // ---- 语句 ----

  /**
   * 遍历语句，返回该语句是否必然以 Return 结束（其后的语句不可达）。块内遇到必然结束的语句即停；
   * 汇合只取未结束分支的环境，已 Return 的分支对后续语句没有影响。Match 视为可能不命中任何分支，从不必然结束。
   */
  walk(stmt: Core.Statement | Core.Block | null | undefined, env: Env): boolean {
    if (!stmt) return false;
    switch (stmt.kind) {
      case 'Let':
      case 'Set':
        bind(env, stmt.name, this.eval(stmt.expr, env));
        return false;
      case 'Return':
        this.report(this.eval(stmt.expr, env), stmt.origin);
        return true;
      case 'If': {
        const then = new Map(env);
        const thenEnds = this.walk(stmt.thenBlock, then);
        const otherwise = new Map(env);
        const elseEnds = this.walk(stmt.elseBlock, otherwise);
        if (thenEnds && elseEnds) return true;
        replace(env, thenEnds ? otherwise : elseEnds ? then : merge(then, otherwise));
        return false;
      }
      case 'Match': {
        let joined: Env = new Map(env);
        for (const c of stmt.cases ?? []) {
          const branch = new Map(env);
          bindPattern(c.pattern, branch);
          if (!this.walk(c.body, branch)) joined = merge(joined, branch);
        }
        replace(env, joined);
        return false;
      }
      case 'Block':
      case 'Scope':
        for (const s of stmt.statements ?? []) {
          if (this.walk(s, env)) return true;
        }
        return false;
      case 'Start':
        bind(env, stmt.name, CLEAN);
        return false;
      default:
        // Wait、Workflow：不分析
        return false;
    }
  }

  private report(v: Val, origin: Core.Origin | undefined): void {
    if (v.pii.size === 0 || !(this.declaredText || v.text)) return;
    for (const field of sorted(v.pii)) this.leaks.push({ field, origin });
  }

  // ---- 表达式 ----

  private eval(expr: Core.Expression | null | undefined, env: Env): Val {
    if (!expr) return CLEAN;
    switch (expr.kind) {
      case 'Name':
        return this.name(expr.name, env);
      case 'String':
        return { pii: new Set(), type: null, text: true, path: null };
      case 'Call':
        return this.call(expr, env);
      case 'IfExpr': {
        const t = this.eval(expr.thenE, env);
        const e = this.eval(expr.elseE, env);
        return { pii: new Set([...t.pii, ...e.pii]), type: null, text: t.text && e.text, path: null };
      }
      default:
        return CLEAN;
    }
  }

  private call(c: Core.Call, env: Env): Val {
    if (c.target.kind !== 'Name' || !CONCAT.has(c.target.name)) return CLEAN;
    const pii = new Set<string>();
    let text = c.target.name === 'Text.concat';
    for (const arg of c.args ?? []) {
      const v = this.eval(arg, env);
      for (const p of v.pii) pii.add(p);
      text = text || v.text;
    }
    return { pii, type: null, text, path: null };
  }

  /** 变量引用与点分字段访问：首段是局部名时逐段选字段；否则（函数名、枚举成员、限定名）不带来源。 */
  private name(name: string | null | undefined, env: Env): Val {
    if (name === null || name === undefined) return CLEAN;
    const direct = env.get(name);
    if (direct !== undefined) return direct;
    const dot = name.indexOf('.');
    if (dot < 0) return CLEAN;
    let v = env.get(name.slice(0, dot));
    if (v === undefined) return CLEAN;
    for (const seg of name.slice(dot + 1).split('.')) v = this.select(v, seg);
    return v;
  }

  private select(v: Val, seg: string): Val {
    const path = v.path === null ? null : `${v.path}.${seg}`;
    const field = this.fieldOf(v.type, seg);
    const type = !field || field.typeInferred ? null : field.type;
    const pii = new Set(v.pii);
    if (path !== null && (isPii(type) || hasPiiAnnotation(field?.annotations))) pii.add(path);
    return { pii, type, text: isText(type), path };
  }

  /** 解包后为模块内记录类型时按名取字段；否则 undefined。 */
  private fieldOf(type: Core.Type | null, seg: string): Core.Field | undefined {
    const t = unwrap(type);
    if (t?.kind !== 'TypeName') return undefined;
    return this.records.get(t.name)?.fields?.find((f) => f?.name === seg);
  }
}

/** 分析 module 中的函数 func，按 Return 的遍历顺序返回发现（同一 Return 内按字段字典序）。 */
export function analyzePiiTextReturns(module: Pick<Core.Module, 'decls'>, func: Core.Func): PiiTextLeak[] {
  if (!func.body) return [];
  const a = new Analyzer(module, func);
  if (!a.declaredText && !func.retTypeInferred) return [];
  const env: Env = new Map();
  for (const p of func.params ?? []) {
    if (p?.name !== null && p?.name !== undefined) env.set(p.name, a.seed(p));
  }
  a.walk(func.body, env);
  return a.leaks;
}
