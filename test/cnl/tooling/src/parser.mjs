import { TokenKind, KW, Effects } from './tokens.mjs';
import { Node } from './ast.mjs';

export function parse(tokens) {
  let i = 0;
  const peek = () => tokens[i] || tokens[tokens.length - 1];
  const next = () => tokens[i++];
  const at = (kind, value) => {
    const t = peek();
    if (!t) return false;
    if (t.kind !== kind) return false;
    if (value === undefined) return true;
    return t.value === value;
  };
  const expect = (kind, msg) => {
    if (!at(kind)) error(msg + `, got ${peek().kind}`);
    return next();
  };
  function error(msg, tok = peek()) {
    const e = new Error(msg);
    e.pos = tok.start; throw e;
  }

  function consumeNewlines() {
    while (at(TokenKind.NEWLINE)) next();
  }

  const decls = [];
  let moduleName = null;
  consumeNewlines();
  while (!at(TokenKind.EOF)) {
    consumeNewlines();
    while (at(TokenKind.DEDENT)) next();
    while (at(TokenKind.INDENT)) next();
    consumeNewlines();
    if (at(TokenKind.EOF)) break;
    if (isKeywordSeq(KW.MODULE_IS)) {
      nextWords(kwParts(KW.MODULE_IS));
      const name = parseDottedIdent();
      moduleName = name;
      expectDot();
    } else if (isKeyword(KW.USE)) {
      nextWord();
      const name = parseDottedIdent();
      let asName = null;
      if (isKeyword(KW.AS)) { nextWord(); asName = parseIdent(); }
      expectDot();
      decls.push(Node.Import(name, asName));
    } else if (isKeyword(KW.DEFINE)) {
      nextWord();
      const typeName = parseTypeIdent();
      if (isKeywordSeq(KW.WITH)) {
        nextWord();
        const fields = parseFieldList();
        expectDot();
        decls.push(Node.Data(typeName, fields));
      } else if (isKeywordSeq(KW.ONE_OF)) {
        nextWords(kwParts(KW.ONE_OF));
        const variants = parseVariantList();
        expectDot();
        decls.push(Node.Enum(typeName, variants));
      } else {
        error("Expected 'with' or 'as one of' after type name");
      }
    } else if (isKeyword(KW.RULE)) {
      // Function
      nextWord();
      const name = parseIdent();
      const params = parseParamList();
      expectCommaOr();
      expectKeyword(KW.PRODUCE, "Expected 'produce' and return type");
      const retType = parseType();
      let effects = [];
      let body = null;

      // After return type, we can see '.' ending the sentence, then an optional effect sentence
      // Or we can see an inline effect ending with ':'
      if (at(TokenKind.DOT)) {
        next();
        consumeNewlines();
        if (isKeywordSeq(KW.PERFORMS) || (tokLowerAt(i)==='it' && tokLowerAt(i+1)==='performs')) {
          if (!isKeywordSeq(KW.PERFORMS)) nextWord();
          nextWords(kwParts(KW.PERFORMS));
          effects = parseEffectList();
          if (at(TokenKind.DOT)) { next(); }
          else if (at(TokenKind.COLON)) { next(); expectNewline(); body = parseBlock(); }
          else { error("Expected '.' or ':' after effect clause"); }
        }
      } else if (isKeywordSeq(KW.PERFORMS) || (tokLowerAt(i)==='it' && tokLowerAt(i+1)==='performs')) {
        if (!isKeywordSeq(KW.PERFORMS)) nextWord();
        nextWords(kwParts(KW.PERFORMS));
        effects = parseEffectList();
        if (at(TokenKind.DOT)) { next(); }
        else if (at(TokenKind.COLON)) { next(); expectNewline(); body = parseBlock(); }
        else { error("Expected '.' or ':' after effect clause"); }
      } else if (at(TokenKind.COLON)) {
        next(); expectNewline(); body = parseBlock();
      } else {
        error("Expected '.' or ':' after return type");
      }

      decls.push(Node.Func(name, params, retType, effects, body));
    } else if (at(TokenKind.NEWLINE) || at(TokenKind.DEDENT) || at(TokenKind.INDENT)) {
      // Tolerate stray whitespace/dedent/indent at top-level
      next();
    } else {
      error('Unexpected token at top level');
    }
    consumeNewlines();
  }

  return Node.Module(moduleName, decls);

  // Helpers
  function kwParts(phrase) { return phrase.split(' '); }
  function tokLowerAt(idx) { const t = tokens[idx]; if (!t) return null; if (t.kind !== TokenKind.IDENT && t.kind !== TokenKind.TYPE_IDENT) return null; return (t.value || '').toLowerCase(); }
  function isKeyword(kw) { const v = tokLowerAt(i); return v === kw; }
  function isKeywordSeq(words) {
    const ws = Array.isArray(words) ? words : kwParts(words);
    for (let k = 0; k < ws.length; k++) {
      const v = tokLowerAt(i + k);
      if (v !== ws[k]) return false;
    }
    return true;
  }
  function nextWord() { if (!(at(TokenKind.IDENT) || at(TokenKind.TYPE_IDENT))) error('Expected keyword/identifier'); return next(); }
  function nextWords(ws) { for (const _ of ws) nextWord(); }
  function isWordSeq(ws) { for (let k=0;k<ws.length;k++){ if (tokLowerAt(i+k)!==ws[k]) return false; } return true; }
  function consumeWord(w) { if (tokLowerAt(i)!==w) error(`Expected '${w}'`); next(); }
  function consumeWords(ws) { for (const w of ws) consumeWord(w); }
  function expectKeyword(kw, msg) { if (!isKeyword(kw)) error(msg); nextWord(); }
  function expectDot() { if (!at(TokenKind.DOT)) error("Expected '.'"); next(); }
  function expectCommaOr() { if (!at(TokenKind.COMMA)) error("Expected ','"); next(); }
  function expectDotOrColon() { if (!(at(TokenKind.DOT) || at(TokenKind.COLON))) error("Expected '.' or ':'"); }
  function expectNewline() { if (!at(TokenKind.NEWLINE)) error('Expected newline'); next(); }

  function parseDottedIdent() {
    const parts = [parseIdent()];
    while (at(TokenKind.DOT) && tokens[i+1] && (tokens[i+1].kind === TokenKind.IDENT || tokens[i+1].kind === TokenKind.TYPE_IDENT)) {
      next();
      if (at(TokenKind.IDENT)) {
        parts.push(parseIdent());
      } else if (at(TokenKind.TYPE_IDENT)) {
        parts.push(next().value);
      }
    }
    return parts.join('.');
  }
  function parseIdent() { if (!at(TokenKind.IDENT)) error('Expected identifier'); return next().value; }
  function parseTypeIdent() { if (!at(TokenKind.TYPE_IDENT)) error('Expected Type Name'); return next().value; }

  function parseFieldList() {
    const fields = [];
    while (true) {
      const name = parseIdent();
      if (!at(TokenKind.COLON)) error("Expected ':' after field name"); next();
      const t = parseType();
      fields.push({ name, type: t });
      if (at(TokenKind.COMMA)) { next(); continue; }
      if (isKeyword(KW.AND)) { nextWord(); continue; }
      break;
    }
    return fields;
  }
  function parseVariantList() {
    const vars = [];
    while (true) {
      const v = parseTypeIdent();
      vars.push(v);
      if (at(TokenKind.IDENT) && peek().value.toLowerCase() === KW.OR) { nextWord(); continue; }
      if (at(TokenKind.COMMA)) { next(); continue; }
      break;
    }
    return vars;
  }

  function parseParamList() {
    const params = [];
    // 'with' params
    if (isKeyword(KW.WITH)) { nextWord();
      while (true) {
        const name = parseIdent();
        if (!at(TokenKind.COLON)) error("Expected ':' after parameter name"); next();
        const type = parseType();
        params.push({ name, type });
        if (at(TokenKind.IDENT) && (peek().value || '').toLowerCase() === KW.AND) { nextWord(); continue; }
        break;
      }
      return params;
    }
    // Bare params: name: Type [and name: Type]*
    if (at(TokenKind.IDENT) && tokens[i+1] && tokens[i+1].kind === TokenKind.COLON) {
      while (true) {
        const name = parseIdent();
        if (!at(TokenKind.COLON)) error("Expected ':' after parameter name"); next();
        const type = parseType();
        params.push({ name, type });
        if (at(TokenKind.IDENT) && (peek().value || '').toLowerCase() === KW.AND) { nextWord(); continue; }
        break;
      }
    }
    return params;
  }

  function parseEffectList() {
    const effs = [];
    if (isKeyword(KW.IO)) { nextWord(); effs.push(Effects.IO); }
    if (isKeyword(KW.CPU)) { nextWord(); effs.push(Effects.CPU); }
    return effs;
  }

  function parseType() {
    // maybe T | Option of T | Result of T or E | list of T | map Text to Int | Text/Int/Float/Bool | TypeIdent
    if (isKeyword(KW.MAYBE)) { nextWord(); return Node.Maybe(parseType()); }
    if (isKeywordSeq(KW.OPTION_OF)) { nextWords(kwParts(KW.OPTION_OF)); return Node.Option(parseType()); }
    if (isKeywordSeq(KW.RESULT_OF)) { nextWords(kwParts(KW.RESULT_OF)); const ok = parseType(); expectKeyword(KW.OR, "Expected 'or' in Result of"); const err = parseType(); return Node.Result(ok, err); }
    if (isKeywordSeq(KW.FOR_EACH)) { /* not a type; handled elsewhere */ }
    if (isKeywordSeq(KW.WITHIN)) { /* not a type */ }

    if (isKeywordSeq(['list', 'of'])) { nextWord(); nextWord(); return Node.List(parseType()); }
    if (isKeyword('map')) { nextWord(); const k = parseType(); expectKeyword(KW.TO_WORD, "Expected 'to' in map type"); const v = parseType(); return Node.Map(k, v); }

    if (isKeyword(KW.TEXT)) { nextWord(); return Node.TypeName('Text'); }
    if (isKeyword(KW.INT)) { nextWord(); return Node.TypeName('Int'); }
    if (isKeyword(KW.FLOAT)) { nextWord(); return Node.TypeName('Float'); }
    if (isKeyword(KW.BOOL_TYPE)) { nextWord(); return Node.TypeName('Bool'); }

    if (at(TokenKind.TYPE_IDENT)) { return Node.TypeName(next().value); }

    error('Expected type');
  }

  function parseBlock() {
    const statements = [];
    consumeNewlines();
    if (!at(TokenKind.INDENT)) error('Expected indent');
    next();
    while (!at(TokenKind.DEDENT) && !at(TokenKind.EOF)) {
      consumeNewlines();
      if (at(TokenKind.DEDENT) || at(TokenKind.EOF)) break;
      statements.push(parseStatement());
      consumeNewlines();
    }
    if (!at(TokenKind.DEDENT)) error('Expected dedent');
    next();
    return Node.Block(statements);
  }

  function expectPeriodEnd() { if (!at(TokenKind.DOT)) error("Expected '.' at end of statement"); next(); }

  function parseStatement() {
    if (isKeyword(KW.LET)) {
      nextWord(); const name = parseIdent(); expectKeyword(KW.BE, "Use 'be' in bindings: 'Let x be ...'."); const expr = parseExpr(); expectPeriodEnd(); return Node.Let(name, expr);
    }
    if (isKeyword(KW.SET)) {
      nextWord(); const name = parseIdent(); expectKeyword(KW.TO_WORD, "Use 'to' in assignments: 'Set x to ...'."); const expr = parseExpr(); expectPeriodEnd(); return Node.Set(name, expr);
    }
    if (isKeyword(KW.RETURN)) {
      nextWord(); const expr = parseExpr(); expectPeriodEnd(); return Node.Return(expr);
    }
    if (isKeyword(KW.IF)) {
      nextWord();
      let negate = false;
      if (isKeyword(KW.NOT)) { nextWord(); negate = true; }
      const cond = parseExpr();
      const condExpr = negate ? Node.Call(Node.Name('not'), [cond]) : cond;
      if (!at(TokenKind.COMMA)) error("Expected ',' after condition"); next(); if (!at(TokenKind.COLON)) error("Expected ':' after ',' in If"); next(); expectNewline(); const thenBlock = parseBlock(); let elseBlock = null; if (isKeyword(KW.OTHERWISE)) { nextWord(); if (!at(TokenKind.COMMA)) error("Expected ',' after 'Otherwise'"); next(); if (!at(TokenKind.COLON)) error("Expected ':' after ',' in Otherwise"); next(); expectNewline(); elseBlock = parseBlock(); } return Node.If(condExpr, thenBlock, elseBlock);
    }
    if (isKeyword(KW.MATCH)) {
      nextWord(); const expr = parseExpr(); if (!at(TokenKind.COLON)) error("Expected ':' after match expression"); next(); expectNewline(); const cases = parseCases(); return Node.Match(expr, cases);
    }
    // Plain bare expression as statement (allow method calls, constructions) ending with '.'
    if (at(TokenKind.IDENT) || at(TokenKind.TYPE_IDENT) || at(TokenKind.STRING) || at(TokenKind.INT) || at(TokenKind.BOOL) || at(TokenKind.NULL) || at(TokenKind.LPAREN)) {
      const exprStart = i;
      try {
        const e = parseExpr();
        expectPeriodEnd();
        return e; // Not lowering; in v0, only Return statements are valid side-effects.
      } catch (e) {
        // rewind
        i = exprStart;
      }
    }
    if (isKeyword(KW.WITHIN)) {
      nextWord(); expectKeyword(KW.SCOPE, "Expected 'scope' after 'Within'"); if (!at(TokenKind.COLON)) error("Expected ':' after 'scope'"); next(); expectNewline(); const b = parseBlock(); return b; // Lowering later
    }
    if (isKeyword(KW.START)) {
      nextWord(); const name = parseIdent(); expectKeyword(KW.AS, "Expected 'as' after name"); expectKeyword(KW.ASYNC, "Expected 'async'"); const expr = parseExpr(); expectPeriodEnd(); return Node.Start(name, expr);
    }
    if (isKeywordSeq(KW.WAIT_FOR)) {
      nextWords(kwParts(KW.WAIT_FOR)); const names = [parseIdent()]; while (at(TokenKind.IDENT)) { names.push(parseIdent()); if (at(TokenKind.COMMA)) next(); else break; } expectPeriodEnd(); return Node.Wait(names);
    }

    // Tolerate stray blank lines inside blocks
    if (at(TokenKind.NEWLINE)) { next(); return parseStatement(); }

    error('Unknown statement');
  }

  function parseCases() {
    const cases = [];
    if (!at(TokenKind.INDENT)) error('Expected indent for cases'); next();
    while (!at(TokenKind.DEDENT)) {
      if (!isKeyword(KW.WHEN)) error("Expected 'When'"); nextWord(); const pat = parsePattern(); if (!at(TokenKind.COMMA)) error("Expected ',' after pattern"); next(); const body = parseCaseBody(); cases.push(Node.Case(pat, body));
      while (at(TokenKind.NEWLINE)) next();
    }
    next();
    return cases;
  }
  function parseCaseBody() {
    if (isKeyword(KW.RETURN)) { nextWord(); const e = parseExpr(); expectPeriodEnd(); return Node.Return(e); }
    const b = parseBlock(); return b;
  }

  function parseExpr() {
    // Minimal: construction, literals, names, Ok/Err/Some/None, call with dotted names and parens args
    if (isKeywordSeq(KW.OK_OF)) { nextWords(kwParts(KW.OK_OF)); return Node.Ok(parseExpr()); }
    if (isKeywordSeq(KW.ERR_OF)) { nextWords(kwParts(KW.ERR_OF)); return Node.Err(parseExpr()); }
    if (isKeywordSeq(KW.SOME_OF)) { nextWords(kwParts(KW.SOME_OF)); return Node.Some(parseExpr()); }
    if (isKeyword(KW.NONE)) { nextWord(); return Node.None(); }
    if (at(TokenKind.STRING)) return Node.String(next().value);
    if (at(TokenKind.BOOL)) return Node.Bool(next().value);
    if (at(TokenKind.NULL)) return Node.Null();
    if (at(TokenKind.INT)) return Node.Int(next().value);

    // Construction: Type with a = expr and b = expr
    if (at(TokenKind.TYPE_IDENT)) {
      const typeName = next().value;
      if (isKeyword(KW.WITH)) {
        nextWord();
        const fields = [];
        while (true) {
          const name = parseIdent(); if (!at(TokenKind.EQUALS)) error("Expected '=' in construction"); next(); const e = parseExpr(); fields.push({ name, expr: e });
          if (isKeyword(KW.AND)) { nextWord(); continue; }
          break;
        }
        return Node.Construct(typeName, fields);
      }
      // Dotted chain after TypeIdent (e.g., AuthRepo.verify)
      let full = typeName;
      while (at(TokenKind.DOT) && tokens[i+1] && tokens[i+1].kind === TokenKind.IDENT) { next(); full += '.' + parseIdent(); }
      if (at(TokenKind.LPAREN)) {
        const target = Node.Name(full);
        const args = parseArgList();
        return Node.Call(target, args);
      }
      return Node.Name(full);
    }

    if (at(TokenKind.IDENT)) {
      const name = parseIdent();
      // dotted chain
      let full = name;
      while (at(TokenKind.DOT) && tokens[i+1] && (tokens[i+1].kind === TokenKind.IDENT || tokens[i+1].kind === TokenKind.TYPE_IDENT)) {
        next();
        if (at(TokenKind.IDENT)) {
          full += '.' + parseIdent();
        } else if (at(TokenKind.TYPE_IDENT)) {
          full += '.' + next().value;
        }
      }
      let target = Node.Name(full);
      if (at(TokenKind.LPAREN)) {
        const args = parseArgList();
        return Node.Call(target, args);
      }
      return target;
    }

    error('Unexpected expression');
  }

  function parseArgList() {
    if (!at(TokenKind.LPAREN)) error("Expected '('"); next();
    const args = [];
    while (!at(TokenKind.RPAREN)) {
      args.push(parseExpr());
      if (at(TokenKind.COMMA)) { next(); continue; }
      else break;
    }
    if (!at(TokenKind.RPAREN)) error("Expected ')'"); next();
    return args;
  }

  function parsePattern() {
    if (isKeyword(KW.NULL) || at(TokenKind.NULL)) { if (at(TokenKind.NULL)) next(); else nextWord(); return Node.PatternNull(); }
    if (at(TokenKind.TYPE_IDENT)) {
      const typeName = next().value;
      if (!at(TokenKind.LPAREN)) error("Expected '(' after constructor in pattern"); next();
      const names = [];
      while (!at(TokenKind.RPAREN)) { names.push(parseIdent()); if (at(TokenKind.COMMA)) { next(); continue; } else break; }
      if (!at(TokenKind.RPAREN)) error("Expected ')' in pattern"); next();
      return Node.PatternCtor(typeName, names);
    }
    const name = parseIdent(); return Node.PatternName(name);
  }
}


