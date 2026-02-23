{
  // Helper to trim and normalize
  function j(x) { return x.join(''); }
  function flat(xs) { return xs ? xs.flat() : []; }
  function text(t) { return { kind: 'TypeName', name: t }; }
}

Start
  = _ h:(Module / Import / Data / Enum / FuncHeader) _ { return h; }

Module
  = "Module"i _ n:DottedIdent _ "." { return { kind: 'Module', name: n }; }

Import
  = "use"i _ n:DottedIdent _ a:("as"i _ a:Ident { return a; })? _ "." { return { kind: 'Import', name: n, asName: a ?? null }; }

Data
  = "define"i _ t:TypeIdent _ "has"i _ fs:FieldList _ "." { return { kind: 'Data', name: t, fields: fs }; }

Enum
  = "define"i _ t:TypeIdent _ "as"i _ "one"i _ "of"i _ vs:VariantList _ "." { return { kind: 'Enum', name: t, variants: vs }; }

// Rule funcName given params, produce Type:
FuncHeader
  = "Rule"i _ n:Ident _ p:GivenParamPart? _ "," _ "produce"i _ r:Type _
    eff:EffectPart? _ end:HeaderEnd
    { return { kind: 'FuncHeader', name: n, params: p ?? [], retType: r, effects: eff ?? [], bodyFollows: end === ':' }; }

GivenParamPart
  = _ "given"i _ ps:ParamList { return ps; }

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

ParamList
  = a:Param (_ "and"i _ b:Param { return b; })* { return [a].concat(b ?? []); }

Param
  = n:Ident _ "as"i _ t:Type { return { name: n, type: t }; }

FieldList
  = a:Field (_ "and"i _ b:Field { return b; })* { return [a].concat(b ?? []); }

Field
  = n:Ident _ "as"i _ t:Type { return { name: n, type: t }; }

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

// Unicode-aware 标识符：支持 CJK (U+4E00-U+9FFF) 和 Latin Extended (U+00C0-U+024F)
TypeIdent
  = $([A-Z\u00C0-\u00D6\u00D8-\u00DE\u0100-\u024F\u4E00-\u9FFF\u3400-\u4DBF] [A-Za-z0-9_\u00C0-\u024F\u4E00-\u9FFF\u3400-\u4DBF]* )

Ident
  = $([a-z\u00DF-\u00F6\u00F8-\u00FF\u0100-\u024F\u4E00-\u9FFF\u3400-\u4DBF] [A-Za-z0-9_\u00C0-\u024F\u4E00-\u9FFF\u3400-\u4DBF]* )

_ = [ \t]*
