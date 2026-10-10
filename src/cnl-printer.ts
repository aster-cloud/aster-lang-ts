/**
 * AST → 英文 CNL 打印器。
 *
 * 约定：输出须能被解析器重新读入，且得到与原文相同的 Core IR（忽略 origin）。
 * 因此凡是解析器会"推断"的内容（参数/字段类型、返回类型、类型参数）都按原文的省略写法输出，
 * 由同一推断规则再次得出；语法糖（When/Otherwise）在解析期已降糖，按长写法输出（ADR 0046 §5）。
 */
import type {
  Annotation,
  Block,
  Case,
  Constraint,
  ConstructField,
  Data,
  Declaration,
  Enum,
  Expression,
  Func,
  Module,
  Pattern,
  Statement,
  StepStmt,
  Type,
  WorkflowStmt,
} from './types.js';
import { inferLambdaReturnType } from './parser/expr-stmt-parser.js';

/** IR 运算符名 → 英文 CNL 词形、优先级（数值越大结合越紧）与元数，与解析器 parseOr…parseMultiplication 各层一致 */
interface OperatorInfo {
  readonly word: string;
  readonly prec: number;
  readonly arity: 1 | 2;
}
const COMPARISON_PREC = 4;
const ATOM_PREC = 7;
const OPERATORS: ReadonlyMap<string, OperatorInfo> = new Map<string, OperatorInfo>([
  ['or', { word: 'or', prec: 1, arity: 2 }],
  ['and', { word: 'and', prec: 2, arity: 2 }],
  ['not', { word: 'not', prec: 3, arity: 1 }],
  ['<', { word: 'less than', prec: COMPARISON_PREC, arity: 2 }],
  ['>', { word: 'greater than', prec: COMPARISON_PREC, arity: 2 }],
  ['<=', { word: 'at most', prec: COMPARISON_PREC, arity: 2 }],
  ['>=', { word: 'at least', prec: COMPARISON_PREC, arity: 2 }],
  ['==', { word: 'equals to', prec: COMPARISON_PREC, arity: 2 }],
  ['!=', { word: 'not equal to', prec: COMPARISON_PREC, arity: 2 }],
  ['+', { word: 'plus', prec: 5, arity: 2 }],
  ['-', { word: 'minus', prec: 5, arity: 2 }],
  ['*', { word: 'times', prec: 6, arity: 2 }],
  ['/', { word: 'divided by', prec: 6, arity: 2 }],
  ['//', { word: 'integer divided by', prec: 6, arity: 2 }],
  ['%', { word: 'modulo', prec: 6, arity: 2 }],
]);

// 以关键词开头、向右贪婪吞并表达式的形式：作操作数时必须加括号
const GREEDY_KINDS: ReadonlySet<string> = new Set(['IfExpr', 'Lambda', 'Ok', 'Err', 'Some', 'Construct']);

/** 目标为运算符名且实参个数与元数相符的调用才按运算符输出，其余仍是普通调用 */
function operatorOf(e: Expression): OperatorInfo | undefined {
  if (e.kind !== 'Call' || e.target.kind !== 'Name') return undefined;
  const op = OPERATORS.get(e.target.name);
  return op !== undefined && op.arity === e.args.length ? op : undefined;
}

function precedenceOf(e: Expression): number {
  if (GREEDY_KINDS.has(e.kind)) return 0;
  return operatorOf(e)?.prec ?? ATOM_PREC;
}

/**
 * Double 按普通十进制输出：词法不接受指数写法，且须保留小数点才读回 Double。
 * 取 JS 最短往返数字串，再把指数展开成补零的普通写法，读回得到同一个值。
 */
function plainDouble(v: number): string {
  const [mantissa, exp] = String(v).split('e');
  const sign = mantissa!.startsWith('-') ? '-' : '';
  const [intPart, fracPart = ''] = mantissa!.replace('-', '').split('.');
  const digits = intPart! + fracPart;
  const point = intPart!.length + Number(exp ?? 0);
  const whole = point <= 0 ? '0' : digits.slice(0, point).padEnd(point, '0');
  const frac = point <= 0 ? '0'.repeat(-point) + digits : digits.slice(point);
  return `${sign}${whole.replace(/^0+(?=\d)/, '')}.${frac.replace(/0+$/, '') || '0'}`;
}

/**
 * 打印文本是否以未加括号的构造（或块形 lambda）收尾：这类值会把其后的 `, f set to …` 当作自己的字段。
 * 作运算符操作数的构造已由 operand 加括号，故只需沿右侧不加括号的位置下探。
 */
function endsWithConstruct(e: Expression): boolean {
  switch (e.kind) {
    case 'Construct':
      return true;
    case 'Lambda':
      return !isArrowLambda(e) || endsWithConstruct((e.body.statements[0] as Statement & { kind: 'Return' }).expr);
    case 'Ok':
    case 'Err':
    case 'Some':
      return endsWithConstruct(e.expr);
    case 'IfExpr':
      return endsWithConstruct(e.elseE);
    default:
      return false;
  }
}

/** 字段、参数与 lambda 参数的共同形状 */
interface Binding {
  readonly name: string;
  readonly type: Type;
  readonly typeInferred?: boolean;
  readonly constraints?: readonly Constraint[];
}

function indent(n: number): string {
  return '  '.repeat(n);
}

/** 箭头 lambda 的 Lambda 节点：块体只有一条 Return 且返回类型正是由该表达式推断而来 */
function isArrowLambda(e: Expression & { kind: 'Lambda' }): boolean {
  const only = e.body.statements.length === 1 ? e.body.statements[0] : undefined;
  if (only === undefined || only.kind !== 'Return') return false;
  return JSON.stringify(inferLambdaReturnType(only.expr)) === JSON.stringify(stripSpans(e.retType));
}

function stripSpans(t: Type): unknown {
  return JSON.parse(JSON.stringify(t, (k, v) => (k === 'span' ? undefined : v)));
}

/** 类型中是否出现显式类型变量（说明原文写了 `of T`，否则类型参数由推断得出） */
function hasTypeVar(t: Type): boolean {
  return JSON.stringify(t).includes('"kind":"TypeVar"');
}

export function printModule(m: Module): string {
  return new CnlPrinter().module(m);
}

class CnlPrinter {
  // 当前语句所在缩进层级：块形 lambda 的函数体须比所在语句深一层
  private level = 0;

  module(m: Module): string {
    const head: string[] = [];
    if (m.name) head.push(`Module ${m.name}.`);
    // ADR 0046：档案声明紧跟模块头
    if (m.name && m.profile !== undefined) head.push(`Profile ${JSON.stringify(m.profile)}.`);
    const decls = m.decls.map(d => this.decl(d));
    if (head.length === 0) return decls.join('\n\n');
    return decls.length > 0 ? `${head.join('\n')}\n\n${decls.join('\n\n')}` : head.join('\n');
  }

  decl(d: Declaration): string {
    switch (d.kind) {
      case 'Import': {
        const version = d.version !== undefined ? ` version ${d.version}` : '';
        const asPart = d.asName ? ` as ${d.asName}` : '';
        return `Use ${d.name}${version}${asPart}.`;
      }
      case 'Data':
        return this.data(d);
      case 'Enum':
        return this.enumDecl(d);
      case 'Func':
        return this.func(d);
    }
  }

  data(d: Data): string {
    const fields = d.fields.map(f => this.binding(f));
    return `Define ${d.name} has ${fields.join(', ')}.`;
  }

  enumDecl(e: Enum): string {
    return `Define ${e.name} as one of ${e.variants.join(', ')}.`;
  }

  /** 字段与参数同一写法：推断出的类型不写出，其后跟约束 */
  binding(b: Binding): string {
    const typed = b.typeInferred ? b.name : `${b.name} as ${this.type(b.type)}`;
    const constraints = (b.constraints ?? []).map(c => this.constraint(c));
    return [typed, ...constraints].join(' ');
  }

  constraint(c: Constraint): string {
    switch (c.kind) {
      case 'Required':
        return 'required';
      case 'Pattern':
        return `matching pattern ${JSON.stringify(c.regexp)}`;
      case 'Range':
        if (c.min !== undefined && c.max !== undefined) return `between ${c.min} and ${c.max}`;
        return c.min !== undefined ? `at least ${c.min}` : `at most ${c.max}`;
    }
  }

  func(f: Func): string {
    const typeParams = this.explicitTypeParams(f);
    const params = f.params.length > 0 ? ` given ${f.params.map(p => this.binding(p)).join(', ')}` : '';
    const ret = f.retTypeInferred ? '' : ` ${this.type(f.retType)}`;
    const effects = this.effectClause(f);
    const head = `Rule ${f.name}${typeParams}${params}, produce${ret}${effects}`;
    const annotations = (f.annotations ?? []).map(a => `${this.annotation(a)}\n`).join('');
    if (!f.body) return `${annotations}${head}.`;
    return `${annotations}${head}:\n${this.block(f.body, 1)}`;
  }

  /** 只有原文显式写了 `of T` 时类型里才有 TypeVar；推断出的类型参数不写，由解析器重新推断 */
  explicitTypeParams(f: Func): string {
    const explicit = f.params.some(p => hasTypeVar(p.type)) || hasTypeVar(f.retType);
    return explicit && f.typeParams.length > 0 ? ` of ${f.typeParams.join(' and ')}` : '';
  }

  /** `. It performs io and cpu [Http, Sql]`；只在有基础效果或显式能力时输出 */
  effectClause(f: Func): string {
    const caps = f.effectCapsExplicit && f.effectCaps.length > 0 ? `[${f.effectCaps.join(', ')}]` : '';
    const clause = [f.effects.join(' and '), caps].filter(Boolean).join(' ');
    return clause ? `. It performs ${clause}` : '';
  }

  /** 位置参数（$0、$1…）按位置写出，具名参数写作 name: value */
  annotation(a: Annotation): string {
    const args = (a.args ?? []).map(arg => {
      const value = typeof arg.value === 'string' ? JSON.stringify(arg.value) : String(arg.value);
      return arg.name.startsWith('$') ? value : `${arg.name}: ${value}`;
    });
    return args.length > 0 ? `@${a.name}(${args.join(', ')})` : `@${a.name}`;
  }

  block(b: Block, lvl: number): string {
    return b.statements.map(s => indent(lvl) + this.stmt(s, lvl)).join('\n');
  }

  stmt(s: Statement, lvl: number): string {
    this.level = lvl;
    switch (s.kind) {
      case 'Let':
        // 块形 lambda 以函数体收尾，不再跟句点
        return `Let ${s.name} be ${this.expr(s.expr)}${this.endsWithBlock(s.expr) ? '' : '.'}`;
      case 'Set':
        return `Set ${s.name} to ${this.expr(s.expr)}.`;
      case 'Return':
        return `Return ${this.expr(s.expr)}.`;
      case 'Start':
        return `Start ${s.name} as async ${this.expr(s.expr)}.`;
      case 'Wait':
        return `Wait for ${s.names.join(' and ')}.`;
      case 'If':
        return this.ifStmt(s, lvl);
      case 'Match':
        return `Match ${this.expr(s.expr)}:\n${s.cases.map(c => this.matchCase(c, lvl + 1)).join('\n')}`;
      case 'Block':
        // 语句位置的块来自 `Within scope:`
        return `Within scope:\n${this.block(s, lvl + 1)}`;
      case 'workflow':
        return this.workflow(s, lvl);
      default:
        return `${this.expr(s)}.`;
    }
  }

  ifStmt(s: Statement & { kind: 'If' }, lvl: number): string {
    const head = `If ${this.expr(s.cond)}:\n${this.block(s.thenBlock, lvl + 1)}`;
    if (!s.elseBlock) return head;
    return `${head}\n${indent(lvl)}Otherwise:\n${this.block(s.elseBlock, lvl + 1)}`;
  }

  matchCase(c: Case, lvl: number): string {
    const head = `${indent(lvl)}When ${this.pattern(c.pattern)},`;
    if (c.body.kind === 'Return') return `${head} Return ${this.expr(c.body.expr)}.`;
    return `${head}\n${this.block(c.body, lvl + 1)}`;
  }

  workflow(w: WorkflowStmt, lvl: number): string {
    const parts = w.steps.map(st => this.step(st, lvl + 1));
    if (w.retry) {
      const r = `${indent(lvl + 1)}retry:\n${indent(lvl + 2)}max attempts: ${w.retry.maxAttempts}.`;
      parts.push(`${r}\n${indent(lvl + 2)}backoff: ${w.retry.backoff}.`);
    }
    if (w.timeout) parts.push(`${indent(lvl + 1)}timeout: ${w.timeout.milliseconds / 1000} seconds.`);
    // 工作流以独占一行、回到外层缩进的句点收尾
    return `workflow:\n${parts.join('\n')}\n${indent(lvl)}.`;
  }

  step(st: StepStmt, lvl: number): string {
    const deps = st.dependencies.length > 0
      ? ` depends on [${st.dependencies.map(d => JSON.stringify(d)).join(', ')}]`
      : '';
    const body = `${indent(lvl)}step ${st.name}${deps}:\n${this.block(st.body, lvl + 1)}`;
    if (!st.compensate) return body;
    return `${body}\n${indent(lvl)}compensate:\n${this.block(st.compensate, lvl + 1)}`;
  }

  pattern(p: Pattern): string {
    switch (p.kind) {
      case 'PatternNull':
        return 'null';
      case 'PatternInt':
        return String(p.value);
      case 'PatternName':
        return p.name;
      case 'PatternCtor': {
        if (p.args && p.args.length > 0) return `${p.typeName}(${p.args.map(a => this.pattern(a)).join(', ')})`;
        if (p.names && p.names.length > 0) return `${p.typeName}(${p.names.join(', ')})`;
        return p.typeName;
      }
      default:
        return String((p as { name?: unknown }).name);
    }
  }

  endsWithBlock(e: Expression): boolean {
    return e.kind === 'Lambda' && !isArrowLambda(e);
  }

  expr(e: Expression): string {
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
        return `${e.value}L`;
      case 'Double':
        return plainDouble(e.value);
      case 'Decimal':
        return `${e.value}m`;
      case 'String':
        return JSON.stringify(e.value);
      case 'None':
        return 'none';
      case 'Ok':
        return `ok of ${this.expr(e.expr)}`;
      case 'Err':
        return `err of ${this.expr(e.expr)}`;
      case 'Some':
        return `some of ${this.expr(e.expr)}`;
      case 'Await':
        return `await(${this.expr(e.expr)})`;
      case 'ListLit':
        return `[${e.elements.map(x => this.expr(x)).join(', ')}]`;
      case 'Construct':
        return `${e.typeName} with ${e.fields.map(f => this.constructField(f)).join(', ')}`;
      case 'Call':
        return this.call(e);
      case 'Lambda':
        return this.lambda(e);
      case 'IfExpr':
        // ADR 0019 G2b：表达式级 if；条件按 parseOr 读，不能再是 if
        return `if ${this.operand(e.cond, 1)} then ${this.expr(e.thenE)} else ${this.expr(e.elseE)}`;
    }
  }

  /** 字段值由 parseExpr 读到逗号为止；只有以嵌套构造收尾的值会吞掉后续字段，须加括号 */
  constructField(f: ConstructField): string {
    const text = this.expr(f.expr);
    return `${f.name} set to ${endsWithConstruct(f.expr) ? `(${text})` : text}`;
  }

  call(e: Expression & { kind: 'Call' }): string {
    const op = operatorOf(e);
    if (op !== undefined) return this.operatorCall(op, e.args);
    const target = e.target.kind === 'Name' ? e.target.name : `(${this.expr(e.target)})`;
    return `${target}(${e.args.map(a => this.expr(a)).join(', ')})`;
  }

  /** 运算符按中缀（not 按前缀）输出；比较不可链式，左右都须严格更高，其余左结合，右操作数须严格更高 */
  operatorCall(op: OperatorInfo, args: readonly Expression[]): string {
    if (op.arity === 1) return `${op.word} ${this.operand(args[0]!, op.prec)}`;
    const leftMin = op.prec === COMPARISON_PREC ? op.prec + 1 : op.prec;
    return `${this.operand(args[0]!, leftMin)} ${op.word} ${this.operand(args[1]!, op.prec + 1)}`;
  }

  operand(e: Expression, minPrec: number): string {
    const text = this.expr(e);
    return precedenceOf(e) < minPrec ? `(${text})` : text;
  }

  lambda(e: Expression & { kind: 'Lambda' }): string {
    if (isArrowLambda(e)) {
      const ret = e.body.statements[0] as Statement & { kind: 'Return' };
      const ps = e.params.map((p: Binding) => (p.typeInferred ? p.name : `${p.name} as ${this.type(p.type)}`));
      return `(${ps.join(', ')}) => ${this.expr(ret.expr)}`;
    }
    const lvl = this.level;
    const params = e.params.length > 0 ? ` with ${e.params.map(p => this.binding(p)).join(', ')}` : '';
    const unknown = e.retType.kind === 'TypeName' && e.retType.name === 'Unknown';
    const ret = unknown ? '' : ` ${this.type(e.retType)}`;
    const body = this.block(e.body, lvl + 1);
    this.level = lvl;
    return `function${params}, produce${ret}:\n${body}`;
  }

  type(t: Type): string {
    switch (t.kind) {
      case 'TypeName':
      case 'TypeVar':
        return t.name;
      case 'Maybe':
        return `${this.type(t.type)}?`;
      case 'Option':
        return `Option of ${this.type(t.type)}`;
      case 'Result':
        return `Result of ${this.type(t.ok)} or ${this.type(t.err)}`;
      case 'List':
        return `list of ${this.type(t.type)}`;
      case 'Map':
        return `map ${this.type(t.key)} to ${this.type(t.val)}`;
      case 'TypeApp':
        return `${t.base} of ${t.args.map(a => this.type(a)).join(' and ')}`;
      case 'TypePii':
        return `@pii(${t.sensitivity}, ${t.category}) ${this.type(t.baseType)}`;
      default:
        return t.kind === 'EffectVar' ? t.name : `(${t.params.map(p => this.type(p)).join(', ')}) -> ${this.type(t.ret)}`;
    }
  }
}
