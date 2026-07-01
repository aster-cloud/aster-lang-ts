#!/usr/bin/env node
// 《静夜思》— 李白。把整首诗按**原词序**当作 Aster Lang 源码：诗句领字做关键词别名
// （ADR 0022），末句「思故乡」用**字面量宏**（IdentifierKind.LITERAL）展开成 "静夜思"。
// 于是四句诗既是诗、又是一段能被生产同款引擎逐字编译执行的程序；运行它，输出诗名「静夜思」。
//
// 别名（诗句领字 → Aster 关键词）：
//   床前 → Module（立篇）      模块名 = 明月光
//   疑是 → Rule（起一首）      函数名 = 地上霜
//   举头 → produce（产出）     返回类型 = 望明月（Text 的诗意名，类型由用法推断）
//   低头 → Return（归于所思）
// 字面量宏（token → 字符串字面量）：
//   思故乡 → 内容「静夜思」    canonicalize 时 `低头 思故乡。` 展开成 `Return "静夜思".`
//
// 别名 + 字面量宏都只在 canonicalize 阶段生效，Lexer/Parser/Core IR 完全不知其存在，
// 故「诗版」与规范版编译到结构一致的 Core IR，是货真价实的程序（非打印诗句）。
//
// 运行（先在 aster-lang-ts 根 `pnpm build` 出 dist/）：
//   node examples/jingyesi/jingyesi.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile, evaluate, ZH_CN, initializeAllBundledLexicons } from '../../dist/src/browser.js';
import { SemanticTokenKind as K } from '../../dist/src/config/token-kind.js';
import { vocabularyRegistry, initBuiltinVocabularies } from '../../dist/src/config/lexicons/identifiers/registry.js';

initializeAllBundledLexicons();
initBuiltinVocabularies?.();

const DOMAIN = 'jingyesi';

// 静夜思方言：在 zh-CN 上叠加诗句关键词别名，规范拼写不动。
const JINGYESI = {
  ...ZH_CN,
  id: DOMAIN,
  name: '静夜思',
  aliases: {
    [K.MODULE_DECL]: ['床前'],
    [K.FUNC_TO]: ['疑是'],
    [K.FUNC_PRODUCE]: ['举头'],
    [K.RETURN]: ['低头'],
  },
};

// 字面量宏词汇表：思故乡 → 内容「静夜思」（kind = literal）。
// 注：compile 用 lexicon.id 作 locale 查词汇，故 vocab.locale 对齐 lexicon.id。
vocabularyRegistry.registerCustom(DOMAIN, {
  id: DOMAIN,
  name: '静夜思',
  locale: DOMAIN,
  version: '1.0.0',
  structs: [],
  fields: [],
  functions: [],
  enumValues: [],
  literals: [{ localized: '思故乡', canonical: '静夜思', kind: 'literal' }],
});

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'jingyesi.aster'), 'utf8');
const bar = '─'.repeat(48);

console.log(bar);
console.log('  《静夜思》— 李白   ·   这首诗就是 Aster Lang 源码');
console.log(bar);
console.log('\n  原诗：');
console.log('    床前明月光，疑是地上霜。');
console.log('    举头望明月，低头思故乡。\n');
console.log('  作为源码逐字读（原词序即程序）：\n');
for (const line of source.trimEnd().split('\n')) console.log('    ' + (line || ''));

// 编译：诗句 → 规范化（别名 + 字面量宏 思故乡→"静夜思"）→ Core IR（真程序）。
const compiled = compile(source, { lexicon: JINGYESI, domain: DOMAIN, tenantId: DOMAIN });
if (!compiled.success || !compiled.core) {
  const diags = (compiled.parseErrors ?? []).map((e) => e.message).join('; ');
  throw new Error(`《静夜思》编译失败：${diags || 'unknown error'}`);
}

const rule = compiled.core.decls?.[0]?.name;
console.log('\n' + bar);
console.log(`  编译成真程序：模块「${compiled.core.name}」· 函数「${rule}」`);
console.log(bar);

// 执行入口函数（rule 地上霜）。
const result = evaluate(compiled.core, rule, {});
if (!result.success) throw new Error(`《静夜思》运行失败：${result.error}`);

console.log('\n  运行诗句构造的源码，输出该诗的名字：\n');
console.log('      →  ' + String(result.value) + '\n');
console.log(bar);
