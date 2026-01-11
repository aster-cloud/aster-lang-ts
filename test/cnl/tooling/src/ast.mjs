// Simple AST node constructors
export const Node = {
  Module(name, decls) { return { kind: 'Module', name, decls }; },
  Import(name, asName) { return { kind: 'Import', name, asName }; },
  Data(name, fields) { return { kind: 'Data', name, fields }; },
  Enum(name, variants) { return { kind: 'Enum', name, variants }; },
  Func(name, params, retType, effects, body) { return { kind: 'Func', name, params, retType, effects, body }; },
  Block(statements) { return { kind: 'Block', statements }; },
  Let(name, expr) { return { kind: 'Let', name, expr }; },
  Set(name, expr) { return { kind: 'Set', name, expr }; },
  Return(expr) { return { kind: 'Return', expr }; },
  If(cond, thenBlock, elseBlock) { return { kind: 'If', cond, thenBlock, elseBlock }; },
  Match(expr, cases) { return { kind: 'Match', expr, cases }; },
  Case(pattern, body) { return { kind: 'Case', pattern, body }; },
  Start(name, expr) { return { kind: 'Start', name, expr }; },
  Wait(names) { return { kind: 'Wait', names }; },

  // Expressions
  Name(name) { return { kind: 'Name', name }; },
  Bool(v) { return { kind: 'Bool', value: v }; },
  Null() { return { kind: 'Null' }; },
  Int(v) { return { kind: 'Int', value: v }; },
  String(v) { return { kind: 'String', value: v }; },
  Call(target, args) { return { kind: 'Call', target, args }; },
  Construct(typeName, fields) { return { kind: 'Construct', typeName, fields }; },
  Ok(expr) { return { kind: 'Ok', expr }; },
  Err(expr) { return { kind: 'Err', expr }; },
  Some(expr) { return { kind: 'Some', expr }; },
  None() { return { kind: 'None' }; },

  // Types
  TypeName(n) { return { kind: 'TypeName', name: n }; },
  Maybe(t) { return { kind: 'Maybe', type: t }; },
  Option(t) { return { kind: 'Option', type: t }; },
  Result(ok, err) { return { kind: 'Result', ok, err }; },
  List(t) { return { kind: 'List', type: t }; },
  Map(key, val) { return { kind: 'Map', key, val }; },

  PatternNull() { return { kind: 'PatternNull' }; },
  PatternCtor(typeName, names) { return { kind: 'PatternCtor', typeName, names }; },
  PatternName(name) { return { kind: 'PatternName', name }; },
};

