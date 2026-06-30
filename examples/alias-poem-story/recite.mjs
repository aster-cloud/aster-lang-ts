#!/usr/bin/env node
// 吟游者：读取两首 .aster 谣曲，用生产引擎编译执行。两种「诗 × 程序」理念：
//   NIGHTFALL — **源码本身就是一首诗**（NIGHTFALL_EN 方言），且它能运行（递归聚拢星光）。
//   TIDES     — 源码是 Bard 方言，**运行结果**是押韵的诗（Match 选意象 + List 数浪）。
//
// 运行（先 `pnpm build` 出 dist/）：
//   node examples/alias-poem-story/recite.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { reciteVerse, BARD_EN, NIGHTFALL_EN } from './bard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), 'utf8');
const bar = '─'.repeat(64);
/** 缩进多行诗：每一行都加前缀（诗含真换行，逐行对齐）。 */
const indent = (text, pad = '    ') => text.split('\n').map((l) => pad + l).join('\n');

// ── NIGHTFALL — the SOURCE itself is the poem ────────────────────────────────
const nightfall = read('nightfall.ballad.aster');
console.log(bar);
console.log('  NIGHTFALL — the source itself reads as a poem, and also runs');
console.log(`  (dialect "${NIGHTFALL_EN.name}": Module→Nightfall  Rule→I  given→count`);
console.log('   If→while  Return→sing  Let→let  be→be  plus→with  minus→less  at most→but');
console.log('   apply→echoing  ── the paren-free call (ADR 0027) that hides the last seam)');
console.log(bar);
console.log('\nRead the source top-to-bottom — it is a poem:\n');
for (const line of nightfall.trimEnd().split('\n')) console.log('   ' + line);
console.log('\n' + bar);
console.log('  …and it runs — gathering the lights one by one:');
console.log(bar);
for (const stars of [1, 2, 3]) {
  console.log(`\n  ✦ ${stars} star${stars === 1 ? '' : 's'}:`);
  console.log(indent(reciteVerse(nightfall, 'gather', { stars }, NIGHTFALL_EN)));
}

// ── Ballad 2: TIDES — Match (moon phase) + List (waves) ──────────────────────
const tides = read('tides.ballad.aster');
console.log('\n' + bar);
console.log('  TIDES — a second ballad: Match (behold) on the moon phase +');
console.log('  List generation (List.range / List.sum) for the waves.');
console.log(bar);
console.log('\n' + tides.trimEnd().split('\n').map((l) => '   ' + l).join('\n'));
console.log('\n' + bar);
console.log('  Reciting four moon phases — Match picks the omen, List counts the surf:');
console.log(bar);
for (const phase of [0, 1, 2, 3]) {
  console.log(`\n  ☾ phase ${phase}:`);
  console.log(indent(reciteVerse(tides, 'seasong', { phase })));
}
console.log('');
