#!/usr/bin/env node
// 《斑点带子案》—— 一段能运行的福尔摩斯推理。把侦探的推断写成 Aster 决策规则：
// 用**关键词别名**（ADR 0022）把结构词改成推理叙事词（探案笔记/推断/已知/若/凶手即/且），
// 用 **LayoutMap** 把规范源码（含语法必需的 then/else/缩进）在显示层渲染成连贯的推理独白。
// 于是这段文字既读得像福尔摩斯的推理段落，又是货真价实的决策程序——喂入案发线索，
// 它逐条推断，**运行输出真凶**。
//
// 侦探方言别名（结构词 → 推理叙事词）：
//   探案笔记 → Module（立案）      案名 = 斑点带子案
//   推断     → Rule（起一条推断）  规则名 = 揪出真凶
//   已知     → given（列出线索）
//   若       → If
//   且       → and
//   凶手即   → Return（下结论）
// then/else 是 inline-if 的连接词，非 SemanticTokenKind、无法别名，故 canonical 里保留规范
// 拼写；LayoutMap 在显示层把 `then` 渲染成「——则真凶必是」、`else 若` 渲染成「纵此…然」。
//
// 别名 + LayoutMap 都只影响「怎么写/怎么显示」，不影响「编译成什么」：编译永远走 canonical
// （= sherlock.aster），Lexer/Parser/Core IR 完全不知别名与显示排版的存在，故这是真程序。
//
// 运行（先在 aster-lang-ts 根 `pnpm build` 出 dist/）：
//   node examples/sherlock/sherlock.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile, evaluate, ZH_CN, initializeAllBundledLexicons } from '../../dist/src/browser.js';
import { SemanticTokenKind as K } from '../../dist/src/config/token-kind.js';
import { toCanonical, toDisplay, verifyContentParity } from '../jingyesi/layout-map.mjs';
import { SHERLOCK_LAYOUT } from './sherlock.layout.mjs';

initializeAllBundledLexicons();

const DOMAIN = 'sherlock';

// 侦探方言：在 zh-CN 上叠加推理叙事别名，规范拼写不动。
const SHERLOCK = {
  ...ZH_CN,
  id: DOMAIN,
  name: '福尔摩斯',
  aliases: {
    [K.MODULE_DECL]: ['探案笔记'],
    [K.FUNC_TO]: ['推断'],
    [K.FUNC_GIVEN]: ['已知'],
    [K.IF]: ['若'],
    [K.RETURN]: ['凶手即'],
    [K.AND]: ['且'],
  },
};

const here = dirname(fileURLToPath(import.meta.url));
const bar = '─'.repeat(52);

// LayoutMap：canonical（编译真源，= sherlock.aster）↔ display（福尔摩斯推理独白）。
const canonical = toCanonical(SHERLOCK_LAYOUT);
const display = toDisplay(SHERLOCK_LAYOUT);

// 完整性守卫：LayoutMap.canonical 必须与 .aster 一致（忽略尾随换行），且 content parity。
const asterFile = readFileSync(join(here, 'sherlock.aster'), 'utf8').replace(/\n+$/, '');
if (canonical !== asterFile) {
  throw new Error(`LayoutMap.canonical 与 sherlock.aster 不一致：\n  layout=${JSON.stringify(canonical)}\n  file  =${JSON.stringify(asterFile)}`);
}
const parity = verifyContentParity(SHERLOCK_LAYOUT);
if (!parity.ok) throw new Error(`LayoutMap 一致性校验失败：${parity.reason}`);

console.log(bar);
console.log('  《斑点带子案》— 一段能运行的福尔摩斯推理');
console.log(bar);

// ① 显示视图：读者看到的推理独白（LayoutMap display，读起来像小说片段）。
console.log('\n  【推理独白】读者看到的（LayoutMap display）：\n');
for (const line of display.split('\n')) console.log('    ' + line);

// ② 编译视图：底层唯一可编译真源（侦探方言别名 + inline-if，换行/缩进迁就语法）。
console.log('\n  【编译视图】底层规范源码（= sherlock.aster）：\n');
for (const line of canonical.split('\n')) console.log('    ' + (line || ''));
console.log('\n  ↑ 同一段推断：显示层是推理独白，编译层是决策规则。编译走 canonical。');

// 编译成真程序（决策规则）。
const compiled = compile(canonical, { lexicon: SHERLOCK, domain: DOMAIN, tenantId: DOMAIN });
if (!compiled.success || !compiled.core) {
  const diags = (compiled.parseErrors ?? []).map((e) => e.message).join('; ');
  throw new Error(`《斑点带子案》编译失败：${diags || 'unknown error'}`);
}
const rule = compiled.core.decls?.[0]?.name;
console.log('\n' + bar);
console.log(`  编译成决策规则：案卷「${compiled.core.name}」· 推断「${rule}」`);
console.log(bar);

// ③ 喂入案发线索，运行推断 —— 不同线索导出不同真凶（真决策，非固定输出）。
const scenes = [
  { name: '斑点带子案（原案：铃绳直通通风口，保险箱藏毒蛇）', 铃绳通风口: true, 保险箱藏毒蛇: true, 唯继父可入密室: true, 姐姐临终呼斑点带子: true },
  { name: '仅密室线索（铃绳/毒蛇未查实，但唯继父可入密室）', 铃绳通风口: false, 保险箱藏毒蛇: false, 唯继父可入密室: true, 姐姐临终呼斑点带子: true },
  { name: '仅遗言线索（只有姐姐临终呼「斑点带子」）', 铃绳通风口: false, 保险箱藏毒蛇: false, 唯继父可入密室: false, 姐姐临终呼斑点带子: true },
  { name: '线索不足（四处疑点皆未查实）', 铃绳通风口: false, 保险箱藏毒蛇: false, 唯继父可入密室: false, 姐姐临终呼斑点带子: false },
];
console.log('\n  喂入案发线索，运行推断输出真凶：\n');
for (const scene of scenes) {
  const { name, ...clues } = scene;
  const result = evaluate(compiled.core, rule, clues);
  if (!result.success) throw new Error(`推断失败：${result.error}`);
  console.log(`    · ${name}`);
  console.log(`        →  凶手：${String(result.value)}\n`);
}
console.log(bar);
