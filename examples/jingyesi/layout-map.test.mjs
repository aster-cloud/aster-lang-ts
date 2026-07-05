// LayoutMap 不变式回归测试（node:test）。
// 跑法（先在 aster-lang-ts 根 `pnpm build` 出 dist/）：
//   node --test examples/jingyesi/layout-map.test.mjs
//
// 钉住三条不变式：
//   ① toCanonical(LayoutMap) === jingyesi.aster（忽略尾随换行后相等；映射与编译真源不漂移）
//   ② toDisplay(LayoutMap) === 李白原诗工整四句 + 内容 token 两视图一致（显示层不增删诗词）
//   ③ 编译走 canonical → 与直接编译 jingyesi.aster 产出同一 Core IR、运行同一结果
//      （显示自由排版无损编译/运行/确定性）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { compile, evaluate, ZH_CN, initializeAllBundledLexicons } from '../../dist/src/browser.js';
import { SemanticTokenKind as K } from '../../dist/src/config/token-kind.js';
import { vocabularyRegistry, initBuiltinVocabularies } from '../../dist/src/config/lexicons/identifiers/registry.js';
import { toCanonical, toDisplay, verifyContentParity } from './layout-map.mjs';
import { JINGYESI_LAYOUT } from './jingyesi.layout.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DOMAIN = 'jingyesi';

initializeAllBundledLexicons();
initBuiltinVocabularies?.();
const LEX = {
  ...ZH_CN, id: DOMAIN, name: '静夜思',
  aliases: { [K.MODULE_DECL]: ['床前'], [K.FUNC_TO]: ['疑是'], [K.FUNC_PRODUCE]: ['举头'], [K.RETURN]: ['低头'] },
};
vocabularyRegistry.registerCustom(DOMAIN, {
  id: DOMAIN, name: '静夜思', locale: DOMAIN, version: '1.0.0',
  structs: [], fields: [], functions: [], enumValues: [],
  literals: [{ localized: '思故乡', canonical: '静夜思', kind: 'literal' }],
});

const asterFile = readFileSync(join(here, 'jingyesi.aster'), 'utf8').replace(/\n+$/, '');

test('① toCanonical === jingyesi.aster（忽略尾随换行）', () => {
  assert.equal(toCanonical(JINGYESI_LAYOUT), asterFile);
});

test('② display 是李白原诗工整四句 + 内容一致', () => {
  const display = toDisplay(JINGYESI_LAYOUT);
  assert.equal(display, '床前 明月光，\n疑是 地上霜。\n举头 望明月，\n低头 思故乡。');
  // 四句、每句一行（display 的换行独立于 canonical）。
  assert.equal(display.split('\n').length, 4);
  assert.equal(verifyContentParity(JINGYESI_LAYOUT).ok, true);
});

test('③ 编译走 canonical → 模块「明月光」·函数「地上霜」，运行输出「静夜思」', () => {
  const canonical = toCanonical(JINGYESI_LAYOUT);
  const compiled = compile(canonical, { lexicon: LEX, domain: DOMAIN, tenantId: DOMAIN });
  assert.equal(compiled.success, true, JSON.stringify(compiled.parseErrors));
  assert.equal(compiled.core.name, '明月光');
  const rule = compiled.core.decls[0].name;
  assert.equal(rule, '地上霜');
  const result = evaluate(compiled.core, rule, {});
  assert.equal(result.success, true);
  assert.equal(result.value, '静夜思');
});

test('④ 反例守卫：结构 span 的 canonical 偷塞字符串字面量应被拒绝', () => {
  // 模型放宽后（支持侦探 demo 的结构关键词），verifyContentParity 只堵最危险的偷塞路径：
  // 结构 span 的 canonical 塞字面量 → 能编译出 display 里读不到的字符串（显示欺骗）。
  const bad = [{ text: '床前 明月光' }, { canonical: '。\n返回 "偷偷加的".', display: '，\n' }, { text: '疑是 地上霜' }];
  assert.equal(verifyContentParity(bad).ok, false);
});
