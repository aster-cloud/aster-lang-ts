import type { Core } from '../types.js';
import { DefaultCoreVisitor, createVisitorContext } from './visitor.js';

class PrettyCoreVisitor extends DefaultCoreVisitor {
  out: string[] = [];
  indentLevel = 0;

  private indent(n = this.indentLevel): string { return '  '.repeat(n); }

  formatModule(m: Core.Module): string {
    this.out = [];
    if (m.name) this.out.push(`// module ${m.name}`);
    this.visitModule(m, createVisitorContext());
    return this.out.join('\n');
  }

  override visitDeclaration(d: Core.Declaration, _ctx: import('./visitor.js').VisitorContext): void {
    switch (d.kind) {
      case 'Import':
        this.out.push(`use ${d.name}${d.asName ? ` as ${d.asName}` : ''}`);
        return;
      case 'Data': {
        const fields = d.fields.map(f => `${f.name}: ${this.formatType(f.type)}`).join(', ');
        this.out.push(`data ${d.name}(${fields})`);
        return;
      }
      case 'Enum':
        this.out.push(`enum ${d.name} { ${d.variants.join(', ')} }`);
        return;
      case 'Func':
        this.out.push(this.formatFunc(d));
        return;
    }
  }

  private formatFunc(f: Core.Func): string {
    const params = f.params.map(p => `${p.name}: ${this.formatType(p.type)}`).join(', ');
    const eff = f.effects && f.effects.length ? ` @${f.effects.map(e => String(e).toLowerCase()).join(',')}` : '';
    const body = this.formatBlock(f.body);
    return `func ${f.name}(${params}): ${this.formatType(f.ret)}${eff} = ${body}`;
  }

  private formatBlock(b: Core.Block): string {
    if (!b.statements.length) return '{}';
    this.indentLevel++;
    const lines = b.statements.map(s => this.indent() + this.formatStmt(s));
    this.indentLevel--;
    return `{\n${lines.join('\n')}\n${this.indent()}}`;
  }

  private formatStmt(s: Core.Statement): string {
    switch (s.kind) {
      case 'Let':
        return `val ${s.name} = ${this.formatExpr(s.expr)}`;
      case 'Set':
        return `${s.name} = ${this.formatExpr(s.expr)}`;
      case 'Return':
        return `return ${this.formatExpr(s.expr)}`;
      case 'If': {
        const thenB = this.formatBlock(s.thenBlock);
        const elseB = s.elseBlock ? ` else ${this.formatBlock(s.elseBlock)}` : '';
        return `if (${this.formatExpr(s.cond)}) ${thenB}${elseB}`;
      }
      case 'Match': {
        this.indentLevel++;
        const cases = s.cases.map(c => `${this.indent()}${this.formatPattern(c.pattern)} -> ${this.formatCaseBody(c.body)}`).join('\n');
        this.indentLevel--;
        return `match (${this.formatExpr(s.expr)}) {\n${cases}\n${this.indent()}}`;
      }
      case 'workflow':
        return this.formatWorkflow(s);
      case 'Scope': {
        const inner: Core.Block = { kind: 'Block', statements: s.statements };
        return `scope ${this.formatBlock(inner)}`;
      }
      case 'Start':
        return `val ${s.name} = async { ${this.formatExpr(s.expr)} }`;
      case 'Wait':
        return `awaitAll(${s.names.join(', ')})`;
    }
  }

  private formatWorkflow(w: Core.Workflow): string {
    if (!w.steps.length && !w.retry && !w.timeout) return 'workflow {}';
    this.indentLevel++;
    const lines: string[] = [];
    for (const step of w.steps) lines.push(this.formatWorkflowStep(step));
    if (w.retry) {
      lines.push(
        `${this.indent()}retry(maxAttempts=${w.retry.maxAttempts}, backoff=${w.retry.backoff})`
      );
    }
    if (w.timeout) {
      lines.push(`${this.indent()}timeout(${w.timeout.milliseconds}ms)`);
    }
    this.indentLevel--;
    return `workflow {\n${lines.join('\n')}\n${this.indent()}}`;
  }

  private formatWorkflowStep(step: Core.Step): string {
    const sections = [`${this.indent()}step ${step.name} ${this.formatBlock(step.body)}`];
    if (step.compensate) {
      sections.push(`${this.indent()}compensate ${this.formatBlock(step.compensate)}`);
    }
    return sections.join('\n');
  }

  private formatPattern(p: Core.Pattern): string {
    switch (p.kind) {
      case 'PatNull': return 'null';
      case 'PatInt': return String(p.value);
      case 'PatCtor': {
        const pat = p as Core.PatCtor & { args?: readonly Core.Pattern[] };
        if (pat.args && pat.args.length > 0) return `${pat.typeName}(${pat.args.map(pp => this.formatPattern(pp)).join(', ')})`;
        return `${pat.typeName}(${pat.names.join(', ')})`;
      }
      case 'PatName': return p.name;
      default: return '';
    }
  }

  private formatCaseBody(body: Core.Return | Core.Block): string {
    if (body.kind === 'Return') return this.formatExpr(body.expr);
    return this.formatBlock(body);
  }

  private formatExpr(e: Core.Expression): string {
    switch (e.kind) {
      case 'Name': return e.name;
      case 'Bool': return String(e.value);
      case 'Int': return String(e.value);
      case 'Long': return String(e.value) + 'L';
      case 'Double': return String(e.value);
      case 'String': return JSON.stringify(e.value);
      case 'Null': return 'null';
      case 'Call': {
        return `${this.formatExpr(e.target)}(${e.args.map(a => this.formatExpr(a)).join(', ')})`;
      }
      case 'Construct': {
        const fs = e.fields.map(f => `${f.name} = ${this.formatExpr(f.expr)}`).join(', ');
        return `${e.typeName}(${fs})`;
      }
      case 'Ok': return `Ok(${this.formatExpr(e.expr)})`;
      case 'Err': return `Err(${this.formatExpr(e.expr)})`;
      case 'Some': return `Some(${this.formatExpr(e.expr)})`;
      case 'None': return 'None';
      case 'Lambda': {
        const ps = e.params.map(p => `${p.name}: ${this.formatType(p.type)}`).join(', ');
        const body = this.formatBlock(e.body);
        return `(${ps}) => ${body}`;
      }
      case 'Await': {
        return `await(${this.formatExpr(e.expr)})`;
      }
      default: {
        const _exhaustiveCheck: never = e;
        return `<unknown expr: ${(_exhaustiveCheck as any).kind}>`;
      }
    }
  }

  private formatType(t: Core.Type): string {
    switch (t.kind) {
      case 'TypeName': return t.name;
      case 'TypeVar': return t.name;
      case 'EffectVar': return t.name;
      case 'TypeApp': return `${t.base}<${t.args.map(tt => this.formatType(tt)).join(', ')}>`;
      case 'Maybe': return `${this.formatType(t.type)}` + '?';
      case 'Option': return `Option<${this.formatType(t.type)}>`;
      case 'Result': return `Result<${this.formatType(t.ok)}, ${this.formatType(t.err)}>`;
      case 'List': return `List<${this.formatType(t.type)}>`;
      case 'Map': return `Map<${this.formatType(t.key)}, ${this.formatType(t.val)}>`;
      case 'FuncType': {
        const ps = t.params.map(tt => this.formatType(tt)).join(', ');
        return `(${ps}) -> ${this.formatType(t.ret)}`;
      }
      case 'PiiType': return `@pii(${t.sensitivity}, ${t.category}) ${this.formatType(t.baseType)}`;
      default:
        // 运行时后备：处理未知类型
        return `<unknown type: ${(t as any).kind}>`;
    }
  }
}

export function formatModule(m: Core.Module): string {
  return new PrettyCoreVisitor().formatModule(m);
}
