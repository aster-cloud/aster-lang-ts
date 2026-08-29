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
  // ★零容忍（issue #147）。原为「Allow up to 1% crashes」——即每 500 例里出现
  //   5 次栈溢出/OOM 仍判全绿。栈溢出不是「偶发噪声」而是确定性缺陷：
  //   同一输入每次都会崩。容忍 1% 等于声明「我们接受 5 个已知崩溃」，
  //   而 fuzz 的全部意义就是发现它们。
  if (crashes > 0) {
    throw new Error(`Lexer should not crash on any input: ${crashes}/${total}`);
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

// ★结构化深嵌套 fuzz（issue #147）。
//
//   原 fuzz 只喂 ≤200 字符的**随机串**：那种输入永远构造不出触发深嵌套栈溢出
//   所需的数千层结构，于是「不会栈溢出」的断言实质**空转**——它从来没有机会失败。
//   随机短串测的是「乱码不崩」，而真正会崩的是**结构合法但极深**的输入。
//
//   这里显式生成三类病态结构，长度直接按层数放大到数千层：
//   括号 / 类型（maybe 链）/ 列表字面量。这些正是解析器递归下降的回环点。
const fuzzDeepNesting = (): void => {
  let total = 0;
  let crashes = 0;
  const failures: string[] = [];

  const shapes: Array<[string, (n: number) => string]> = [
    ['nested-parens', (n) => `Module p.\n\nRule r given x:\n  Return ${'('.repeat(n)}1${')'.repeat(n)}.\n`],
    ['nested-maybe-type', (n) => `Module p.\n\nRule r given x as ${'maybe '.repeat(n)}Int, produce Int:\n  Return 1.\n`],
    ['nested-list-literal', (n) => `Module p.\n\nRule r given x:\n  Return ${'['.repeat(n)}1${']'.repeat(n)}.\n`],
  ];

  for (const [label, build] of shapes) {
    for (const depth of [100, 500, 2000, 10000]) {
      total++;
      const src = build(depth);
      try {
        const can = canonicalize(src);
        const tokens = lex(can);
        const res = parse(tokens) as { diagnostics?: { message?: string }[] } | undefined;

        // ★不能只看「有没有抛异常」（issue #147 的一个隐藏面）。
        //   parse() 内部有 catch-all：原生 RangeError 会被它**吞掉并转成诊断**，
        //   于是从外面看根本没有异常抛出——我第一版正是这么写的，
        //   撤掉 #145 的护栏后 fuzz 照样全绿。
        //   栈溢出的痕迹留在**返回的诊断文本**里，必须一并检查。
        for (const d of res?.diagnostics ?? []) {
          const m = d?.message ?? '';
          if (m.includes('Maximum call stack') || m.includes('out of memory')) {
            crashes++;
            failures.push(`${label}@${depth}: (diagnostic) ${m.slice(0, 80)}`);
            break;
          }
        }
      } catch (e) {
        const msg = (e as Error).message ?? '';
        if (msg.includes('Maximum call stack') || msg.includes('out of memory')) {
          crashes++;
          failures.push(`${label}@${depth}: (thrown) ${msg.slice(0, 80)}`);
        }
        // 其它错误（含「nesting too deep」这类**可恢复诊断**）正是期望行为
      }
    }
  }

  console.log(`✓ Deep-nesting fuzz test: ${total} shapes, ${crashes} crashes`);
  if (crashes > 0) {
    throw new Error(
      `Deep nesting must produce recoverable diagnostics, not native stack overflow:\n  ` +
      failures.join('\n  '),
    );
  }
};

function main(): void {
  console.log('Running fuzz tests...\n');
  
  try {
    fuzzLexer();
    fuzzParser();
    fuzzValidLookingCNL();
    fuzzIndentation();
    fuzzDeepNesting();
    
    console.log('\n✅ All fuzz tests passed!');
  } catch (e) {
    console.error('\n❌ Fuzz test failed:', (e as Error).message);
    process.exit(1);
  }
}

main();
