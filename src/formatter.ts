import { canonicalize } from './frontend/canonicalizer.js';
import { lex } from './frontend/lexer.js';
import { parse } from './parser.js';
import { buildCst, buildCstLossless } from './cst/cst_builder.js';
import { printCNLFromCst } from './cst/cst_printer.js';
import type {
  Module,
  Declaration,
  Data,
  Enum,
  Func,
  Block,
  Statement,
  Expression,
  Parameter,
  Type,
  ConstructField,
} from './types.js';
import { DefaultAstVisitor } from './ast/ast_visitor.js';

export function formatCNL(
  text: string,
  opts?: { mode?: 'lossless' | 'normalize'; reflow?: boolean; preserveComments?: boolean; preserveStandaloneComments?: boolean }
): string {
  if (opts?.mode === 'lossless') {
    try {
      const cst = buildCstLossless(text);
      return printCNLFromCst(cst, { reflow: !!opts?.reflow });
    } catch {
      // fall through to normalize path
    }
  }
  // Pre-sanitize common broken patterns (e.g., accidental '.:' before earlier formatter fix)
  const input = text
    .replace(/produce([^\n]*?)\.\s*:/g, (_m, p1) => `produce${p1}:`)
    // Replace legacy placeholder return with strict 'none'
    .replace(/^\s*Return\s+<expr>\s*\./gm, match => match.replace(/<expr>/, 'none'))
    .replace(/<expr>\s*\./g, 'none.')
    .replace(/^\s*Return\s+<[^>]+>\s*\./gm, 'Return none.')
    // Collapse accidental double periods from earlier bad formatters
    .replace(/\.{2,}/g, '.');
  const can = canonicalize(input);
  let tokens;
  let originalTokens; // For extracting comments from original text
  try {
    tokens = lex(can);
    // When preserving comments, lex the original text to extract comment tokens
    if (opts?.preserveComments) {
      try {
        originalTokens = lex(text);
      } catch {
        // If original fails to lex, fall back to no comment preservation
        originalTokens = undefined;
      }
    }
  } catch {
    return text;
  }
  let formatted: string;
  const cst = buildCst(text, originalTokens ?? tokens);
  try {
    const ast = parse(tokens).ast as Module;
    formatted = simpleFormatModule(ast);
  } catch {
    // If the source doesn't parse, return it unchanged
    return input;
  }
  // Preserve a trailing newline if the original had one; otherwise leave as-is
  const hadTrailingNewline = /\n$/.test(cst.trailing?.text ?? '') || /\n$/.test(text);
  let out = formatted + (hadTrailingNewline ? '\n' : '');
  // Optional: best-effort preserve inline end-of-line comments from the original
  if (opts?.preserveComments) {
    out = reattachInlineComments(text, out, cst.inlineComments, !!opts?.preserveStandaloneComments);
  }
  // Preserve any byte order mark or leading whitespace prefix (if any)
  const leading = cst.leading?.text ?? '';
  const bom = leading.startsWith('\uFEFF') ? '\uFEFF' : '';
  return bom + out;
}

// Best-effort: preserve inline end-of-line comments (// or #) by collecting them
// from the original and appending them to the corresponding non-empty lines in
// the formatted output. Standalone comment lines are not preserved.
function reattachInlineComments(
  original: string,
  formatted: string,
  inline?: readonly { line: number; text: string; standalone?: boolean }[],
  includeStandalone?: boolean
): string {
  const origLines = original.split(/\r?\n/);
  const fmtLines = formatted.split(/\r?\n/);
  const comments: string[] = inline && inline.length ? inline.filter(c => !c.standalone).map(c => c.text) : (() : string[] => {
    const tmp: string[] = [];
    for (const line of origLines) {
      const m = line.match(/^(.*?)(\s*(\/\/|#).*)$/);
      if (m && m[1] && m[1].trim().length > 0 && m[2]) tmp.push(m[2].trim());
    }
    return tmp;
  })();
  const standalone: string[] = includeStandalone && inline && inline.length ? inline.filter(c => !!c.standalone).map(c => c.text) : [];
  if (comments.length === 0 && standalone.length === 0) return formatted;
  let ci = 0;
  for (let i = 0; i < fmtLines.length && ci < comments.length; i++) {
    const line = fmtLines[i]!;
    if (line.trim().length === 0) continue;
    // Avoid duplicating if formatted line already contains a comment
    if (/\/\//.test(line) || /(^|\s)#/.test(line)) continue;
    fmtLines[i] = line.replace(/[ \t]+$/, '') + '  ' + comments[ci]!;
    ci++;
  }
  // Insert standalone comments on empty lines (try to place near top/bottom and around blocks)
  if (includeStandalone && standalone.length > 0) {
    const firstNonEmpty = fmtLines.findIndex(l => l.trim().length > 0);
    let si = 0;
    // Place first standalone before the first non-empty line (header)
    if (firstNonEmpty >= 0) {
      fmtLines.splice(firstNonEmpty, 0, standalone[si]!);
      si++;
    }
    // If more than two, place intermediates after first indented line
    const firstIndented = fmtLines.findIndex(l => /^\s+\S/.test(l));
    while (si < standalone.length - 1 && firstIndented >= 0) {
      fmtLines.splice(firstIndented + 1, 0, standalone[si]!);
      si++;
    }
    // Place last at end
    if (si < standalone.length) fmtLines.push(standalone[si]!);
  }
  return fmtLines.join('\n');
}

function indent(n: number): string {
  return '  '.repeat(n);
}

function joinWithCommas(parts: string[]): string {
  return parts.join(', ');
}

 

// No doc-comment preservation in output; we keep formatting deterministic

class AstFormatterVisitor extends DefaultAstVisitor<void> {
  out: string[] = [];
  firstDecl = true;
  // 语句/表达式格式化使用的方法族，供外部函数委托调用
  fmtBlock(b: Block, lvl: number): string {
    const lines = b.statements.map(s => indent(lvl) + this.fmtStmt(s, lvl));
    return lines.join('\n');
  }
  fmtStmt(s: Statement, lvl: number): string {
    switch (s.kind) {
      case 'Let': {
        const anyExpr = (s as any).expr;
        if (anyExpr && anyExpr.kind === 'Lambda') {
          const lam = anyExpr as any;
          const ps = (lam.params as any[]).map((p: any) => `${p.name}: ${this.fmtType(p.type)}`).join(', ');
          const header = `Let ${s.name} be function with ${ps}, produce ${this.fmtType(lam.retType)}:`;
          const body = this.fmtBlock(lam.body, lvl + 1);
          return `${header}\n${body}`;
        }
        return `Let ${s.name} be ${this.fmtExpr(s.expr)}.`;
      }
      case 'Set':
        return `Set ${s.name} to ${this.fmtExpr(s.expr)}.`;
      case 'Return':
        return `Return ${this.fmtExpr(s.expr)}.`;
      case 'Start':
        return `Start ${s.name} as async ${this.fmtExpr((s as any).expr)}.`;
      case 'Wait': {
        const names = (s as any).names as string[];
        const inner = names.length <= 2 ? names.join(' and ') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
        return `Wait for ${inner}.`;
      }
      case 'If': {
        const head = `If ${this.fmtExpr(s.cond)},:`;
        const thenB = '\n' + this.fmtBlock(s.thenBlock, lvl + 1);
        const elseB = s.elseBlock ? `\n${indent(lvl)}Otherwise,:\n${this.fmtBlock(s.elseBlock, lvl + 1)}` : '';
        return `${head}${thenB}${elseB}`;
      }
      case 'Match': {
        const head = `Match ${this.fmtExpr(s.expr)}:`;
        const cases = s.cases
          .map(c => {
            const pat = this.fmtPattern(c.pattern as any);
            if (c.body.kind === 'Return') return `${indent(lvl + 1)}When ${pat}, Return ${this.fmtExpr(c.body.expr)}.`;
            return `${indent(lvl + 1)}When ${pat},:\n${this.fmtBlock(c.body, lvl + 2)}`;
          })
          .join('\n');
        return `${head}\n${cases}`;
      }
      case 'Block':
        return this.fmtBlock(s, lvl);
      default:
        return `${this.fmtExpr(s as unknown as Expression)}.`;
    }
  }
  fmtPattern(p: any): string {
    switch (p.kind) {
      case 'PatternNull':
        return 'null';
      case 'PatternInt':
        return String(p.value);
      case 'PatternName':
        return p.name;
      case 'PatternCtor': {
        if (p.args && p.args.length > 0) return `${p.typeName}(${p.args.map((pp: any) => this.fmtPattern(pp)).join(', ')})`;
        if (p.names && p.names.length > 0) return `${p.typeName}(${p.names.join(', ')})`;
        return p.typeName;
      }
      default:
        return '<pattern>';
    }
  }
  fmtExpr(e: Expression): string {
    switch (e.kind) {
      case 'Name':
        return e.name;
      case 'Bool':
        return e.value ? 'true' : 'false';
      case 'Null':
        return 'null';
      case 'Int':
        return String(e.value);
      case 'Long':
        return String(e.value) + 'L';
      case 'Double': {
        const v = e.value as number;
        if (Number.isFinite(v) && Math.floor(v) === v) return v.toFixed(1);
        return String(v);
      }
      case 'String':
        return JSON.stringify(e.value);
      case 'None':
        return 'none';
      case 'Ok':
        return `ok of ${this.fmtExpr(e.expr)}`;
      case 'Err':
        return `err of ${this.fmtExpr(e.expr)}`;
      case 'Some':
        return `some of ${this.fmtExpr(e.expr)}`;
      case 'Construct':
        return `${e.typeName} with ${e.fields.map(f => this.fmtConstructField(f)).join(', ')}`;
      case 'Call': {
        const t = e.target;
        const target = t.kind === 'Name' ? t.name : `(${this.fmtExpr(t)})`;
        const args = e.args.map(a => this.fmtExpr(a)).join(', ');
        return `${target}(${args})`;
      }
      case 'Lambda': {
        const ps = e.params.map(p => `${p.name}: ${this.fmtType(p.type)}`).join(', ');
        return `function with ${ps}, produce ${this.fmtType(e.retType)}:\n${this.fmtBlock(e.body, 1)}`;
      }
      default:
        return '<expr>';
    }
  }
  fmtConstructField(f: ConstructField): string {
    return `${f.name} = ${this.fmtExpr(f.expr)}`;
  }
  fmtType(t: Type): string {
    switch (t.kind) {
      case 'TypeName':
        return t.name;
      case 'Maybe':
        return `${this.fmtType(t.type)}` + '?';
      case 'Option':
        return `Option of ${this.fmtType(t.type)}`;
      case 'Result':
        return `Result of ${this.fmtType(t.ok)} and ${this.fmtType(t.err)}`;
      case 'List':
        return `List of ${this.fmtType(t.type)}`;
      case 'Map':
        return `Map ${this.fmtType(t.key)} to ${this.fmtType(t.val)}`;
      case 'TypeApp':
        return `${t.base} of ${t.args.map(a => this.fmtType(a)).join(', ')}`;
      case 'TypeVar':
        return t.name;
      case 'FuncType':
        return `(${t.params.map(p => this.fmtType(p)).join(', ')}) -> ${this.fmtType(t.ret)}`;
      case 'TypePii':
        return `@pii(${t.sensitivity}, ${t.category}) ${this.fmtType(t.baseType)}`;
      default:
        return '<type>';
    }
  }
  format(m: Module): string {
    this.out = [];
    this.firstDecl = true;
    this.visitModule(m, undefined as unknown as void);
    return this.out.join('\n');
  }
  override visitModule(m: Module, _ctx: void): void {
    if (m.name) {
      this.out.push(`Module ${m.name}.`);
      // 在模块头和第一个declaration之间添加空行
      if (m.decls.length > 0) this.out.push('');
    }
    for (const d of m.decls) this.visitDeclaration(d, undefined as unknown as void);
  }
  override visitDeclaration(d: Declaration, _ctx: void): void {
    // 在声明之间插入空行
    if (!this.firstDecl) this.out.push('');
    this.firstDecl = false;
    this.out.push(formatDecl(d));
  }
}

function simpleFormatModule(m: Module): string {
  return new AstFormatterVisitor().format(m);
}

function formatDecl(d: Declaration): string {
  switch (d.kind) {
    case 'Import': {
      const asPart = d.asName ? ` as ${d.asName}` : '';
      return `Use ${d.name}${asPart}.`;
    }
    case 'Data':
      return formatData(d as Data);
    case 'Enum':
      return formatEnum(d as Enum);
    case 'Func':
      return formatFunc(d as Func);
    default:
      return '// Unsupported declaration';
  }
}

function formatData(d: Data): string {
  const fields = d.fields.map(f => `${f.name} as ${formatType(f.type)}`);
  const tail = fields.length ? ` has ${joinWithCommas(fields)}` : '';
  return `Define ${d.name}${tail}.`;
}

function formatEnum(e: Enum): string {
  const vars = e.variants.join(', ');
  return `Define ${e.name} as one of ${vars}.`;
}

function formatFunc(f: Func): string {
  const params = formatParams(f.params);
  const hasEff = !!(f.effects && f.effects.length > 0);
  const capsTxt = formatEffectCaps(f);
  const effTxt = hasEff ? ` It performs ${formatEffects(f.effects)}${capsTxt}` : '';
  if (!f.body) {
    return `Rule ${f.name}${params}, produce ${formatType(f.retType)}.${effTxt}`.trimEnd();
  }
  const header = hasEff
    ? `Rule ${f.name}${params}, produce ${formatType(f.retType)}.${effTxt}:`
    : `Rule ${f.name}${params}, produce ${formatType(f.retType)}:`;
  const body = formatBlock(f.body, 1);
  return `${header}\n${body}`;
}

function formatEffectCaps(f: Func): string {
  const caps = f.effectCaps;
  const isExplicit = f.effectCapsExplicit;
  if (caps.length === 0) return '';
  if (!isExplicit) return '';
  if (!f.effects || f.effects.length === 0) return '';
  return ` [${caps.join(', ')}]`;
}

function formatEffects(effs: readonly string[]): string {
  if (effs.length === 1) return effs[0]!;
  return effs.slice(0, -1).join(' and ') + ' and ' + effs[effs.length - 1];
}

function formatParams(ps: readonly Parameter[]): string {
  if (!ps || ps.length === 0) return '';
  const inner = ps.map(p => `${p.name} as ${formatType(p.type)}`);
  return ` given ${joinWithCommas(inner)}`;
}

function formatBlock(b: Block, lvl: number): string {
  const v = new AstFormatterVisitor();
  return v.fmtBlock(b, lvl);
}

function formatType(t: Type): string {
  const v = new AstFormatterVisitor();
  return v.fmtType(t);
}
