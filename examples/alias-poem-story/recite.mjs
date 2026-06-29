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
import { recite, BARD_EN } from './bard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'nightfall.ballad.aster'), 'utf8');

const bar = '─'.repeat(64);
console.log(bar);
console.log('  NIGHTFALL — a runnable ballad, written in the Bard dialect');
console.log(`  (custom lexicon "${BARD_EN.name}" aliases Aster keywords:`);
console.log('   Module→Ballad  Rule→Verse  given→of  Let→let  be→become  If→where');
console.log('   Return→sing  plus→then(join)  at most→but  at least→past  minus→less');
console.log('   — types omitted (inferred); the closing verse joins across lines (ADR 0026))');
console.log(bar);
console.log('\nThe source reads as verse, yet compiles + runs on the real engine:\n');
for (const line of source.trimEnd().split('\n')) console.log('   ' + line);
console.log('\n' + bar);
console.log('  Reciting at three hours — the same poem, three fates:');
console.log(bar);

const arg = Number.parseInt(process.argv[2] ?? '', 10);
const hours = Number.isInteger(arg) ? [arg] : [8, 19, 23];
for (const hour of hours) {
  console.log(`\n  ⏾ hour ${String(hour).padStart(2, '0')}:`);
  console.log('    ' + recite(source, hour));
}
console.log('');
