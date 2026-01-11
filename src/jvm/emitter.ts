import fs from 'node:fs';
import path from 'node:path';
import type {Core} from '../types.js';

const FINANCE_DTO_PACKAGE = 'com.wontlost.aster.finance.dto';
const FINANCE_DTO_MODULES = new Set(['aster.finance.loan']);
// Note: 代码生成包含具体副作用与输出顺序，此处暂不引入访问器改造，保持原有手写遍历以确保行为稳定。

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function pkgToPath(pkg: string | null): { pkgDecl: string; dir: string } {
  const pkgName = pkg ?? '';
  if (!pkgName) return { pkgDecl: '', dir: '' };
  return { pkgDecl: `package ${pkgName};\n\n`, dir: pkgName.replaceAll('.', path.sep) };
}

function javaType(t: Core.Type, helpers: EmitHelpers): string {
  switch (t.kind) {
    case 'TypeName': {
      const n = t.name;
      if (n === 'Text') return 'String';
      if (n === 'Text?') return 'String'; // Maybe Text

      if (n === 'Int') return 'int';
      if (n === 'Bool') return 'boolean';
      if (shouldUseFinanceDto(n, helpers)) {
        return `${helpers.financeDto!.dtoPackage}.${simpleTypeName(n)}`;
      }
      return n; // user types
    }
    case 'Result': {
      const ok = javaType(t.ok, helpers);
      const err = javaType(t.err, helpers);
      return `aster.runtime.Result<${ok}, ${err}>`;
    }
    case 'TypeVar':
      return 'Object';
    case 'TypeApp': {
      // Basic mapping for unknown generic types: treat as raw type 'Object'
      // Future: map known generic bridges
      return 'Object';
    }
    case 'Maybe': {
      // Represent Maybe<T> as nullable T
      return javaType(t.type, helpers);
    }
    case 'Option':
      return javaType(t.type, helpers);
    case 'List':
      return `java.util.List<${javaType(t.type, helpers)}>`;
    case 'Map':
      return `java.util.Map<${javaType(t.key, helpers)}, ${javaType(t.val, helpers)}>`;
    case 'FuncType': {
      const ar = t.params.length;
      if (ar === 1) return 'aster.runtime.Fn1';
      if (ar === 2) return 'aster.runtime.Fn2';
      return 'java.lang.Object';
    }
    default:
      return 'Object';
  }
}

function emitData(pkgDecl: string, d: Core.Data, helpers: EmitHelpers): string {
  const fields = d.fields.map(f => `  public final ${javaType(f.type, helpers)} ${f.name};`).join('\n');
  const ctorParams = d.fields.map(f => `${javaType(f.type, helpers)} ${f.name}`).join(', ');
  const ctorBody = d.fields.map(f => `    this.${f.name} = ${f.name};`).join('\n');
  return `${pkgDecl}public final class ${d.name} {\n${fields}\n  public ${d.name}(${ctorParams}) {\n${ctorBody}\n  }\n}\n`;
}

function emitEnum(pkgDecl: string, e: Core.Enum): string {
  const variants = e.variants.join(', ');
  return `${pkgDecl}public enum ${e.name} { ${variants} }\n`;
}

const SIMPLE_INFIX_OPERATORS: Record<string, string> = {
  '+': '+',
  '-': '-',
  '*': '*',
  '/': '/',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
};

const COMPARISON_OPERATORS = new Set(['<', '<=', '>', '>=']);

function emitExpr(e: Core.Expression, helpers: EmitHelpers): string {
  switch (e.kind) {
    case 'Name': {
      const en = helpers.enumVariantToEnum.get(e.name);
      if (en) return `${en}.${e.name}`;
      if (e.name === 'UUID.randomUUID') return 'java.util.UUID.randomUUID().toString()';
      return e.name;
    }
    case 'Bool':
      return e.value ? 'true' : 'false';
    case 'Int':
      return String(e.value);
    case 'Double':
      return String(e.value);
    case 'String':
      return JSON.stringify(e.value);
    case 'Null':
      return 'null';
    case 'Ok':
      return `new aster.runtime.Ok<>(${emitExpr(e.expr, helpers)})`;
    case 'Err':
      return `new aster.runtime.Err<>(${emitExpr(e.expr, helpers)})`;
    case 'Some':
      return emitExpr(e.expr, helpers);
    case 'None':
      return 'null';
    case 'Construct': {
      const args = e.fields.map(f => emitExpr(f.expr, helpers)).join(', ');
      const typeRef = qualifyTypeReference(e.typeName, helpers);
      return `new ${typeRef}(${args})`;
    }
    case 'Call': {
      if (e.target.kind === 'Name' && e.target.name === 'not' && e.args.length === 1) {
        return `!(${emitExpr(e.args[0]!, helpers)})`;
      }
      if (e.target.kind === 'Name') {
        const nm = e.target.name;
        const infix = emitInfixCall(nm, e.args, helpers);
        if (infix) return infix;
        if (nm === 'Text.concat' && e.args.length === 2) {
          const a = emitExpr(e.args[0]!, helpers);
          const b = emitExpr(e.args[1]!, helpers);
          return `(${a} + ${b})`;
        }
        if (nm === 'Text.contains' && e.args.length === 2) {
          const h = emitExpr(e.args[0]!, helpers);
          const n = emitExpr(e.args[1]!, helpers);
          return `${h}.contains(${n})`;
        }
        if (nm === 'Text.equals' && e.args.length === 2) {
          const a = emitExpr(e.args[0]!, helpers);
          const b = emitExpr(e.args[1]!, helpers);
          return `java.util.Objects.equals(${a}, ${b})`;
        }
        if (nm === 'Text.replace' && e.args.length === 3) {
          const h = emitExpr(e.args[0]!, helpers);
          const t = emitExpr(e.args[1]!, helpers);
          const r = emitExpr(e.args[2]!, helpers);
          return `${h}.replace(${t}, ${r})`;
        }
        if (nm === 'Text.split' && e.args.length === 2) {
          const h = emitExpr(e.args[0]!, helpers);
          const s = emitExpr(e.args[1]!, helpers);
          return `java.util.Arrays.asList(${h}.split(${s}))`;
        }
        if (nm === 'Text.indexOf' && e.args.length === 2) {
          const h = emitExpr(e.args[0]!, helpers);
          const n = emitExpr(e.args[1]!, helpers);
          return `${h}.indexOf(${n})`;
        }
        if (nm === 'Text.startsWith' && e.args.length === 2) {
          const h = emitExpr(e.args[0]!, helpers);
          const p = emitExpr(e.args[1]!, helpers);
          return `${h}.startsWith(${p})`;
        }
        if (nm === 'Text.endsWith' && e.args.length === 2) {
          const h = emitExpr(e.args[0]!, helpers);
          const s = emitExpr(e.args[1]!, helpers);
          return `${h}.endsWith(${s})`;
        }
        if (nm === 'Text.toUpper' && e.args.length === 1) {
          const h = emitExpr(e.args[0]!, helpers);
          return `${h}.toUpperCase()`;
        }
        if (nm === 'Text.toLower' && e.args.length === 1) {
          const h = emitExpr(e.args[0]!, helpers);
          return `${h}.toLowerCase()`;
        }
        if (nm === 'Text.length' && e.args.length === 1) {
          const h = emitExpr(e.args[0]!, helpers);
          return `${h}.length()`;
        }
        if (nm === 'List.length' && e.args.length === 1) {
          const xs = emitExpr(e.args[0]!, helpers);
          return `${xs}.size()`;
        }
        if (nm === 'List.get' && e.args.length === 2) {
          const xs = emitExpr(e.args[0]!, helpers);
          const i = emitExpr(e.args[1]!, helpers);
          return `${xs}.get(${i})`;
        }
        if (nm === 'List.isEmpty' && e.args.length === 1) {
          const xs = emitExpr(e.args[0]!, helpers);
          return `${xs}.isEmpty()`;
        }
        if (nm === 'List.head' && e.args.length === 1) {
          const xs = emitExpr(e.args[0]!, helpers);
          return `(${xs}.isEmpty() ? null : ${xs}.get(0))`;
        }
        if (nm === 'Map.get' && e.args.length === 2) {
          const m = emitExpr(e.args[0]!, helpers);
          const k = emitExpr(e.args[1]!, helpers);
          return `${m}.get(${k})`;
        }
      }
      const tgt = emitExpr(e.target, helpers);
      const args = e.args.map(a => emitExpr(a, helpers)).join(', ');
      return `${tgt}(${args})`;
    }
    default:
      return 'null';
  }
}

function emitInfixCall(
  opName: string,
  args: readonly Core.Expression[],
  helpers: EmitHelpers
): string | null {
  if (opName === '=' || opName === '!=') {
    if (args.length !== 2) return null;
    const left = emitExpr(args[0]!, helpers);
    const right = emitExpr(args[1]!, helpers);
    const equality = `java.util.Objects.equals(${left}, ${right})`;
    return opName === '=' ? equality : `!${equality}`;
  }
  const op = SIMPLE_INFIX_OPERATORS[opName];
  if (!op) return null;
  if (COMPARISON_OPERATORS.has(opName)) {
    if (args.length !== 2) return null;
    const left = emitExpr(args[0]!, helpers);
    const right = emitExpr(args[1]!, helpers);
    return `(${left} ${op} ${right})`;
  }
  if (args.length === 0) {
    if (opName === '+') return '0';
    if (opName === '*') return '1';
    return '0';
  }
  if (args.length === 1) {
    const single = emitExpr(args[0]!, helpers);
    if (opName === '-') {
      return `(-(${single}))`;
    }
    return single;
  }
  let acc = emitExpr(args[0]!, helpers);
  for (let i = 1; i < args.length; i++) {
    const next = emitExpr(args[i]!, helpers);
    acc = `(${acc} ${op} ${next})`;
  }
  return acc;
}

interface EmitHelpers {
  dataSchema: Map<string, Core.Data>;
  enumVariantToEnum: Map<string, string>;
  workflowCounter: number;
  financeDto?: FinanceDtoConfig;
}

interface FinanceDtoConfig {
  readonly dtoPackage: string;
  readonly dtoTypes: Set<string>;
}

function shouldUseFinanceDto(typeName: string, helpers: EmitHelpers): boolean {
  if (!helpers.financeDto) return false;
  return helpers.financeDto.dtoTypes.has(simpleTypeName(typeName));
}

function qualifyTypeReference(typeName: string, helpers: EmitHelpers): string {
  if (!helpers.financeDto) return typeName;
  if (helpers.financeDto.dtoTypes.has(simpleTypeName(typeName))) {
    return `${helpers.financeDto.dtoPackage}.${simpleTypeName(typeName)}`;
  }
  return typeName;
}

function simpleTypeName(typeName: string): string {
  const idx = typeName.lastIndexOf('.');
  return idx >= 0 ? typeName.slice(idx + 1) : typeName;
}

// 保持原始代码生成逻辑：不使用访问器以免影响输出行为
function emitStatement(
  s: Core.Statement,
  locals: string[],
  helpers: EmitHelpers,
  indent = '    '
): string {
  switch (s.kind) {
    case 'Let':
      return `${indent}${javaLocalDecl(s.name)} = ${emitExpr(s.expr, helpers)};\n`;
    case 'Set':
      return `${indent}${s.name} = ${emitExpr(s.expr, helpers)};\n`;
    case 'Return':
      return `${indent}return ${emitExpr(s.expr, helpers)};\n`;
    case 'If': {
      const cond = emitExpr(s.cond, helpers);
      const thenB = emitBlock(s.thenBlock, locals, helpers, indent + '  ');
      const elseB = s.elseBlock
        ? ` else {\n${emitBlock(s.elseBlock, locals, helpers, indent + '  ')}${indent}}\n`
        : '\n';
      return `${indent}if (${cond}) {\n${thenB}${indent}}${elseB}`;
    }
    case 'Match': {
      // 尝试优化为 enum switch 或 int switch（只读分析）
      const enName = analyzeMatchForEnumSwitch(s, helpers);
      const allPatInt = analyzeMatchForIntSwitch(s);
      if (enName) {
          const scrut = emitExpr(s.expr, helpers);
          const lines: string[] = [];
          lines.push(`${indent}{`);
          lines.push(`${indent}  var __scrut = ${scrut};`);
          lines.push(`${indent}  switch((${enName})__scrut) {`);
          for (const c of s.cases) {
            const variant = (c.pattern as Core.PatName).name;
            lines.push(`${indent}    case ${enName}.${variant}: {`);
            const bodyStr = emitCaseBody(c.body, locals, helpers, indent + '      ');
            lines.push(bodyStr);
            if (c.body.kind !== 'Return') lines.push(`${indent}      break;`);
            lines.push(`${indent}    }`);
          }
          lines.push(`${indent}  }`);
          lines.push(`${indent}}\n`);
          return lines.join('\n');
      }
      // Integers: emit a simple switch (string-emitter only)
      if (allPatInt && s.cases.length > 0) {
        const scrut = emitExpr(s.expr, helpers);
        const lines: string[] = [];
        lines.push(`${indent}{`);
        lines.push(`${indent}  switch (${scrut}) {`);
        for (const c of s.cases) {
          const v = (c.pattern as any).value as number;
          lines.push(`${indent}    case ${v}: {`);
          const bodyStr = emitCaseBody(c.body, locals, helpers, indent + '      ');
          lines.push(bodyStr);
          if (c.body.kind !== 'Return') lines.push(`${indent}      break;`);
          lines.push(`${indent}    }`);
        }
        lines.push(`${indent}    default: break;`);
        lines.push(`${indent}  }`);
        lines.push(`${indent}}\n`);
        return lines.join('\n');
      }
      // Fallback: handle nullable, data ctor name pattern, and basic PatName
      const scrut = emitExpr(s.expr, helpers);
      const lines: string[] = [];
      lines.push(`${indent}{`);
      lines.push(`${indent}  var __scrut = ${scrut};`);
      for (const c of s.cases) {
        if (c.pattern.kind === 'PatNull') {
          lines.push(`${indent}  if (__scrut == null) {`);
          lines.push(emitCaseBody(c.body, locals, helpers, indent + '    '));
          lines.push(`${indent}  }`);
        } else if (c.pattern.kind === 'PatCtor') {
          const p = c.pattern as Core.PatCtor;
          const ctorRef = qualifyTypeReference(p.typeName, helpers);
          lines.push(`${indent}  if (__scrut instanceof ${ctorRef}) {`);
          lines.push(`${indent}    var __tmp = (${ctorRef})__scrut;`);
          const nb = emitNestedPatBinds(p, '__tmp', helpers, indent + '    ');
          lines.push(...nb.prefix);
          lines.push(emitCaseBody(c.body, locals, helpers, indent + '    '));
          lines.push(...nb.suffix);
          lines.push(`${indent}  }`);
        } else if (c.pattern.kind === 'PatName') {
          lines.push(`${indent}  if (__scrut != null) {`);
          lines.push(emitCaseBody(c.body, locals, helpers, indent + '    '));
          lines.push(`${indent}  }`);
        }
      }
      lines.push(`${indent}}\n`);
      return lines.join('\n');
    }
    case 'Scope': {
        return s.statements.map(st => emitStatement(st, locals, helpers, indent)).join('');
    }
    case 'workflow': {
      return emitWorkflowStatement(s, locals, helpers, indent);
    }
    case 'Start':
    case 'Wait':
      // Async not handled in MVP
      return `${indent}// async not implemented in MVP\n`;
    }
  }

function emitCaseBody(
  b: Core.Return | Core.Block,
  locals: string[],
  helpers: EmitHelpers,
  indent: string
): string {
  if (b.kind === 'Return') return `${indent}return ${emitExpr(b.expr, helpers)};\n`;
  return emitBlock(b, locals, helpers, indent);
}
 

function emitBlock(b: Core.Block, locals: string[], helpers: EmitHelpers, indent = '    '): string {
  return b.statements.map(s => emitStatement(s, locals, helpers, indent)).join('');
}

function emitRetryLoop(
  workflow: Core.Workflow,
  workflowBody: string,
  schedulerVar: string,
  workflowIdExpr: string,
  indent: string
): string {
  const retry = workflow.retry!;
  const lines: string[] = [];
  const baseDelayMs = 1000;

  lines.push(`${indent}// 重试循环：maxAttempts=${retry.maxAttempts}, backoff=${retry.backoff}`);
  lines.push(`${indent}for (int __retryAttempt = 1; __retryAttempt <= ${retry.maxAttempts}; __retryAttempt++) {`);
  lines.push(`${indent}  try {`);
  workflowBody.split('\n').forEach(line => {
    if (line.trim()) {
      lines.push(`${indent}    ${line}`);
    } else {
      lines.push(`${indent}    `);
    }
  });
  lines.push(`${indent}    break; // 成功退出重试循环`);
  lines.push(`${indent}  } catch (Exception __retryException) {`);
  lines.push(`${indent}    if (__retryAttempt == ${retry.maxAttempts}) {`);
  lines.push(
    `${indent}      throw new aster.core.exceptions.MaxRetriesExceededException(${retry.maxAttempts}, __retryException.getMessage(), __retryException);`
  );
  lines.push(`${indent}    }`);
  lines.push(`${indent}    long __backoffBase;`);
  if (retry.backoff === 'exponential') {
    lines.push(`${indent}    __backoffBase = ${baseDelayMs}L * (long)Math.pow(2, __retryAttempt - 1);`);
  } else {
    lines.push(`${indent}    __backoffBase = ${baseDelayMs}L * __retryAttempt;`);
  }
  lines.push(`${indent}    long __jitter = (long)(Math.random() * (${baseDelayMs} / 2)); // TODO: 使用 DeterminismContext.random()`);
  lines.push(`${indent}    long __backoffMs = __backoffBase + __jitter;`);
  lines.push(`${indent}    String __workflowId = ${workflowIdExpr}; // TODO: 从 runtime 获取 workflowId`);
  lines.push(
    `${indent}    ${schedulerVar}.scheduleRetry(__workflowId, __backoffMs, __retryAttempt + 1, __retryException.getMessage());`
  );
  lines.push(`${indent}    return; // 等待 timer 触发重试`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}}`);

  return lines.join('\n');
}

function emitWorkflowStatement(
  workflow: Core.Workflow,
  locals: string[],
  helpers: EmitHelpers,
  indent: string
): string {
  const wfId = helpers.workflowCounter++;
  const base = `__workflow${wfId}`;
  const lines: string[] = [];
  lines.push(`${indent}{`);
  lines.push(
    `${indent}  var ${base}Registry = new aster.truffle.runtime.AsyncTaskRegistry();`
  );
  lines.push(
    `${indent}  var ${base}Scheduler = new aster.truffle.runtime.WorkflowScheduler(${base}Registry);`
  );
  const workflowBodyLines: string[] = [];
  workflow.steps.forEach((step, index) => {
    const supplierVar = `${base}Step${index}`;
    const compensateVar = step.compensate ? `${base}Compensate${index}` : null;
    // 根据 DSL 声明为当前任务构造依赖集合
    const dependencies = step.dependencies ?? [];
    const depsLiteral = workflowDependencyLiteral(dependencies);
    workflowBodyLines.push(`java.util.function.Supplier<Object> ${supplierVar} = () -> {`);
    workflowBodyLines.push(emitBlock(step.body, locals, helpers, `    `).trimEnd());
    workflowBodyLines.push(`};`);
    if (compensateVar && step.compensate) {
      workflowBodyLines.push(`java.util.function.Supplier<Object> ${compensateVar} = () -> {`);
      workflowBodyLines.push(emitBlock(step.compensate, locals, helpers, `    `).trimEnd());
      workflowBodyLines.push(`};`);
    }
    workflowBodyLines.push(`${base}Registry.registerTaskWithDependencies("${step.name}", () -> {`);
    workflowBodyLines.push(`  try {`);
    workflowBodyLines.push(`    Object result = ${supplierVar}.get();`);
    workflowBodyLines.push(`    ${base}Registry.setResult("${step.name}", result);`);
    workflowBodyLines.push(`  } catch (RuntimeException ex) {`);
    if (compensateVar) {
      workflowBodyLines.push(`    ${compensateVar}.get();`);
    }
    workflowBodyLines.push(`    throw ex;`);
    workflowBodyLines.push(`  } catch (Throwable t) {`);
    if (compensateVar) {
      workflowBodyLines.push(`    ${compensateVar}.get();`);
    }
    workflowBodyLines.push(
      `    throw new RuntimeException("workflow step failed: ${step.name}", t);`
    );
    workflowBodyLines.push(`  }`);
    workflowBodyLines.push(`  return null;`);
    workflowBodyLines.push(`}, ${depsLiteral});`);
  });
  workflowBodyLines.push(`${base}Scheduler.executeUntilComplete();`);
  const workflowBody = workflowBodyLines.join('\n');
  if (workflow.retry) {
    lines.push(
      emitRetryLoop(workflow, workflowBody, `${base}Scheduler`, `"TODO_GET_WORKFLOW_ID"`, `${indent}  `)
    );
  } else {
    lines.push(`${indent}  ${workflowBody.split('\n').join(`\n${indent}  `)}`);
  }
  lines.push(`${indent}}\n`);
  return lines.join('\n');
}

function workflowDependencyLiteral(stepNames: readonly string[]): string {
  if (stepNames.length === 0) return 'java.util.Collections.emptySet()';
  const items = stepNames.map(name => JSON.stringify(name)).join(', ');
  return `new java.util.LinkedHashSet<>(java.util.Arrays.asList(${items}))`;
}

function javaLocalDecl(name: string): string {
  return `var ${name}`;
}

function fieldByIndexName(index: number): string {
  // Fallback field name f0,f1,... for MVP; will refine with schema later
  return `f${index}`;
}

function fieldNameByIndex(typeName: string, helpers: EmitHelpers, idx: number): string {
  const d = helpers.dataSchema.get(simpleTypeName(typeName));
  if (!d) return fieldByIndexName(idx);
  if (idx < 0 || idx >= d.fields.length) return fieldByIndexName(idx);
  return d.fields[idx]!.name;
}

// 只读分析：是否可用 enum switch 优化（全部 PatName 且来自同一个 Enum）
function analyzeMatchForEnumSwitch(s: Core.Match, helpers: EmitHelpers): string | null {
  if (s.cases.length === 0) return null;
  if (!s.cases.every(c => c.pattern.kind === 'PatName')) return null;
  const enums = new Set<string>();
  for (const c of s.cases) {
    const variant = (c.pattern as Core.PatName).name;
    const en = helpers.enumVariantToEnum.get(variant);
    if (!en) return null;
    enums.add(en);
  }
  return enums.size === 1 ? [...enums][0]! : null;
}

// 只读分析：是否全部是整数模式
function analyzeMatchForIntSwitch(s: Core.Match): boolean {
  return s.cases.length > 0 && s.cases.every(c => c.pattern.kind === 'PatInt');
}

function emitNestedPatBinds(
  p: Core.PatCtor,
  baseVar: string,
  helpers: EmitHelpers,
  indent = '    '
): { prefix: string[]; suffix: string[] } {
  const prefix: string[] = [];
  const suffix: string[] = [];
  const patWithArgs = p as Core.PatCtor & { args?: readonly Core.Pattern[] };
  const args = patWithArgs.args as undefined | Core.Pattern[];
  if (args && args.length > 0) {
    args.forEach((child, idx) => {
      const field = fieldNameByIndex(p.typeName, helpers, idx);
      if (child.kind === 'PatName') {
        prefix.push(`${indent}var ${child.name} = ${baseVar}.${field};`);
      } else if (child.kind === 'PatCtor') {
        // open guard and bind child object
        const tmpVar = `${baseVar}_${idx}`;
        const nestedRef = qualifyTypeReference((child as Core.PatCtor).typeName, helpers);
        prefix.push(
          `${indent}if (${baseVar}.${field} instanceof ${nestedRef}) {`
        );
        prefix.push(
          `${indent}  var ${tmpVar} = ( ${nestedRef} )${baseVar}.${field};`
        );
        const rec = emitNestedPatBinds(child as Core.PatCtor, tmpVar, helpers, indent + '  ');
        prefix.push(...rec.prefix);
        // close nested guards after body
        suffix.unshift(...rec.suffix);
        suffix.unshift(`${indent}}`);
      }
    });
  } else {
    // Legacy names support
    (p.names || []).forEach((n, idx) => {
      prefix.push(`${indent}var ${n} = ${baseVar}.${fieldNameByIndex(p.typeName, helpers, idx)};`);
    });
  }
  return { prefix, suffix };
}

function emitFunc(pkgDecl: string, f: Core.Func, helpers: EmitHelpers): string {
  const ret = javaType(f.ret, helpers);
  const params = f.params.map(p => `${javaType(p.type, helpers)} ${p.name}`).join(', ');
  const body = emitBlock(f.body, [], helpers, '    ');
  const fallback = `    return ${ret === 'int' ? '0' : ret === 'boolean' ? 'false' : 'null'};\n`;

  // Add capability imports for workflow functions
  const capabilityImports = `import aster.capabilities.Payment;\nimport aster.capabilities.Inventory;\nimport aster.capabilities.List;\n\n`;

  return `${pkgDecl}${capabilityImports}public final class ${f.name}_fn {\n  private ${f.name}_fn(){}\n  public static ${ret} ${f.name}(${params}) {\n${body}${fallback}  }\n}\n`;
}

export async function emitJava(core: Core.Module, outRoot = 'build/jvm-src'): Promise<void> {
  const { pkgDecl, dir } = pkgToPath(core.name);
  const baseDir = path.join(outRoot, dir);
  ensureDir(baseDir);

  // Collect data decls for field mapping
  const dataSchema = new Map<string, Core.Data>();
  for (const d of core.decls) {
    if (d.kind === 'Data') dataSchema.set(d.name, d);
  }
  const financeDto = buildFinanceDtoConfig(core);
  const helpers: EmitHelpers = {
    dataSchema,
    enumVariantToEnum: collectEnums(core),
    workflowCounter: 0,
    ...(financeDto ? { financeDto } : {}),
  };

  for (const d of core.decls) {
    if (d.kind === 'Data') {
      if (helpers.financeDto?.dtoTypes.has(d.name)) continue;
      const content = emitData(pkgDecl, d, helpers);
      fs.writeFileSync(path.join(baseDir, `${d.name}.java`), content, 'utf8');
    } else if (d.kind === 'Enum') {
      const content = emitEnum(pkgDecl, d);
      fs.writeFileSync(path.join(baseDir, `${d.name}.java`), content, 'utf8');
    } else if (d.kind === 'Func') {
      const content = emitFunc(pkgDecl, d, helpers);
      fs.writeFileSync(path.join(baseDir, `${d.name}_fn.java`), content, 'utf8');
    }
  }
}

function collectEnums(core: Core.Module): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of core.decls) {
    if (d.kind === 'Enum') {
      for (const v of d.variants) map.set(v, d.name);
    }
  }
  return map;
}

function buildFinanceDtoConfig(core: Core.Module): FinanceDtoConfig | undefined {
  if (!core.name || !FINANCE_DTO_MODULES.has(core.name)) return undefined;
  const dtoTypes = new Set<string>();
  for (const decl of core.decls) {
    if (decl.kind === 'Data') {
      dtoTypes.add(decl.name);
    }
  }
  return {
    dtoPackage: FINANCE_DTO_PACKAGE,
    dtoTypes,
  };
}
