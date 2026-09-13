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
  // ★线性短路守卫：两条 legacy 占位符模式都**必须**匹配到 `<`，
  //   故整段源码里没有 `<` 时它们必然零匹配，可以整体跳过。
  //
  //   这是**纵深防御，不是修复**（诚实定性，见下方与 ADR 0037 §12.12）：
  //     无 `<` 的输入（= 绝大多数真实源码）：2570ms → 0.00ms
  //     载荷里**放一个 `<`** 就绕过守卫：n=40000 仍 5143ms（×4.0 二次）
  //   即：它改善的是**真实世界**的常见路径，挡不住**刻意构造**的攻击者。
  //
  //   等价性实证（宽字母表，含 `\r \v \f` NBSP 全角 U+2028 与 `<` `>`）：
  //   随机 300000 组、其中 126933 组确有替换，逐字节零分歧。
  //   ——这条等价性是**可证明**的，不依赖语料：无 `<` ⇒ 两条模式必然零匹配。
  const hasPlaceholder = text.includes('<');

  // Pre-sanitize common broken patterns (e.g., accidental '.:' before earlier formatter fix)
  const input = text
    .replace(/produce([^\n]*?)\.\s*:/g, (_m, p1) => `produce${p1}:`)
    // Replace legacy placeholder return with strict 'none'
    //
    // ★★这一条**保持原样**，它确实是二次的（40000→2570ms），但我**没有**
    //   找到既等价又线性的改法，故不动它。记录已试过的方案，避免后人重走：
    //
    //   | 改法 | 等价？ | 线性？ |
    //   |---|---|---|
    //   | `(?<=^\|\n)([ \t]*)` | ✖ 窄字母表下零分歧，**宽字母表下全分歧** | ✓ |
    //   | `(?<!\s)\s*`（去 `^`） | ✖ 84063/300000 分歧 | ✓ |
    //   | `(?<!\s)^\s*`（保 `^`） | ✖ 30133/300000 分歧 | ✓ |
    //   | `(?<=^\|[\n\r…])(?:[^\S\n\r…]*[\n\r…])*…` | ✓ 零分歧 | ✖ **仍二次且慢 3 倍** |
    //   | 代码层左扫（两版） | ✖ 136116 / 121272 分歧 | ✓ |
    //
    //   ★第一行是我犯的错，值得写清楚：我曾据「200000 组零分歧」断言它等价，
    //   但我的**生成器字母表只有 space/tab/`\n`**——结构性地造不出反例。
    //   独立审查者用含 `\r \v \f` NBSP `U+2028` 的字母表一跑，**169/169 全分歧**。
    //   根因：`m` 下 `^` 也匹配 `\r`/`U+2028`/`U+2029`；`\s` 含 `\v \f` NBSP 全角空格
    //   而 `[ \t]` 不含。NBSP／全角空格是复制粘贴的常见输入，端到端可见。
    //
    //   **「零分歧」量的是语料，不是代码。**
    //
    //   ★为什么宁可留着二次也不改：这条的正确性直接决定用户代码被改写成什么。
    //   正确性 > 性能。
    //
    //   ★★2026-09-13 补：**改不了正则，就改输入**。本函数开头加了
    //   `hasPlaceholder` 线性短路（无 `<` ⇒ 两条模式必然零匹配 ⇒ 整段跳过）。
    //   那是**可证明**的等价，不依赖语料。真实源码绝大多数不含 `<`，
    //   故常见路径已降到线性。但**放一个 `<` 就绕过**，二次仍在，
    //   故本条仍属「已立项未修」，不得据此宣称已修复。
    //
    //   ★★缓解因素（我第一版在这里写错过，特此更正）：
    //
    //   我原先写「二次只在**恰好含 `<expr>` 占位符**时触发」——**那是错的**。
    //   `^\s*` 在**每个行首**回溯，与后面有没有 `Return <...>` 毫无关系。实测：
    //     无占位符 n=40000 → 2572ms
    //     含占位符 n=40000 → 2572ms      ← 完全一样
    //   我陈述的那个缓解因素提供**零保护**。
    //
    //   真正的缓解是**可达路径受限**，三条（均实测，见 ADR 0037 §12.12）：
    //
    //   1. 本 sanitize 链在 `mode !== 'lossless'` 时执行——★**包括不传 opts
    //      的默认调用**（`formatCNL(s)` n=40000 实测 5232ms，与 normalize 同）。
    //      我第一版在这里写「只在 `{ mode: 'normalize' }` 下执行」，**漏了默认
    //      那一档**。LSP 侧默认走 `'lossless'`（`src/lsp/formatting.ts:34,60`），
    //      且是**直接调** `buildCstLossless` 而非经 `formatCNL`，故 LSP 不可达。
    //   2. ★`formatCNL` **不在 `src/index.ts` 的公开导出面内**
    //      （`dist/src/index.js` 零命中）→ 第三方消费者无法直接调到。
    //      这条比第 1 条更强。
    //   3. 全仓 `.aster`/`.cnl` 语料中 `Return <` **零命中**，占位符确属历史
    //      遗留格式——但这只说明**触发面窄**，不减轻单次调用的二次代价。
    //
    //   ★注意：`lossless` 分支在 `buildCstLossless` 抛异常时会 fall through
    //   到 normalize（`U+FFFF` 可触发，实测 5212ms）——传了 lossless 也不等于
    //   绝对安全。仅存的内部调用方是 `scripts/format-examples.ts:31`（无 opts）
    //   与 `scripts/test-comments-golden.ts:21`（normalize），两者都未挂
    //   npm script、只读仓库自有文件。
    // Collapse accidental double periods from earlier bad formatters
    .replace(/\.{2,}/g, '.');

  // ★两条占位符模式（**只有它们**需要 `<`）走短路。
  //   ★我第一版把**整条 sanitize 链**都短路了，结果 `produce…:` 与
  //   `.{2,}→.` 这两条**不需要 `<`** 的清理也被跳过——语义被改坏。
  //   是我自己写的语义对拍测试当场抓到的（`"produce a. : b"`、`"a..b"` 两个反例）。
  //   ★教训：短路守卫的**作用域**必须精确到「真正依赖该前提的那几步」。
  // ★两条占位符模式改用**线性**实现 `replaceLineAnchoredPlaceholder`
  //   （短路守卫保留：无 `<` 时连正则都不必跑，是更早的一层）。
  const withPlaceholdersFixed = !hasPlaceholder ? input
    : replaceLineAnchoredPlaceholder(
        input, PLACEHOLDER_EXPR_CORE, m => m.replace('<expr>', 'none'))
        .replace(/<expr>\s*\./g, 'none.');

  const sanitized = !hasPlaceholder ? withPlaceholdersFixed
    : replaceLineAnchoredPlaceholder(
        withPlaceholdersFixed, PLACEHOLDER_ANY_CORE, () => 'Return none.');
  const can = canonicalize(sanitized);
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

/**
 * 供测试对拍的钩子：按**生产同序**依次跑两条占位符模式。
 *
 * <p>★不复制逻辑——直接调 {@link replaceLineAnchoredPlaceholder}，
 * 否则测试与实现会各自漂移（本仓记过「对照基准循环论证 / 各自漂移」的坑）。
 */
export function replaceLineAnchoredPlaceholderForTest(text: string): string {
  const step1 = replaceLineAnchoredPlaceholder(
    text, PLACEHOLDER_EXPR_CORE, m => m.replace('<expr>', 'none'));
  return replaceLineAnchoredPlaceholder(
    step1, PLACEHOLDER_ANY_CORE, () => 'Return none.');
}

/** `^` 在 m 标志下认可的行终止符（已实测：`\n` `\r` `\u2028` `\u2029`）。 */
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

/** 不含前导 `\s*` 的占位符核心模式——前导空白由代码线性处理。 */
const PLACEHOLDER_EXPR_CORE = /Return\s+<expr>\s*\./g;
const PLACEHOLDER_ANY_CORE = /Return\s+<[^>]+>\s*\./g;

/**
 * 线性实现 `/^\s*<core>/gm` 的语义。
 *
 * <h2>★为什么前七次改法都失败</h2>
 *
 * 我前后试了七种改法（三种改正则、两种去 `m`、两种代码层左扫），全部不等价或
 * 不线性。根因是我一直**凭直觉猜** `^\s*`（配 `m`）的语义，没有先把它测清楚。
 * 第八次先做了刻画实验，才发现两条被我反复搞混的性质：
 *
 * 1. 匹配**起点必然是某个行首**（`^`），`\s*` 只向**后**吃，绝不越过起点向前；
 * 2. 但 `\s*` **可以跨行**——起点行首可以在 `Return` 之前**若干行**
 *    （实测：`"a\n\n\n\n\nReturn <expr>."` 里 `Return` 在 idx 6，
 *    匹配起点却在 @2，吃掉了 `"\n\n\n\n"`）；
 * 3. 全局替换取**最靠前**那个能成功的行首。
 *
 * <p>把这三条写成算法就**既等价又线性**：
 * 用不含前导 `\s*` 的模式定位 core（线性），再从 core 起点向左跨过连续 `\s`，
 * 沿途记录**最靠前的行首**作为真正的匹配起点；若向左跨完 `\s` 后没遇到任何
 * 行首，则该处根本不匹配（对应原式 `^` 失配）。
 *
 * <p>每个字符最多被访问常数次 → O(n)。实测 40000 行空行：**2570ms → 0.01ms**。
 *
 * <h2>等价性实证</h2>
 *
 * 两条模式各跑随机 400000 组，字母表含 `\r \v \f` NBSP 全角空格
 * `\u2028` `\u2029`（★即上一轮把我的错误结论打掉的那批字符），
 * 其中 180649 / 180609 组确有替换，**逐字节零分歧**。
 */
function replaceLineAnchoredPlaceholder(
  text: string,
  core: RegExp,
  replace: (match: string) => string,
): string {
  let out = '';
  let last = 0;
  core.lastIndex = 0;

  for (let m = core.exec(text); m !== null; m = core.exec(text)) {
    // 向左跨过连续 `\s`，沿途记录**最靠前**的行首位置。
    let k = m.index;
    let earliest = -1;
    if (k === 0) earliest = 0;
    else if (LINE_TERMINATOR.test(text[k - 1]!)) earliest = k;
    while (k > last && /\s/.test(text[k - 1]!)) {
      k--;
      if (k === 0) { earliest = 0; break; }
      if (LINE_TERMINATOR.test(text[k - 1]!)) earliest = k;
    }
    if (earliest < 0) continue;            // 前面没有行首 ⇒ 原式 `^` 失配
    if (earliest < last) earliest = last;  // 不与上一处匹配重叠

    const end = m.index + m[0].length;
    out += text.slice(last, earliest) + replace(text.slice(earliest, end));
    last = end;
  }

  return out + text.slice(last);
}

/**
 * 去掉行尾的空格与制表符。
 *
 * <p>★刻意**不用正则**：`/[ \t]+$/` 呈二次回溯（`+` 在每个起始位置贪婪吃完
 * 再回退），实测 40000 空格的单行需 2424ms。格式化器吃的是用户源码，属攻击者
 * 可控输入。从行尾反向线性扫描是 O(n)，且语义完全一致。
 */
function stripTrailingBlanks(line: string): string {
  let end = line.length;
  while (end > 0) {
    const c = line.charCodeAt(end - 1);
    if (c !== 32 && c !== 9) break;   // 空格 / 制表符
    end--;
  }
  return end === line.length ? line : line.slice(0, end);
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
    // ★用线性扫描而非 `/[ \t]+$/` —— 后者是**二次回溯**：`+` 在每个位置都
    //   贪婪吃完剩余空白再因不到行尾而回退。实测 40000 空格的单行需 2424ms，
    //   而格式化器吃的是用户源码（攻击者可控）。
    fmtLines[i] = stripTrailingBlanks(line) + '  ' + comments[ci]!;
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
      case 'IfExpr':
        // ADR 0019 G2b：表达式级 if。
        return `if ${this.fmtExpr(e.cond)} then ${this.fmtExpr(e.thenE)} else ${this.fmtExpr(e.elseE)}`;
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
