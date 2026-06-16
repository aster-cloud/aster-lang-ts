/**
 * POC verify — Phase 0 of ADR 0017.
 * 用手写的 Hindi (Devanagari) lexicon 编译几个 Hindi CNL 示例,验证非拉丁脚本能
 * 完整走 lex → canonicalize → parse → typecheck。这是加 Hindi 作第四语种的最大风险点。
 *
 * 跑: npx tsx scripts/poc-hindi/verify.ts
 */
import { compile, validateSyntaxWithSpan, tokenize } from '../../src/browser.js';
import { HI_IN_POC } from './hi-IN.poc.js';

interface Case {
  name: string;
  src: string;
}

// Hindi CNL 示例(用 hi-IN.poc 的 keyword)。每个对应一个英语示例的 Hindi 版。
const cases: Case[] = [
  {
    name: 'minimal rule (Module + Rule + If + arithmetic + Return)',
    // EN: Module pricing. Rule discountedPrice given amount as Int, produce Int:
    //       If amount greater than 100  Return amount times 80 divided by 100.  Return amount.
    // 注: 用 `से अधिक`(greater than) 而非 `है`(is) 比较——`है`(is) 的比较语义需要
    // 一个 Hindi 版 is-comparator transformer(Phase 1 范畴, 见 ADR 0017),不在 POC 内。
    src: [
      'मॉड्यूल pricing।',
      '',
      'नियम discountedPrice दिया गया amount रूप में पूर्णांक, उत्पन्न पूर्णांक:',
      '  यदि amount से अधिक 100',
      '    लौटाएं amount गुणा 80 भाग 100।',
      '  लौटाएं amount।',
    ].join('\n'),
  },
  {
    name: 'struct Define + has + types',
    // EN: Define Applicant has creditScore as Int, income as Int.
    src: [
      'मॉड्यूल loan।',
      '',
      'परिभाषित Applicant रखता है creditScore रूप में पूर्णांक, income रूप में पूर्णांक।',
      '',
      'नियम approve दिया गया a रूप में Applicant, उत्पन्न बूलियन:',
      '  यदि a.creditScore से अधिक 700',
      '    लौटाएं सत्य।',
      '  लौटाएं असत्य।',
    ].join('\n'),
  },
  {
    name: 'arithmetic + comparators (plus/minus/less than)',
    src: [
      'मॉड्यूल calc।',
      '',
      'नियम net दिया गया gross रूप में पूर्णांक, tax रूप में पूर्णांक, उत्पन्न पूर्णांक:',
      '  मानें result हो gross घटा tax।',
      '  यदि result से कम 0',
      '    लौटाएं 0।',
      '  लौटाएं result।',
    ].join('\n'),
  },
];

let pass = 0;
let fail = 0;

for (const c of cases) {
  console.log(`\n=== ${c.name} ===`);
  try {
    // 1) tokenize — Devanagari 能否被切成 token
    const toks = tokenize(c.src, HI_IN_POC);
    console.log(`  tokenize: ${toks.length} tokens`);

    // 2) validateSyntaxWithSpan — 语法层
    const synErrs = validateSyntaxWithSpan(c.src, HI_IN_POC);
    if (synErrs.length) {
      console.log(`  ✗ syntax errors (${synErrs.length}):`);
      synErrs.slice(0, 5).forEach((e) =>
        console.log(`      ${JSON.stringify(e).slice(0, 160)}`)
      );
      fail++;
      continue;
    }

    // 3) compile — 全编译到 Core IR
    const r = compile(c.src, { lexicon: HI_IN_POC });
    const errs = r.errors ?? [];
    if (!r.success || !r.core || errs.length) {
      console.log(`  ✗ compile failed: success=${r.success} core=${!!r.core}`);
      errs.slice(0, 5).forEach((d) => console.log(`      ${JSON.stringify(d).slice(0, 200)}`));
      fail++;
      continue;
    }
    // core IR 里应有 module 名 + 至少一个 func
    const core = r.core as { name?: string; decls?: ReadonlyArray<unknown> };
    console.log(`  ✓ compiled → module="${core.name}" decls=${core.decls?.length ?? '?'}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ THREW: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
    fail++;
  }
}

console.log(`\n========================================`);
console.log(`Hindi POC: ${pass} passed / ${fail} failed (of ${cases.length})`);
console.log(`========================================`);
process.exit(fail > 0 ? 1 : 0);
