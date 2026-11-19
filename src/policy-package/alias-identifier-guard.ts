/**
 * IR 名字守卫（ADR 0060 §5.3 第 2 条，诊断 E808 `ALIAS_IDENTIFIER_COLLISION`）：aster-lang-core
 * `AliasIdentifierGuard` 的逐项移植。
 *
 * 汉字单词别名没有空格，可能与源码里的名字同形；翻译后的关键词在部分名字位置被当作名字接受，
 * 参数、字段等会被一致改名为英文关键词并照常编译（静默改义，ADR 0060 资产 A2）。
 *
 * 规则：只在 aliasSet 含汉字单词别名时启用。K = 每个带汉字单词别名的 kind 在 en-US 词法表中的全部拼写
 * （规范拼写 + 官方别名）加上这些汉字别名本身，均取折叠键；解析后、名称解析前，AST 里任一名字
 * （点号分隔的名字逐段）折叠后属于 K 即失败。
 *
 * 另：两引擎在部分名字位置不接受翻译后的关键词，解析直接失败、守卫跑不到（ts：参数、Let、字段声明、规则名、
 * 枚举成员、构造字段；core：Data / 枚举名、枚举成员，以及 MODULE_DECL / FUNC_PRODUCE / 运算符的别名在任何名字位置）。
 * {@link attributeParseFailure} 用「把这一处换成普通名字后能否通过语法分析」判定别名是否被当作名字，两侧同一算法、同报 E808。
 */
import { ErrorCode, formatErrorMessage } from '../diagnostics/error_codes.js';
import { foldKey } from '../config/lexicons/identifiers/casefold.js';
import { EN_US } from '../config/lexicons/en-US.js';
import type {
  Block,
  Declaration,
  Expression,
  Module,
  Parameter,
  Pattern,
  Span,
  Statement,
  Type,
  TypecheckDiagnostic,
} from '../types.js';
import type { BaseParameter } from '../types/base.js';
import { isHanSingleToken, normalizeAlias, type AliasSet } from './alias-validate.js';

/** K 中一项：命中时诊断里报告的 kind 与别名。 */
interface Hit {
  readonly kind: string;
  readonly alias: string;
}

const SPAN0: Span = { start: { line: 1, col: 1 }, end: { line: 1, col: 1 } };

/**
 * 折叠键 → 命中信息。kind 按名字、别名按码点序处理，使报告的 kind / 别名确定（与 core 的 TreeMap / TreeSet 同序）。
 */
export function forbiddenKeys(aliasSet: AliasSet | null | undefined, locale: string): Map<string, Hit> {
  const out = new Map<string, Hit>();
  if (!aliasSet) return out;
  for (const kind of Object.keys(aliasSet).sort(compareCodePoints)) {
    const han = [...new Set((aliasSet[kind] ?? []).filter((a) => typeof a === 'string').map(normalizeAlias))]
      .filter((a) => isHanSingleToken(a, locale))
      .sort(compareCodePoints);
    if (han.length === 0) continue;
    for (const alias of han) if (!out.has(foldKey(alias))) out.set(foldKey(alias), { kind, alias });
    for (const spelling of englishSpellings(kind)) {
      if (!out.has(foldKey(spelling))) out.set(foldKey(spelling), { kind, alias: han[0]! });
    }
  }
  return out;
}

/** Java `String.compareTo` 的 UTF-16 码元序（TreeSet / TreeMap 的默认序）。 */
function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function englishSpellings(kind: string): string[] {
  const keywords = EN_US.keywords as Readonly<Record<string, string | undefined>>;
  const aliases = (EN_US.aliases ?? {}) as Readonly<Record<string, readonly string[] | undefined>>;
  const out: string[] = [];
  const canonical = keywords[kind];
  if (canonical && canonical.trim() !== '') out.push(canonical);
  for (const a of aliases[kind] ?? []) if (a && a.trim() !== '') out.push(a);
  return out;
}

function collisionDiagnostic(name: string, hit: Hit, span: Span | undefined): TypecheckDiagnostic {
  const data = { name, alias: hit.alias, kind: hit.kind };
  const message = formatErrorMessage(ErrorCode.ALIAS_IDENTIFIER_COLLISION, data);
  return { severity: 'error', code: ErrorCode.ALIAS_IDENTIFIER_COLLISION, message, span: span ?? SPAN0, data };
}

/** 检查 AST；返回 E808 诊断（按源码遍历顺序，同一名字同一位置只报一次），空即通过。 */
export function checkAliasIdentifiers(ast: Module, aliasSet: AliasSet | null | undefined, locale: string): TypecheckDiagnostic[] {
  const forbidden = forbiddenKeys(aliasSet, locale);
  if (forbidden.size === 0) return [];
  return new Collector(forbidden).module(ast);
}

/** 归因探测用的占位名：普通汉字名字，不是任何关键词或别名（U+4E96 两个）。 */
export const PROBE_PLACEHOLDER = '\u4e96\u4e96';

/** zh 词法的标识符字符（汉字基本区 / 扩展 A、ASCII 字母数字、`_`），用于整词边界判定。 */
function isIdentChar(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  const cp = ch.codePointAt(0)!;
  return (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || /^[A-Za-z0-9_]$/.test(ch);
}

/** 一行里汉字单词别名的整词出现位置（UTF-16 下标），按位置排序。 */
function hanAliasOccurrences(text: string, forbidden: Map<string, Hit>): { start: number; alias: string; hit: Hit }[] {
  const out: { start: number; alias: string; hit: Hit }[] = [];
  for (const [key, hit] of forbidden) {
    // 只取汉字别名本身的键（英文拼写的键也指向同一 Hit，跳过）
    if (key !== foldKey(hit.alias)) continue;
    for (let i = text.indexOf(hit.alias); i >= 0; i = text.indexOf(hit.alias, i + 1)) {
      if (!isIdentChar(text[i - 1]) && !isIdentChar(text[i + hit.alias.length])) out.push({ start: i, alias: hit.alias, hit });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * 解析失败归因（与 core `AliasIdentifierGuard.attributeParseFailure` 同一算法）：取第一条解析错误所在的源码行，
 * 按位置逐个尝试该行里汉字单词别名的整词出现——把这一处换成普通名字 {@link PROBE_PLACEHOLDER} 后若源码能通过语法分析，
 * 说明这里只能是把别名当作名字使用，报 E808；否则返回 null，调用方照常报解析错误。
 * 该行的每处出现都会探测（不按个数截断，以免漏掉真正的冲突）；总耗时由调用方给 `parsesSyntactically` 的共享时限约束。
 *
 * 两引擎在名字位置接受关键词的范围不同（core 有软关键字，ts 在参数、字段声明等位置不接受），解析失败时守卫跑不到；
 * 这一步让两侧对同一源码报同一码。`parsesSyntactically` 只做语法分析（不做名称解析）。
 */
export function attributeParseFailure(
  source: string,
  firstErrorLine: number | undefined,
  aliasSet: AliasSet | null | undefined,
  locale: string,
  parsesSyntactically: (probe: string) => boolean,
): TypecheckDiagnostic | null {
  const forbidden = forbiddenKeys(aliasSet, locale);
  if (forbidden.size === 0 || firstErrorLine === undefined) return null;
  const lines = source.split('\n');
  const text = lines[firstErrorLine - 1];
  if (text === undefined) return null;
  for (const o of hanAliasOccurrences(text, forbidden)) {
    const probeLines = [...lines];
    probeLines[firstErrorLine - 1] = text.slice(0, o.start) + PROBE_PLACEHOLDER + text.slice(o.start + o.alias.length);
    if (parsesSyntactically(probeLines.join('\n'))) {
      const at = { line: firstErrorLine, col: o.start + 1 };
      return collisionDiagnostic(o.alias, o.hit, { start: at, end: { line: firstErrorLine, col: o.start + 1 + o.alias.length } });
    }
  }
  return null;
}

/** AST 遍历：与 core `AliasIdentifierGuard.Collector` 逐项对应。 */
class Collector {
  private readonly diagnostics: TypecheckDiagnostic[] = [];
  private readonly reported = new Set<string>();

  constructor(private readonly forbidden: Map<string, Hit>) {}

  module(m: Module): TypecheckDiagnostic[] {
    this.name(m.name, m.span);
    for (const d of m.decls) this.decl(d);
    for (const t of m.typeAliasDecls ?? []) {
      this.name(t.name, t.span);
      this.type(t.type);
    }
    return this.diagnostics;
  }

  /** 点号分隔的名字逐段检查（模块名、导入路径、成员访问、限定调用目标）。 */
  private name(written: string | null | undefined, span: Span | undefined): void {
    if (!written) return;
    for (const segment of written.split('.')) {
      const hit = this.forbidden.get(foldKey(segment));
      if (hit) this.report(segment, hit, span);
    }
  }

  private report(segment: string, hit: Hit, span: Span | undefined): void {
    const at = span?.start ?? SPAN0.start;
    const key = `${at.line}:${at.col}:${segment}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.diagnostics.push(collisionDiagnostic(segment, hit, span));
  }

  private decl(d: Declaration): void {
    switch (d.kind) {
      case 'Import':
        this.name(d.name, d.span);
        this.name(d.asName, d.span);
        return;
      case 'Data':
        this.name(d.name, d.span);
        for (const f of d.fields) {
          this.name(f.name, spanOf(f) ?? d.span);
          this.type(f.type);
        }
        return;
      case 'Enum':
        this.name(d.name, d.nameSpan ?? d.span);
        d.variants.forEach((v, i) => this.name(v, d.variantSpans?.[i] ?? d.span));
        return;
      case 'Func':
        this.func(d);
        return;
    }
  }

  private func(f: Extract<Declaration, { kind: 'Func' }>): void {
    this.name(f.name, f.nameSpan ?? f.span);
    for (const p of f.typeParams) this.name(p, f.span);
    for (const p of f.effectParams ?? []) this.name(p, f.span);
    for (const p of f.params) this.parameter(p, f.span);
    this.type(f.retType);
    if (f.body) this.block(f.body);
  }

  private parameter(p: Parameter | BaseParameter<Type>, fallback: Span): void {
    this.name(p.name, spanOf(p) ?? fallback);
    this.type(p.type);
  }

  private block(b: Block | null | undefined): void {
    if (b) for (const s of b.statements) this.stmt(s);
  }

  private stmt(s: Statement): void {
    switch (s.kind) {
      case 'Let':
      case 'Set':
        this.name(s.name, s.span);
        this.expr(s.expr);
        return;
      case 'Return':
        this.expr(s.expr);
        return;
      case 'If':
        this.expr(s.cond);
        this.block(s.thenBlock);
        this.block(s.elseBlock);
        return;
      case 'Match':
        this.expr(s.expr);
        for (const c of s.cases) {
          this.pattern(c.pattern);
          if (c.body.kind === 'Block') this.block(c.body);
          else this.expr(c.body.expr);
        }
        return;
      case 'Start':
        this.name(s.name, s.span);
        this.expr(s.expr);
        return;
      case 'Wait':
        for (const n of s.names) this.name(n, s.span);
        return;
      case 'workflow':
        for (const step of s.steps) {
          this.name(step.name, step.span);
          for (const dep of step.dependencies) this.name(dep, step.span);
          this.block(step.body);
          this.block(step.compensate);
        }
        return;
      case 'Block':
        this.block(s);
        return;
      default:
        this.expr(s);
    }
  }

  private expr(e: Expression | null | undefined): void {
    if (!e) return;
    switch (e.kind) {
      case 'Name':
        this.name(e.name, e.span);
        return;
      case 'Call':
        this.expr(e.target);
        for (const a of e.args) this.expr(a);
        return;
      case 'ListLit':
        for (const i of e.elements) this.expr(i);
        return;
      case 'Construct':
        this.name(e.typeName, e.span);
        for (const f of e.fields) {
          this.name(f.name, spanOf(f) ?? e.span);
          this.expr(f.expr);
        }
        return;
      case 'Ok':
      case 'Err':
      case 'Some':
      case 'Await':
        this.expr(e.expr);
        return;
      case 'Lambda':
        for (const p of e.params) this.parameter(p, e.span);
        this.type(e.retType);
        this.block(e.body);
        return;
      case 'IfExpr':
        this.expr(e.cond);
        this.expr(e.thenE);
        this.expr(e.elseE);
        return;
      default:
        return;
    }
  }

  private pattern(p: Pattern | null | undefined): void {
    if (!p) return;
    switch (p.kind) {
      case 'PatternCtor':
      case 'PatCtor':
        this.name(p.typeName, p.span);
        p.names.forEach((n, i) => this.name(n, p.nameSpans?.[i] ?? p.span));
        for (const a of p.args ?? []) this.pattern(a);
        return;
      case 'PatternName':
      case 'PatName':
        this.name(p.name, p.span);
        return;
      default:
        return;
    }
  }

  private type(t: Type | null | undefined): void {
    if (!t) return;
    switch (t.kind) {
      case 'TypeName':
      case 'TypeVar':
        this.name(t.name, t.span);
        return;
      case 'TypeApp':
        this.name(t.base, t.span);
        for (const a of t.args) this.type(a);
        return;
      case 'Result':
        this.type(t.ok);
        this.type(t.err);
        return;
      case 'Maybe':
      case 'Option':
      case 'List':
        this.type(t.type);
        return;
      case 'Map':
        this.type(t.key);
        this.type(t.val);
        return;
      case 'FuncType':
        for (const p of t.params) this.type(p);
        this.type(t.ret);
        return;
      case 'TypePii':
        this.type(t.baseType);
        return;
      default:
        return;
    }
  }
}

/** 字段 / 构造字段的 span（解析器可能未写入）。 */
function spanOf(node: object): Span | undefined {
  return (node as { span?: Span }).span;
}
