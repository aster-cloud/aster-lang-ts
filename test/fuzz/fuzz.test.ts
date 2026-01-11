#!/usr/bin/env node
import * as fc from 'fast-check';
import { canonicalize } from '../../src/frontend/canonicalizer.js';
import { lex } from '../../src/frontend/lexer.js';
import { parse } from '../../src/parser.js';

// Fuzz test: Random input should not crash the lexer
const fuzzLexer = (): void => {
  let crashes = 0;
  let total = 0;
  
  fc.assert(
    fc.property(
      fc.string({ minLength: 0, maxLength: 200 }),
      (input: string) => {
        total++;
        try {
          const can = canonicalize(input);
          lex(can);
          return true;
        } catch (e) {
          // Lexer errors are acceptable, but crashes are not
          if ((e as Error).message.includes('Maximum call stack') || 
              (e as Error).message.includes('out of memory')) {
            crashes++;
            return false;
          }
          return true; // Normal lexer errors are fine
        }
      }
    ),
    { numRuns: 500 }
  );
  
  console.log(`✓ Lexer fuzz test: ${total} inputs, ${crashes} crashes (${((crashes/total)*100).toFixed(1)}%)`);
  if (crashes > total * 0.01) { // Allow up to 1% crashes
    throw new Error(`Too many lexer crashes: ${crashes}/${total}`);
  }
};

// Fuzz test: Random input should not crash the parser
const fuzzParser = (): void => {
  let crashes = 0;
  let total = 0;
  let parsed = 0;
  
  fc.assert(
    fc.property(
      fc.string({ minLength: 0, maxLength: 100 }),
      (input: string) => {
        total++;
        try {
          const can = canonicalize(input);
          const tokens = lex(can);
          parse(tokens);
          parsed++;
          return true;
        } catch (e) {
          // Parser errors are expected for random input, but crashes are not
          if ((e as Error).message.includes('Maximum call stack') || 
              (e as Error).message.includes('out of memory')) {
            crashes++;
            return false;
          }
          return true; // Normal parser errors are fine
        }
      }
    ),
    { numRuns: 300 }
  );
  
  console.log(`✓ Parser fuzz test: ${total} inputs, ${parsed} parsed (${((parsed/total)*100).toFixed(1)}%), ${crashes} crashes`);
  if (crashes > 0) {
    throw new Error(`Parser should not crash on any input: ${crashes}/${total}`);
  }
};

// Fuzz test: Valid-looking CNL constructs
const fuzzValidLookingCNL = (): void => {
  const keywords = ['This', 'module', 'is', 'Define', 'with', 'To', 'produce', 'Let', 'be', 'Return'];
  const types = ['Text', 'Int', 'Bool', 'User', 'Result'];
  const identifiers = ['x', 'name', 'value', 'result', 'data'];
  
  const genKeyword = fc.constantFrom(...keywords);
  const genType = fc.constantFrom(...types);
  const genIdent = fc.constantFrom(...identifiers);
  const genPunct = fc.constantFrom('.', ':', ',', '(', ')');
  
  const genToken = fc.oneof(genKeyword, genType, genIdent, genPunct, fc.constant(' '));
  const genProgram = fc.array(genToken, { minLength: 5, maxLength: 30 }).map(tokens => tokens.join(''));
  
  let total = 0;
  let crashes = 0;
  
  fc.assert(
    fc.property(genProgram, (program: string) => {
      total++;
      try {
        const can = canonicalize(program);
        const tokens = lex(can);
        parse(tokens);
        return true;
      } catch (e) {
        if ((e as Error).message.includes('Maximum call stack') || 
            (e as Error).message.includes('out of memory')) {
          crashes++;
          return false;
        }
        return true; // Parse errors are expected
      }
    }),
    { numRuns: 200 }
  );
  
  console.log(`✓ Valid-looking CNL fuzz test: ${total} inputs, ${crashes} crashes`);
  if (crashes > 0) {
    throw new Error(`Should not crash on valid-looking CNL: ${crashes}/${total}`);
  }
};

// Fuzz test: Indentation edge cases
const fuzzIndentation = (): void => {
  const genIndent = fc.integer({ min: 0, max: 20 }).map(n => ' '.repeat(n));
  const genLine = fc.tuple(genIndent, fc.constantFrom('Let x be 42.', 'Return "test".', 'Define User.'))
    .map(([indent, content]) => indent + content);
  const genProgram = fc.array(genLine, { minLength: 1, maxLength: 10 }).map(lines => lines.join('\n'));
  
  let total = 0;
  let crashes = 0;
  
  fc.assert(
    fc.property(genProgram, (program: string) => {
      total++;
      try {
        const can = canonicalize(program);
        const tokens = lex(can);
        parse(tokens);
        return true;
      } catch (e) {
        if ((e as Error).message.includes('Maximum call stack') || 
            (e as Error).message.includes('out of memory')) {
          crashes++;
          return false;
        }
        return true; // Indentation errors are expected
      }
    }),
    { numRuns: 150 }
  );
  
  console.log(`✓ Indentation fuzz test: ${total} inputs, ${crashes} crashes`);
  if (crashes > 0) {
    throw new Error(`Should not crash on indentation edge cases: ${crashes}/${total}`);
  }
};

function main(): void {
  console.log('Running fuzz tests...\n');
  
  try {
    fuzzLexer();
    fuzzParser();
    fuzzValidLookingCNL();
    fuzzIndentation();
    
    console.log('\n✅ All fuzz tests passed!');
  } catch (e) {
    console.error('\n❌ Fuzz test failed:', (e as Error).message);
    process.exit(1);
  }
}

main();
