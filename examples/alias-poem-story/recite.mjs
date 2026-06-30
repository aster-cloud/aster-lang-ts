#!/usr/bin/env node
// 吟游者：读取 nightfall.ballad.aster（用 Bard 方言别名写的谣曲），用生产引擎编译执行，
// 在不同时辰把它「唱」出来——同一份源码，因到达时辰不同走向不同的诗节与结局。
//
// 运行（先 `pnpm build` 出 dist/）：
//   node examples/alias-poem-story/recite.mjs
//   node examples/alias-poem-story/recite.mjs 8     # 指定时辰
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { recite, reciteVerse, BARD_EN } from './bard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), 'utf8');
const bar = '─'.repeat(64);
/** 缩进多行诗：每一行都加前缀（诗现在含真换行，逐行对齐）。 */
const indent = (text, pad = '    ') => text.split('\n').map((l) => pad + l).join('\n');

// ── Ballad 1: NIGHTFALL — branching story (If) + recursive poem ──────────────
const nightfall = read('nightfall.ballad.aster');
console.log(bar);
console.log('  NIGHTFALL — a runnable ballad, written in the Bard dialect');
console.log(`  (custom lexicon "${BARD_EN.name}" aliases Aster keywords:`);
console.log('   Module→Ballad  Rule→Verse  given→of  Let→let  be→become  If→where');
console.log('   Return→sing  plus→then(join)  at most→but  at least→past  minus→less');
console.log('   Match→behold  When→as  — types omitted; verses join across lines (ADR 0026))');
console.log(bar);
console.log('\nThe source reads as verse, yet compiles + runs on the real engine:\n');
for (const line of nightfall.trimEnd().split('\n')) console.log('   ' + line);
console.log('\n' + bar);
console.log('  Reciting at three hours — the same poem, three fates (If-branching):');
console.log(bar);
for (const hour of [8, 19, 23]) {
  console.log(`\n  ⏾ hour ${String(hour).padStart(2, '0')}:`);
  console.log(indent(recite(nightfall, hour)));
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
