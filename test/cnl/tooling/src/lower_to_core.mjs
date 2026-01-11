import { Core, Effect } from './core_ir.mjs';

export function lowerModule(ast) {
  const decls = ast.decls.map(lowerDecl);
  return Core.Module(ast.name, decls);
}

function lowerDecl(d) {
  switch (d.kind) {
    case 'Import': return Core.Import(d.name, d.asName || null);
    case 'Data': return Core.Data(d.name, d.fields.map(f => ({ name: f.name, type: lowerType(f.type) })));
    case 'Enum': return Core.Enum(d.name, d.variants.slice());
    case 'Func': return lowerFunc(d);
    default: throw new Error(`Unknown decl kind: ${d.kind}`);
  }
}

function lowerFunc(f) {
  const params = f.params.map(p => ({ name: p.name, type: lowerType(p.type) }));
  const ret = lowerType(f.retType);
  const effects = (f.effects || []).map(e => e === 'io' ? Effect.IO : Effect.CPU);
  const body = f.body ? lowerBlock(f.body) : Core.Block([]);
  const effectCaps = Array.isArray(f.effectCaps) ? [...f.effectCaps] : [];
  const effectCapsExplicit = Boolean(f.effectCapsExplicit);
  return Core.Func(f.name, params, ret, effects, body, effectCaps, effectCapsExplicit);
}

function lowerBlock(b) {
  return Core.Block(b.statements.map(lowerStmt));
}

function lowerStmt(s) {
  switch (s.kind) {
    case 'Let': return Core.Let(s.name, lowerExpr(s.expr));
    case 'Set': return Core.Set(s.name, lowerExpr(s.expr));
    case 'Return': return Core.Return(lowerExpr(s.expr));
    case 'If': return Core.If(lowerExpr(s.cond), lowerBlock(s.thenBlock), s.elseBlock ? lowerBlock(s.elseBlock) : null);
    case 'Match': return Core.Match(lowerExpr(s.expr), s.cases.map(c => Core.Case(lowerPattern(c.pattern), lowerCaseBody(c.body))));
    default:
      // For bare expressions evaluated for side-effects in v0: wrap as Return(expr) for now
      return Core.Return(lowerExpr(s));
  }
}

function lowerCaseBody(body) {
  // Body can be a Return node or a Block
  if (body.kind === 'Return') return Core.Return(lowerExpr(body.expr));
  return lowerBlock(body);
}

function lowerExpr(e) {
  switch (e.kind) {
    case 'Name': return Core.Name(e.name);
    case 'Bool': return Core.Bool(e.value);
    case 'Int': return Core.Int(e.value);
    case 'String': return Core.String(e.value);
    case 'Null': return Core.Null();
    case 'Call': return Core.Call(lowerExpr(e.target), e.args.map(lowerExpr));
    case 'Construct': return Core.Construct(e.typeName, e.fields.map(f => ({ name: f.name, expr: lowerExpr(f.expr) })));
    case 'Ok': return Core.Ok(lowerExpr(e.expr));
    case 'Err': return Core.Err(lowerExpr(e.expr));
    case 'Some': return Core.Some(lowerExpr(e.expr));
    case 'None': return Core.None();
    default:
      throw new Error(`Unknown expr kind: ${e.kind}`);
  }
}

function lowerPattern(p) {
  switch (p.kind) {
    case 'PatternNull': return Core.PatNull();
    case 'PatternCtor': return Core.PatCtor(p.typeName, p.names.slice());
    case 'PatternName': return Core.PatName(p.name);
    default: throw new Error(`Unknown pattern kind: ${p.kind}`);
  }
}

function lowerType(t) {
  switch (t.kind) {
    case 'TypeName': return Core.TypeName(t.name);
    case 'Maybe': return Core.Maybe(lowerType(t.type));
    case 'Option': return Core.Option(lowerType(t.type));
    case 'Result': return Core.Result(lowerType(t.ok), lowerType(t.err));
    case 'List': return Core.List(lowerType(t.type));
    case 'Map': return Core.Map(lowerType(t.key), lowerType(t.val));
    default: throw new Error(`Unknown type kind: ${t.kind}`);
  }
}
