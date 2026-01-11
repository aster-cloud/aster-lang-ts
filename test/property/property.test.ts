#!/usr/bin/env node
import * as fc from 'fast-check';
import { canonicalize, lex, parse, lowerModule, TokenKind } from '../../src/index.js';
import { findAmbiguousInteropCalls, computeDisambiguationEdits, findDottedCallRangeAt, describeDottedCallAt, buildDescriptorPreview, returnTypeTextFromDesc } from '../../src/lsp/analysis.js';

// Property: Canonicalizer should be idempotent
const testCanonicalizerIdempotent = (): void => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 0, maxLength: 100 }),
      (input: string) => {
        const first = canonicalize(input);
        const second = canonicalize(first);
        return first === second;
      }
    ),
    { numRuns: 100 }
  );
  console.log('✓ Canonicalizer is idempotent');
};

// Property: Lexer should handle empty input
const testLexerEmptyInput = (): void => {
  const tokens = lex('');
  if (tokens.length !== 1 || tokens[0]?.kind !== TokenKind.EOF) {
    throw new Error('Lexer should produce exactly one EOF token for empty input');
  }
  console.log('✓ Lexer handles empty input correctly');
};

// Property: Lexer should always end with EOF
const testLexerAlwaysEOF = (): void => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 0, maxLength: 50 }),
      (input: string) => {
        try {
          const tokens = lex(input);
          return tokens.length > 0 && tokens[tokens.length - 1]?.kind === TokenKind.EOF;
        } catch {
          return true; // Lexer errors are acceptable
        }
      }
    ),
    { numRuns: 100 }
  );
  console.log('✓ Lexer always ends with EOF token');
};

// Property: Valid identifiers should lex correctly
const testValidIdentifiers = (): void => {
  const validIdent = fc.string({ minLength: 1, maxLength: 20 })
    .filter(s => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(s));

  fc.assert(
    fc.property(validIdent, (ident: string) => {
      const tokens = lex(ident);
      return tokens.length >= 2 &&
             (tokens[0]?.kind === TokenKind.IDENT || tokens[0]?.kind === TokenKind.TYPE_IDENT) &&
             tokens[tokens.length - 1]?.kind === TokenKind.EOF;
    }),
    { numRuns: 50 }
  );
  console.log('✓ Valid identifiers lex correctly');
};

// Property: Valid integers should lex correctly
const testValidIntegers = (): void => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 999999 }),
      (num: number) => {
        const tokens = lex(num.toString());
        return tokens.length >= 2 &&
               tokens[0]?.kind === TokenKind.INT &&
               tokens[0]?.value === num &&
               tokens[tokens.length - 1]?.kind === TokenKind.EOF;
      }
    ),
    { numRuns: 50 }
  );
  console.log('✓ Valid integers lex correctly');
};

// Property: String literals should lex correctly
const testStringLiterals = (): void => {
  const validString = fc.string({ minLength: 0, maxLength: 30 })
    .filter(s => !s.includes('"') && !s.includes('\\'));

  fc.assert(
    fc.property(validString, (str: string) => {
      const input = `"${str}"`;
      const tokens = lex(input);
      return tokens.length >= 2 &&
             tokens[0]?.kind === TokenKind.STRING &&
             tokens[0]?.value === str &&
             tokens[tokens.length - 1]?.kind === TokenKind.EOF;
    }),
    { numRuns: 50 }
  );
  console.log('✓ String literals lex correctly');
};

// Property: Comment tokens should be generated with trivia channel
const testCommentTokenGeneration = (): void => {
  const cases = [
    { input: '# standalone comment', desc: 'hash comment' },
    { input: '// standalone comment', desc: 'slash comment' },
    { input: 'Let x be 1. # inline', desc: 'inline hash comment' },
    { input: 'Let x be 1. // inline', desc: 'inline slash comment' },
    { input: '# comment 1\n# comment 2', desc: 'multiple comments' },
  ];

  for (const c of cases) {
    const tokens = lex(c.input);
    const commentTokens = tokens.filter(t => t.kind === TokenKind.COMMENT);
    if (commentTokens.length === 0) {
      throw new Error(`Expected comment token for ${c.desc}, got none`);
    }
    for (const ct of commentTokens) {
      if (ct.channel !== 'trivia') {
        throw new Error(`Expected trivia channel for ${c.desc}, got ${ct.channel}`);
      }
      if (!ct.value || typeof ct.value !== 'object') {
        throw new Error(`Expected comment value object for ${c.desc}`);
      }
    }
  }
  console.log('✓ Comment tokens generated with trivia channel');
};

// Property: Inline/standalone comment classification
const testCommentClassification = (): void => {
  const inlineCases = [
    'Let x be 1. # inline',
    'Return "hi". // inline',
    'To greet, produce Text: # inline',
  ];
  const standaloneCases = [
    '# standalone',
    '  # indented standalone',
    '// standalone at start',
  ];

  for (const src of inlineCases) {
    const tokens = lex(src);
    const commentTokens = tokens.filter(t => t.kind === TokenKind.COMMENT);
    if (commentTokens.length === 0) {
      throw new Error(`Expected inline comment for: ${src}`);
    }
    const ct = commentTokens[0]!;
    const val = ct.value as { trivia: string };
    if (val.trivia !== 'inline') {
      throw new Error(`Expected inline classification for: ${src}, got ${val.trivia}`);
    }
  }

  for (const src of standaloneCases) {
    const tokens = lex(src);
    const commentTokens = tokens.filter(t => t.kind === TokenKind.COMMENT);
    if (commentTokens.length === 0) {
      throw new Error(`Expected standalone comment for: ${src}`);
    }
    const ct = commentTokens[0]!;
    const val = ct.value as { trivia: string };
    if (val.trivia !== 'standalone') {
      throw new Error(`Expected standalone classification for: ${src}, got ${val.trivia}`);
    }
  }

  console.log('✓ Comment inline/standalone classification correct');
};

// Property: Comments should not affect indentation tracking
const testCommentsIndentInteraction = (): void => {
  const src = [
    'This module is test.',
    '',
    '# standalone comment',
    'To f, produce Int:',
    '  # indented comment',
    '  Let x be 1.',
    '  # another comment',
    '  Return x.',
  ].join('\n');

  const tokens = lex(src);
  const indentTokens = tokens.filter(t => t.kind === TokenKind.INDENT);
  const dedentTokens = tokens.filter(t => t.kind === TokenKind.DEDENT);

  // Should have exactly 1 INDENT (after function header) and 1 DEDENT (at end)
  if (indentTokens.length !== 1) {
    throw new Error(`Expected 1 INDENT, got ${indentTokens.length}`);
  }
  if (dedentTokens.length !== 1) {
    throw new Error(`Expected 1 DEDENT, got ${dedentTokens.length}`);
  }

  // Verify comments are trivia
  const commentTokens = tokens.filter(t => t.kind === TokenKind.COMMENT);
  if (commentTokens.length < 3) {
    throw new Error(`Expected at least 3 comments, got ${commentTokens.length}`);
  }
  for (const ct of commentTokens) {
    if (ct.channel !== 'trivia') {
      throw new Error(`Comment should have trivia channel, got ${ct.channel}`);
    }
  }

  console.log('✓ Comments do not affect indentation tracking');
};

// Regression: Start/Wait 关键字应优先于“裸表达式报错”
// 确保 'Start ... as async ... .', 'Wait for ... .' 解析为语句而非裸表达式
const testStartWaitPrecedence = (): void => {
  const src = [
    'This module is demo.async.',
    '',
    'Define User with id: Text.',
    'Define Dash with profile: Text, timeline: Text.',
    'Define AuthErr as one of InvalidCreds, Locked.',
    '',
    'To fetchDashboard with u: User, produce Result of Dash and AuthErr. It performs io:',
    '  Start profile as async ProfileSvc.load(u.id).',
    '  Start timeline as async FeedSvc.timeline(u.id).',
    '  Wait for profile and timeline.',
    '  Return Ok(Dash(profile, timeline)).',
    '',
  ].join('\n');

  const can = canonicalize(src);
  const toks = lex(can);
  let ast: any;
  try {
    ast = parse(toks);
  } catch (e) {
    throw new Error('Start/Wait should parse as statements without bare-expression error: ' + (e as Error).message);
  }
  if (!ast || ast.kind !== 'Module') throw new Error('Expected Module AST');
  const fn = ast.decls.find((d: any) => d.kind === 'Func');
  if (!fn) throw new Error('Expected function decl');
  const stmts = fn.body?.statements ?? [];
  const kinds = stmts.map((s: any) => s.kind);
  const expectedSeq = ['Start', 'Start', 'Wait', 'Return'];
  if (expectedSeq.some((k, i) => kinds[i] !== k)) {
    throw new Error('Unexpected statement sequence: ' + kinds.join(','));
  }
  console.log('✓ Start/Wait precedence over bare-expression error');
};

// Regression: Wait 支持单名与多名（"a" / "a and b" / "a, b and c"）
const testWaitSingleAndMultiple = (): void => {
  const mkSrc = (waitLine: string) => [
    'This module is demo.wait.',
    '',
    'Define User with id: Text.',
    '',
    'To f with u: User, produce Int. It performs io:',
    '  Start taskA as async ProfileSvc.load(u.id).',
    '  Start taskB as async ProfileSvc.load(u.id).',
    '  Start taskC as async ProfileSvc.load(u.id).',
    `  ${waitLine}`,
    '  Return 1.',
    '',
  ].join('\n');

  const cases: Array<{ line: string; expect: string[] }> = [
    { line: 'Wait for taskA.', expect: ['taskA'] },
    { line: 'Wait for taskA and taskB.', expect: ['taskA', 'taskB'] },
    { line: 'Wait for taskA, taskB and taskC.', expect: ['taskA', 'taskB', 'taskC'] },
  ];

  for (const c of cases) {
    const can = canonicalize(mkSrc(c.line));
    const toks = lex(can);
    const ast: any = parse(toks);
    const fn = ast.decls.find((d: any) => d.kind === 'Func');
    if (!fn) throw new Error('Expected function decl');
    const waitStmt = fn.body.statements.find((s: any) => s.kind === 'Wait');
    if (!waitStmt) throw new Error('Expected a Wait statement');
    const names: string[] = waitStmt.names;
    if (names.length !== c.expect.length || names.some((n, i) => n !== c.expect[i])) {
      throw new Error(`Wait names mismatch. got=[${names.join(',')}], want=[${c.expect.join(',')}]`);
    }
  }
  console.log('✓ Wait single and multiple names parse correctly');
};

// Property: Round-trip test for simple valid programs
const testRoundTrip = (): void => {
  const validPrograms = [
    'This module is test.',
    'Define User with name: Text.',
    'To greet, produce Text.',
    'To test, produce Text:\n  Let x be 42.\n  Return "hello".',
  ];

  for (const program of validPrograms) {
    try {
      const can = canonicalize(program);
      const tokens = lex(can);
      const ast = parse(tokens);
      const core = lowerModule(ast);

      // Basic sanity checks
      if (!ast || !core) {
        throw new Error(`Round-trip failed for: ${program}`);
      }
      if (ast.kind !== 'Module' || core.kind !== 'Module') {
        throw new Error(`Expected Module, got ${ast.kind} -> ${core.kind}`);
      }
    } catch (e) {
      throw new Error(`Round-trip failed for "${program}": ${(e as Error).message}`);
    }
  }
  console.log('✓ Round-trip test passes for valid programs');
};

// Property: Parser should handle malformed input gracefully
const testParserErrorHandling = (): void => {
  const malformedInputs = [
    'This module is',  // Missing module name
    'Define User with',  // Incomplete data definition
    'To greet produce',  // Missing comma
    'Let x be',  // Missing expression
    'Return',  // Missing expression
  ];

  for (const input of malformedInputs) {
    try {
      const can = canonicalize(input);
      const tokens = lex(can);
      parse(tokens);
      throw new Error(`Expected parser error for: ${input}`);
    } catch (e) {
      // Expected to throw
      if (!(e as any).pos) {
        throw new Error(`Parser error should include position for: ${input}`);
      }
    }
  }
  console.log('✓ Parser handles malformed input gracefully with position info');
};

function main(): void {
  console.log('Running property tests...\n');

  try {
    const dumpTokens = (toks: any[]) =>
      toks
        .map(t => `${t.value ?? 'null'}:${t.kind}@${t.start?.line}:${t.start?.col}`)
        .join(' ');
    testCanonicalizerIdempotent();
    testLexerEmptyInput();
    testLexerAlwaysEOF();
    testValidIdentifiers();
    testValidIntegers();
    testStringLiterals();
    testCommentTokenGeneration();
    testCommentClassification();
    testCommentsIndentInteraction();
    testStartWaitPrecedence();
    testWaitSingleAndMultiple();
    testRoundTrip();
    // Generics sanity check
    testGenericsBasic();
    testParserErrorHandling();

    // LSP analysis small checks
    const src1 = 'This module is demo.x.\nTo f, produce Text:\n  Return Interop.sum(1, 2.0).\n';
    const toks1 = lex(canonicalize(src1));
    const diags1 = findAmbiguousInteropCalls(toks1 as any);
    if (diags1.length === 0) throw new Error('Expected ambiguous call diagnostic');
    const edits1 = computeDisambiguationEdits(toks1 as any, diags1[0]!.range as any);
    if (!edits1.some(e => e.newText.endsWith('.0'))) throw new Error('Expected a .0 edit');
    // find dotted call range at the position of the callee qualifier (Interop)
    const firstTypeIdentIdx = toks1.findIndex(t => (t.kind === TokenKind.TYPE_IDENT || t.kind === TokenKind.IDENT) && t.value === 'Interop');
    if (firstTypeIdentIdx < 0) throw new Error('No Interop token found');
    const pos = { line: toks1[firstTypeIdentIdx]!.start.line - 1, character: toks1[firstTypeIdentIdx]!.start.col } as any;
    const rangeCall = findDottedCallRangeAt(toks1 as any, pos as any);
    if (!rangeCall) throw new Error('Expected to find dotted call range');

    // Nested call: ensure inner and outer are detectable and descriptor preview aligns
    const src2 = 'This module is demo.x.\nTo g, produce Text:\n  Return Interop.sum(Interop.sum(1, 2.0), 3.0).\n';
    const toks2 = lex(canonicalize(src2));
    // Outer call at TYPE_IDENT 'Interop'
    const typeIdx2 = toks2.findIndex(t => (t.kind === TokenKind.TYPE_IDENT || t.kind === TokenKind.IDENT) && t.value === 'Interop');
    if (typeIdx2 < 0) throw new Error('No Interop token (outer) found. toks=' + dumpTokens(toks2 as any));
    const posOuter = { line: toks2[typeIdx2]!.start.line - 1, character: toks2[typeIdx2]!.start.col } as any;
    const rangeOuter = findDottedCallRangeAt(toks2 as any, posOuter);
    if (!rangeOuter) throw new Error('Expected outer call range');
    // Inner call at second TYPE_IDENT 'Interop'
    const typeIdx3 = toks2.findIndex((t, idx) => (t.kind === TokenKind.TYPE_IDENT || t.kind === TokenKind.IDENT) && t.value === 'Interop' && idx > typeIdx2);
    if (typeIdx3 < 0) throw new Error('No second Interop token (inner) found. toks=' + dumpTokens(toks2 as any));
    const posInner = { line: toks2[typeIdx3]!.start.line - 1, character: toks2[typeIdx3]!.start.col } as any;
    const rangeInner = findDottedCallRangeAt(toks2 as any, posInner);
    if (!rangeInner) throw new Error('Expected inner call range');

    // Text.* helpers: descriptor preview checks
    const src3 = 'This module is demo.t.\nTo h, produce Int:\n  Return Text.length("abc").\n';
    const toks3 = lex(canonicalize(src3));
    const textIdx = toks3.findIndex(t => (t.kind === TokenKind.TYPE_IDENT || t.kind === TokenKind.IDENT) && t.value === 'Text');
    if (textIdx < 0) throw new Error('No Text token found. toks=' + dumpTokens(toks3 as any));
    const posText = { line: toks3[textIdx]!.start.line - 1, character: toks3[textIdx]!.start.col } as any;
    const info = describeDottedCallAt(toks3 as any, posText as any);
    if (!info) throw new Error('Expected Text.length call info');
    const descPrev = buildDescriptorPreview(info.name, info.argDescs);
    if (descPrev !== '(Ljava/lang/String;)I') throw new Error('Unexpected descriptor for Text.length: ' + descPrev);
    const retLen = returnTypeTextFromDesc(descPrev);
    if (retLen !== 'Int') throw new Error('Unexpected return type for Text.length: ' + retLen);

    const src4 = 'This module is demo.t.\nTo j, produce Text:\n  Return Text.concat("a", "b").\n';
    const toks4 = lex(canonicalize(src4));
    const concatIdx = toks4.findIndex(t => t.kind === TokenKind.IDENT && t.value === 'concat');
    if (concatIdx < 2) throw new Error('concat token not found or too early. toks=' + dumpTokens(toks4 as any));
    const cidx = concatIdx - 2; // position on 'Text'
    const posConcat = { line: toks4[cidx]!.start.line - 1, character: toks4[cidx]!.start.col } as any;
    const info2 = describeDottedCallAt(toks4 as any, posConcat as any);
    if (!info2) throw new Error('Expected Text.concat call info');
    const desc2 = buildDescriptorPreview(info2.name, info2.argDescs);
    if (desc2 !== '(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;') throw new Error('Unexpected descriptor for Text.concat: ' + desc2);
    const retConcat = returnTypeTextFromDesc(desc2);
    if (retConcat !== 'Text') throw new Error('Unexpected return type for Text.concat: ' + retConcat);

    // List.get and Map.get previews
    const src5 = 'This module is demo.c.\nTo k, produce Text:\n  Return List.get(xs, 1).\n';
    const toks5 = lex(canonicalize(src5));
    const listIdx = toks5.findIndex(t => (t.kind === TokenKind.TYPE_IDENT && t.value === 'List') || (t.kind === TokenKind.IDENT && t.value === 'List'));
    if (listIdx < 0) throw new Error('No List token found. toks=' + dumpTokens(toks5 as any));
    const posList = { line: toks5[listIdx]!.start.line - 1, character: toks5[listIdx]!.start.col } as any;
    const infoList = describeDottedCallAt(toks5 as any, posList as any);
    if (!infoList) throw new Error('Expected List.get call info');
    const descList = buildDescriptorPreview(infoList.name, infoList.argDescs);
    if (descList !== '(Ljava/util/List;I)Ljava/lang/Object;') throw new Error('Unexpected descriptor for List.get: ' + descList);
    const retList = returnTypeTextFromDesc(descList);
    if (retList !== 'Object') throw new Error('Unexpected return type for List.get: ' + retList);

    const src6 = 'This module is demo.c.\nTo m, produce Text:\n  Return Map.get(mm, kk).\n';
    const toks6 = lex(canonicalize(src6));
    const mapIdx = toks6.findIndex(t => (t.kind === TokenKind.TYPE_IDENT && t.value === 'Map') || (t.kind === TokenKind.IDENT && t.value === 'Map'));
    if (mapIdx < 0) throw new Error('No Map token found. toks=' + dumpTokens(toks6 as any));
    const posMap = { line: toks6[mapIdx]!.start.line - 1, character: toks6[mapIdx]!.start.col } as any;
    const infoMap = describeDottedCallAt(toks6 as any, posMap as any);
    if (!infoMap) throw new Error('Expected Map.get call info');
    const descMap = buildDescriptorPreview(infoMap.name, infoMap.argDescs);
    if (descMap !== '(Ljava/util/Map;Ljava/lang/Object;)Ljava/lang/Object;') throw new Error('Unexpected descriptor for Map.get: ' + descMap);
    const retMap = returnTypeTextFromDesc(descMap);
    if (retMap !== 'Object') throw new Error('Unexpected return type for Map.get: ' + retMap);

    console.log('\n✅ All property tests passed!');
  } catch (e) {
    console.error('\n❌ Property test failed:', (e as Error).message);
    process.exit(1);
  }
}

main();

// Generics: basic sanity
function testGenericsBasic(): void {
  const src = [
    'This module is demo.generic.',
    '',
    'To identity of T, with x: T, produce T:',
    '  Return x.',
    '',
  ].join('\n');
  const can = canonicalize(src);
  const toks = lex(can);
  const ast = parse(toks);
  const core = lowerModule(ast);
  if (core.kind !== 'Module') throw new Error('Expected Module');
  const fn = core.decls.find(d => (d as any).kind === 'Func') as any;
  if (!fn) throw new Error('Expected a function decl');
  const tp = (fn.typeParams ?? []) as string[];
  if (!(tp.length === 1 && tp[0] === 'T')) throw new Error('Expected type param T');
  const paramType = fn.params[0]?.type;
  const retType = fn.ret;
  if (!paramType || paramType.kind !== 'TypeVar' || paramType.name !== 'T') throw new Error('Param type should be TypeVar T');
  if (!retType || retType.kind !== 'TypeVar' || (retType as any).name !== 'T') throw new Error('Return type should be TypeVar T');
  console.log('✓ Generics basic parse/lower');
}
