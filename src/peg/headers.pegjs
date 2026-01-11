{
  // Helper to trim and normalize
  function j(x) { return x.join(''); }
  function flat(xs) { return xs ? xs.flat() : []; }
  function text(t) { return { kind: 'TypeName', name: t }; }
}

Start
  = _ h:(Module / Import / Data / Enum / FuncHeader) _ { return h; }

Module
  = "this module is"i _ n:DottedIdent _ "." { return { kind: 'Module', name: n }; }

Import
  = "use"i _ n:DottedIdent _ ("as"i _ a:Ident { return a; })? _ "." { return { kind: 'Import', name: n, asName: a ?? null }; }

Data
  = "define"i _ t:TypeIdent _ "with"i _ fs:FieldList _ "." { return { kind: 'Data', name: t, fields: fs }; }

Enum
  = "define"i _ t:TypeIdent _ "as"i _ "one"i _ "of"i _ vs:VariantList _ "." { return { kind: 'Enum', name: t, variants: vs }; }

FuncHeader
  = "to"i _ n:Ident _ p:ParamPart? _ "," _ "produce"i _ r:Type _
    eff:EffectPart? _ end:HeaderEnd
    { return { kind: 'FuncHeader', name: n, params: p ?? [], retType: r, effects: eff ?? [], bodyFollows: end === ':' }; }

HeaderEnd
  = ":" { return ':'; }
  / "." { return '.'; }

EffectPart
  = _ ("it"i _)? "performs"i _ es:EffectList _ (":" / ".") { return es; }

EffectList
  = e:Effect (_ "," _ Effect)* { return [e]; }
  / e:Effect (_ Effect)* { return [e]; }

Effect
  = "io"i { return 'io'; }
  / "cpu"i { return 'cpu'; }

ParamPart
  = _ "with"i _ ps:ParamList { return ps; }
  / _ ps:ParamList { return ps; }

ParamList
  = a:Param (_ "and"i _ b:Param { return b; })* { return [a].concat(b ?? []); }

Param
  = n:Ident _ ":" _ t:Type { return { name: n, type: t }; }

FieldList
  = a:Field (_ "and"i _ b:Field { return b; })* { return [a].concat(b ?? []); }

Field
  = n:Ident _ ":" _ t:Type { return { name: n, type: t }; }

VariantList
  = a:TypeIdent (_ ("," / "or"i) _ b:TypeIdent { return b; })* { return [a].concat(b ?? []); }

Type
  = "maybe"i _ t:Type { return { kind: 'Maybe', type: t }; }
  / "option"i _ "of"i _ t:Type { return { kind: 'Option', type: t }; }
  / "result"i _ "of"i _ ok:Type _ "or"i _ err:Type { return { kind: 'Result', ok: ok, err: err }; }
  / "list"i _ "of"i _ t:Type { return { kind: 'List', type: t }; }
  / "map"i _ k:Type _ "to"i _ v:Type { return { kind: 'Map', key: k, val: v }; }
  / t:PrimType { return t; }
  / t:TypeIdent { return text(t); }

PrimType
  = "text"i { return text('Text'); }
  / "int"i { return text('Int'); }
  / "float"i { return text('Float'); }
  / "bool"i { return text('Bool'); }

DottedIdent
  = a:Ident ("." b:Ident { return b; })* { return [a].concat(b ?? []).join('.'); }

TypeIdent
  = $([A-Z] [A-Za-z0-9_]* )

Ident
  = $([a-z] [A-Za-z0-9_]* )

_ = [ \t]*
