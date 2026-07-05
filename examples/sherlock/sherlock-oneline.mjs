#!/usr/bin/env node
// 《斑点带子案》单行化变体 —— ADR 0028 显式块分隔符的价值演示。
//
// 同一段福尔摩斯推理，用**显式块分隔符**（块结束词「毕」）让整个函数体压成**一行**：源码
// 摆脱了缩进约束，可任意排版/单行化，而仍编译运行输出真凶。
//
// 对照 sherlock.mjs（缩进块 + LayoutMap 诗化展示）：那证明「显示自由」（LayoutMap，显示层）；
// 本变体证明「**源码本身**可单行化」（ADR 0028，语言层）——两条互补路径（见 ADR 0028 §8）。
//
// 关键：块结束词「毕」是 zh 方言配的中文词（同脚本约束，ADR 0028 §6：块结束词须所在 lexicon
// 可 lex，zh 配中文、en 配英文）。默认无 blockDelimiters 时「毕」是普通标识符（向后兼容）。
//
// 运行（先在 aster-lang-ts 根 `pnpm build`）：
//   node examples/sherlock/sherlock-oneline.mjs
import { compile, evaluate, ZH_CN, initializeAllBundledLexicons } from '../../dist/src/browser.js';
import { SemanticTokenKind as K } from '../../dist/src/config/token-kind.js';

initializeAllBundledLexicons();
const DOMAIN = 'sherlock-oneline';

// 侦探方言 + 显式块开启（blockDelimiters.end=['毕']）。
const SHERLOCK = {
  ...ZH_CN,
  id: DOMAIN,
  name: '福尔摩斯',
  blockDelimiters: { end: ['毕'] },
  aliases: {
    [K.MODULE_DECL]: ['探案笔记'],
    [K.FUNC_TO]: ['推断'],
    [K.FUNC_GIVEN]: ['已知'],
    [K.IF]: ['若'],
    [K.RETURN]: ['凶手即'],
    [K.AND]: ['且'],
  },
};

// ★单行化的显式块源码：整个函数体（4 分支决策链）压成**一行**，以「毕」收尾。
// module header 单独一行（顶层声明之间靠换行分隔，这是 Aster 顶层结构，非本特性范围）；
// 函数体则完全单行——这是 ADR 0028 显式块让源码摆脱缩进的直接体现。
const source =
  '探案笔记 斑点带子案。\n'
  + '推断 揪出真凶 已知 铃绳通风口，保险箱藏毒蛇，唯继父可入密室，姐姐临终呼斑点带子，产出：'
  + '若 铃绳通风口 且 保险箱藏毒蛇 then 凶手即 "继父罗伊洛特" '
  + 'else 若 唯继父可入密室 then 凶手即 "继父罗伊洛特" '
  + 'else 若 姐姐临终呼斑点带子 then 凶手即 "尚需查证：谁豢养毒蛇" '
  + 'else 凶手即 "疑点未清，尚难定论"。毕';

const bar = '─'.repeat(52);
console.log(bar);
console.log('  《斑点带子案》— 单行化变体（ADR 0028 显式块分隔符）');
console.log(bar);

console.log('\n  【源码】整个函数体一行，以「毕」收尾（脱离缩进）：\n');
for (const line of source.split('\n')) {
  // 长行折行显示（仅显示折行，源码本身是单行）
  console.log('    ' + line);
}

const compiled = compile(source, { lexicon: SHERLOCK, domain: DOMAIN, tenantId: DOMAIN });
if (!compiled.success || !compiled.core) {
  const diags = (compiled.parseErrors ?? []).map((e) => e.message).join('; ');
  throw new Error(`单行化编译失败：${diags || 'unknown error'}`);
}
const rule = compiled.core.decls?.[0]?.name;
console.log('\n' + bar);
console.log(`  编译成决策规则：案卷「${compiled.core.name}」· 推断「${rule}」`);
console.log(bar);

const scenes = [
  { name: '原案物证（铃绳直通通风口 + 保险箱藏毒蛇）', 铃绳通风口: true, 保险箱藏毒蛇: true, 唯继父可入密室: true, 姐姐临终呼斑点带子: true },
  { name: '仅密室线索', 铃绳通风口: false, 保险箱藏毒蛇: false, 唯继父可入密室: true, 姐姐临终呼斑点带子: true },
  { name: '仅遗言线索', 铃绳通风口: false, 保险箱藏毒蛇: false, 唯继父可入密室: false, 姐姐临终呼斑点带子: true },
  { name: '线索不足', 铃绳通风口: false, 保险箱藏毒蛇: false, 唯继父可入密室: false, 姐姐临终呼斑点带子: false },
];
console.log('\n  喂入案发线索，运行推断输出真凶：\n');
for (const scene of scenes) {
  const { name, ...clues } = scene;
  const result = evaluate(compiled.core, rule, clues);
  if (!result.success) throw new Error(`推断失败：${result.error}`);
  console.log(`    · ${name}\n        →  凶手：${String(result.value)}\n`);
}
console.log(bar);
console.log('  单行源码 + 显式块「毕」→ 与缩进块编译到同一决策规则，运行结果一致。');
console.log(bar);
