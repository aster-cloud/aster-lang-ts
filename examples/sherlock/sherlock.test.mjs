// 《斑点带子案》推理 demo 回归测试（node:test）。
// 跑法（先在 aster-lang-ts 根 `pnpm build` 出 dist/）：
//   node --test examples/sherlock/sherlock.test.mjs
//
// 钉住：
//   ① toCanonical(LayoutMap) === sherlock.aster（忽略尾随换行；显示映射与编译真源不漂移）
//   ② content parity（结构 span 不偷塞字面量）
//   ③ display 是连贯推理独白（含叙事连接词，不含裸 then/else/：）
//   ④ 编译走 canonical → 案卷「斑点带子案」·推断「揪出真凶」
//   ⑤ **真决策**：不同案发线索导出不同结论（有罪结论 / 待查结论 / 兜底，非固定输出）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { compile, evaluate, ZH_CN, initializeAllBundledLexicons } from '../../dist/src/browser.js';
import { SemanticTokenKind as K } from '../../dist/src/config/token-kind.js';
import { toCanonical, toDisplay, verifyContentParity } from '../jingyesi/layout-map.mjs';
import { SHERLOCK_LAYOUT } from './sherlock.layout.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DOMAIN = 'sherlock';
initializeAllBundledLexicons();
const LEX = {
  ...ZH_CN, id: DOMAIN, name: '福尔摩斯',
  aliases: {
    [K.MODULE_DECL]: ['探案笔记'], [K.FUNC_TO]: ['推断'], [K.FUNC_GIVEN]: ['已知'],
    [K.IF]: ['若'], [K.RETURN]: ['凶手即'], [K.AND]: ['且'],
  },
};
const asterFile = readFileSync(join(here, 'sherlock.aster'), 'utf8').replace(/\n+$/, '');

test('① toCanonical === sherlock.aster（忽略尾随换行）', () => {
  assert.equal(toCanonical(SHERLOCK_LAYOUT), asterFile);
});

test('② content parity（结构 span 不偷塞字面量）', () => {
  assert.equal(verifyContentParity(SHERLOCK_LAYOUT).ok, true);
});

test('③ display 是推理独白（无残留语法 then/else，含叙事连接词）', () => {
  const d = toDisplay(SHERLOCK_LAYOUT);
  // 规范的 inline-if 连接词 then/else 必须被渲染掉（它们是语法 token，不该出现在独白里）。
  // 注：中文冒号「：」是叙事标点（「已知这几处疑点：」），非语法残留，不检查。
  assert.ok(!/\bthen\b|\belse\b/.test(d), 'display 不应残留语法 then/else');
  assert.ok(d.includes('则真凶必是'), 'display 应含推理连接词');
  assert.ok(d.includes('继父罗伊洛特'), 'display 应含真凶名');
});

test('④ 编译走 canonical → 案卷「斑点带子案」·推断「揪出真凶」', () => {
  const c = compile(toCanonical(SHERLOCK_LAYOUT), { lexicon: LEX, domain: DOMAIN, tenantId: DOMAIN });
  assert.equal(c.success, true, JSON.stringify(c.parseErrors));
  assert.equal(c.core.name, '斑点带子案');
  assert.equal(c.core.decls[0].name, '揪出真凶');
});

test('⑤ 真决策：不同线索导出不同结论', () => {
  const c = compile(toCanonical(SHERLOCK_LAYOUT), { lexicon: LEX, domain: DOMAIN, tenantId: DOMAIN });
  const rule = c.core.decls[0].name;
  const r1 = evaluate(c.core, rule, { 铃绳通风口: true, 保险箱藏毒蛇: true, 唯继父可入密室: true, 姐姐临终呼斑点带子: true });
  const r2 = evaluate(c.core, rule, { 铃绳通风口: false, 保险箱藏毒蛇: false, 唯继父可入密室: true, 姐姐临终呼斑点带子: true });
  const r3 = evaluate(c.core, rule, { 铃绳通风口: false, 保险箱藏毒蛇: false, 唯继父可入密室: false, 姐姐临终呼斑点带子: true });
  const r4 = evaluate(c.core, rule, { 铃绳通风口: false, 保险箱藏毒蛇: false, 唯继父可入密室: false, 姐姐临终呼斑点带子: false });
  assert.equal(r1.value, '继父罗伊洛特');       // 原案物证 → 定罪
  assert.equal(r2.value, '继父罗伊洛特');       // 仅密室线索（第二条 else-if）→ 定罪
  assert.equal(r3.value, '尚需查证：谁豢养毒蛇'); // 仅遗言（第三条 else-if）→ 待查结论
  assert.equal(r4.value, '疑点未清，尚难定论');   // 线索不足（兜底 else）
  // 四场景导出三种不同结论（定罪 / 待查 / 兜底）→ 证明是真决策而非固定返回。
  assert.equal(new Set([r1.value, r3.value, r4.value]).size, 3);
});
