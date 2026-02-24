#!/usr/bin/env node
import { canonicalize } from '../../src/frontend/canonicalizer.js';
import { lex } from '../../src/frontend/lexer.js';
import { parse } from '../../src/parser.js';
import { buildIdIndex, exprTypeText } from '../../src/lsp/utils.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function main(): void {
  const program = [
    'Module demo.props.',
    'Rule f given left as Text and right as Text, produce Text:',
    '  Let x be Text.concat(left, right).',
    '  Return x.',
    ''
  ].join('\n');
  const can = canonicalize(program);
  const toks = lex(can);
  const ast = parse(toks).ast as any;

  // Reference index should include x at least twice (let + return)
  const idx = buildIdIndex(toks);
  const xs = idx.get('x') || [];
  assert(xs.length >= 2, `Expected >=2 references to x, got ${xs.length}`);

  // Type hint for let expression
  const f = (ast.decls || []).find((d: any) => d.kind === 'Func');
  assert(!!f, 'Expected function decl f');
  const letStmt = (f.body.statements || []).find((s: any) => s.kind === 'Let');
  const ty = exprTypeText(letStmt.expr);
  assert(ty === 'Text', `Expected type Text for Text.concat, got ${ty}`);

  // Idempotence of type hint
  const ty2 = exprTypeText(letStmt.expr);
  assert(ty2 === ty, 'exprTypeText should be idempotent');

  console.log('✓ LSP utils property checks passed');
}

try { main(); } catch (e) { console.error(String(e)); process.exit(1); }
