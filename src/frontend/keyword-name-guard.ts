/**
 * 关键词被改名为名字的警告（ADR 0056 修订 A6 K3，诊断 W802 `KEYWORD_RENAMED_AS_NAME`）：aster-lang-core `KeywordNameGuard` 的逐项移植。
 *
 * 非英文语言包下，关键词的本地化拼写被翻译成英文规范拼写，名字位置的同形词随之被改名：zh 字段 `版本` 的运行时键变成
 * `version`，de `erlauben`、hi `अनुमति` 变成 `allow`，作者与审阅者读到的是原词，却没有任何诊断。产品裁决（2026-11-22）：
 * 解析行为不变（两引擎都按关键词的英文拼写取名），改为两引擎同码同文发出警告；是否升级为错误（Q4）待门禁扫描后决定。
 *
 * 判据只依赖 AST 里的名字文本与源码行，两引擎结果相同（不用 token 的 translated 标记：core 的规范化没有源映射，做不到同一判据）：
 * 语言包不是 en-US 时，令 W 为每个 kind（TYPE_ALIAS 除外——它不做全局翻译，名字位置的 `类型` 照常是名字）的 en-US 规范拼写，
 * 条件是该拼写是单个词，且本语言包的规范拼写或官方别名中至少有一个与它不同（否则不会发生改名）。名字等于 W 中某个拼写、
 * 而它所在的源码行里没有这个英文拼写的整词出现时报 W802——这时名字只能来自关键词翻译。作者在非英文源码里直接写英文拼写
 * （zh 源码里的 `allow`）不报：IR 名字就是所写的词。同一行既写英文拼写又写本地化关键词作名字时会漏报，只影响警告。
 *
 * 检查的位置：声明出的名字（数据类型、字段、枚举与成员、类型别名、规则、类型参数、形参含 lambda、Let / Set / Start /
 * Wait / 工作流步骤、构造字段、构造模式的绑定名）与点号名字的非首段（成员访问、限定调用）。不检查类型引用与名字引用的首段：
 * 内置类型（`整数` → `Int`）与运算形式的调用（`不是(x)` → `not(x)`）在这些位置本来就是关键词。
 *
 * 名字转义（ADR 0064）不需要额外判定：`` `版本` `` 不经翻译，名字就是 `版本`，不等于 W 中任何拼写；`` `version` `` 的英文拼写
 * 整词出现在本行（反引号不是标识符字符），同样不命中。help 建议的正是转义写法。
 */
import { ErrorCode, formatErrorMessage, getErrorMetadata } from '../diagnostics/error_codes.js';
import { EN_US } from '../config/lexicons/en-US.js';
import type { Lexicon } from '../config/lexicons/types.js';
import type { Block, Declaration, Expression, Module, Pattern, Span, Statement, TypecheckDiagnostic } from '../types.js';

/** W 中一项：命中时诊断里报告的 kind 与本语言包的规范拼写。 */
interface Hit {
  readonly kind: string;
  readonly keyword: string;
}

const SPAN0: Span = { start: { line: 1, col: 1 }, end: { line: 1, col: 1 } };

/** Java `String.compareTo` 的 UTF-16 码元序（TreeMap 的默认序）。 */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 本语言包的 W：英文规范拼写 → 命中信息。kind 按名字排序处理，两个 kind 英文拼写相同时取先者，与 core 同序。
 */
export function collisionWords(lexicon: Lexicon | undefined): Map<string, Hit> {
  const out = new Map<string, Hit>();
  if (!lexicon || lexicon.id.toLowerCase() === 'en-us') return out;
  const english = EN_US.keywords as Readonly<Record<string, string | undefined>>;
  const local = lexicon.keywords as Readonly<Record<string, string | undefined>>;
  const aliases = (lexicon.aliases ?? {}) as Readonly<Record<string, readonly string[] | undefined>>;
  for (const kind of Object.keys(english).sort(compareCodeUnits)) {
    if (kind === 'TYPE_ALIAS') continue;
    const en = english[kind];
    if (!en || en.trim() === '' || /\s/.test(en)) continue;
    const spellings: string[] = [];
    const canonical = local[kind];
    if (canonical && canonical.trim() !== '') spellings.push(canonical);
    for (const a of aliases[kind] ?? []) if (a && a.trim() !== '') spellings.push(a);
    if (spellings.some((s) => s !== en) && !out.has(en)) out.set(en, { kind, keyword: spellings[0]! });
  }
  return out;
}

/** 检查 AST，返回 W802 警告（按行、名字排序；同一名字同一位置只报一次）。语言包为 en-US 或缺失时返回空表。 */
export function checkKeywordNames(ast: Module | null | undefined, lexicon: Lexicon | undefined, source: string): TypecheckDiagnostic[] {
  const words = collisionWords(lexicon);
  if (words.size === 0 || !ast) return [];
  const out = new Collector(words, source.split('\n')).module(ast);
  return out.sort((a, b) => {
    const line = (a.span?.start.line ?? 0) - (b.span?.start.line ?? 0);
    if (line !== 0) return line;
    return compareCodeUnits(String((a.data as { name: string }).name), String((b.data as { name: string }).name));
  });
}

/** AST 遍历：与 core `KeywordNameGuard.Collector` 逐项对应。 */
class Collector {
  private readonly diagnostics: TypecheckDiagnostic[] = [];
  private readonly reported = new Set<string>();

  constructor(
    private readonly words: Map<string, Hit>,
    private readonly lines: readonly string[],
  ) {}

  module(m: Module): TypecheckDiagnostic[] {
    for (const d of m.decls) this.decl(d);
    for (const t of m.typeAliasDecls ?? []) this.declared(t.name, t.span);
    return this.diagnostics;
  }

  /** 声明出的名字：整体比较。 */
  private declared(name: string | null | undefined, span: Span | undefined): void {
    if (name) this.hit(name, span);
  }

  /** 名字引用：只看点号名字的非首段（成员访问、限定调用）。 */
  private referenced(name: string | null | undefined, span: Span | undefined): void {
    if (!name) return;
    const segments = name.split('.');
    for (let i = 1; i < segments.length; i++) this.hit(segments[i]!, span);
  }

  private hit(segment: string, span: Span | undefined): void {
    const hit = this.words.get(segment);
    if (!hit) return;
    const at = span ?? SPAN0;
    const key = `${at.start.line}:${at.start.col}:${segment}`;
    if (this.writtenInEnglish(at.start.line, segment) || this.reported.has(key)) return;
    this.reported.add(key);
    const data = { name: segment, keyword: hit.keyword, kind: hit.kind };
    const code = ErrorCode.KEYWORD_RENAMED_AS_NAME;
    this.diagnostics.push({
      severity: 'warning',
      code,
      message: formatErrorMessage(code, data),
      help: getErrorMetadata(code).help,
      span: at,
      data,
    });
  }

  /** 源码第 line 行是否有 word 的整词出现（两侧都不是 ASCII 字母、数字或下划线；W 的拼写都是 ASCII）。 */
  private writtenInEnglish(line: number, word: string): boolean {
    const text = this.lines[line - 1];
    if (text === undefined) return false;
    for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 1)) {
      if (!isAsciiWordChar(text[i - 1]) && !isAsciiWordChar(text[i + word.length])) return true;
    }
    return false;
  }

  private decl(d: Declaration): void {
    switch (d.kind) {
      case 'Import':
        return;
      case 'Data':
        this.declared(d.name, d.span);
        for (const f of d.fields) this.declared(f.name, spanOf(f) ?? d.span);
        return;
      case 'Enum':
        this.declared(d.name, d.nameSpan ?? d.span);
        d.variants.forEach((v, i) => this.declared(v, d.variantSpans?.[i] ?? d.span));
        return;
      case 'Func':
        this.declared(d.name, d.nameSpan ?? d.span);
        for (const p of d.typeParams) this.declared(p, d.span);
        for (const p of d.params) this.declared(p.name, spanOf(p) ?? d.span);
        this.block(d.body);
        return;
    }
  }

  private block(b: Block | null | undefined): void {
    if (b) for (const s of b.statements) this.stmt(s);
  }

  private stmt(s: Statement): void {
    switch (s.kind) {
      case 'Let':
      case 'Set':
        this.declared(s.name, s.span);
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
        this.declared(s.name, s.span);
        this.expr(s.expr);
        return;
      case 'Wait':
        for (const n of s.names) this.declared(n, s.span);
        return;
      case 'workflow':
        for (const step of s.steps) {
          this.declared(step.name, step.span);
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
        this.referenced(e.name, e.span);
        return;
      case 'Call':
        this.expr(e.target);
        for (const a of e.args) this.expr(a);
        return;
      case 'ListLit':
        for (const i of e.elements) this.expr(i);
        return;
      case 'Construct':
        for (const f of e.fields) {
          this.declared(f.name, spanOf(f) ?? e.span);
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
        for (const p of e.params) this.declared(p.name, spanOf(p) ?? e.span);
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
        p.names.forEach((n, i) => this.declared(n, p.nameSpans?.[i] ?? p.span));
        for (const a of p.args ?? []) this.pattern(a);
        return;
      default:
        // 模式名是枚举成员或 none 等关键词形式的引用，不是声明，不检查
        return;
    }
  }
}

function isAsciiWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /^[A-Za-z0-9_]$/.test(ch);
}

/** 字段 / 形参 / 构造字段的 span（解析器可能未写入）。 */
function spanOf(node: object): Span | undefined {
  return (node as { span?: Span }).span;
}
