import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule } from '../../../src/typecheck.js';
import { controlRegistryFrom } from '../../../src/governance/controls.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import type { ControlRegistry } from '../../../src/governance/controls.js';
import type { ControlsRegistryData } from '../../../src/governance/controls-registry.data.js';
import type { Module as AstModule } from '../../../src/types.js';

// 注册表档案读取：与 Java ControlRegistryTest 的档案用例逐条对应（规则同 locales 校验口径）。
// 注入的注册表可能来自运行时 JSON，故以 unknown 构造畸形输入。

function registryWithProfiles(profiles: unknown): ControlRegistry {
  return controlRegistryFrom({
    version: '9',
    frameworks: [{ id: 'EU_AI_ACT', title: { en: 'a', zh: 'a', de: 'a' } }],
    controls: [{ key: 'EU_AI_ACT:ART14', framework: 'EU_AI_ACT', article: '14', title: { en: 'a', zh: 'a', de: 'a' } }],
    clauses: [],
    profiles,
  } as unknown as ControlsRegistryData);
}

function profile(id: unknown, ruleId: unknown, registered: unknown, frameworks: unknown): Record<string, unknown> {
  const requires = { ruleId, registeredControls: registered, frameworks };
  return id === undefined ? { requires } : { id, requires };
}

function profileIds(r: ControlRegistry, candidates: readonly string[]): string[] {
  return candidates.filter((id) => r.profile?.(id) !== undefined);
}

test('合法档案照常登记', () => {
  const hr = registryWithProfiles([profile('hr', true, false, ['EU_AI_ACT'])]).profile?.('hr');
  assert.deepEqual(hr, { id: 'hr', ruleId: true, registeredControls: false, frameworks: ['EU_AI_ACT'] });
});

test('畸形档案不登记且不影响其它档案', () => {
  const good = profile('ok', true, true, []);
  const bad: unknown[] = [
    profile(undefined, true, true, []),
    profile(42, true, true, []),
    profile('Bad_Id', true, true, []),
    profile('x' + 'a'.repeat(64), true, true, []),
    profile('bad', 'yes', true, []),
    profile('bad', true, 1, []),
    profile('bad', true, true, 'EU_AI_ACT'),
    profile('bad', true, true, ['NOPE']),
    profile('bad', true, true, [7]),
    { id: 'bad' },
  ];
  const candidates = ['ok', 'bad', 'Bad_Id', 'x' + 'a'.repeat(64), '42'];
  for (const b of bad) {
    assert.deepEqual(profileIds(registryWithProfiles([good, b]), candidates), ['ok'], JSON.stringify(b));
  }
});

test('重复档案 id 全部不登记', () => {
  const r = registryWithProfiles([profile('dup', true, true, []), profile('dup', false, false, []), profile('ok', true, true, [])]);
  assert.equal(r.profile?.('dup'), undefined);
  assert.notEqual(r.profile?.('ok'), undefined);
});

test('profiles 不是数组抛出', () => {
  assert.throws(() => registryWithProfiles({}), /profiles/);
});

test('profiles 为 null 视为无档案', () => {
  assert.equal(registryWithProfiles(null).profile?.('governed'), undefined);
});

test('声明畸形档案的模块得到 E705', () => {
  const r = registryWithProfiles([profile('acme', true, true, ['NOPE'])]);
  const src = 'Module m.\nProfile "acme".\n\nRule r produce Int:\n  Return 1.\n';
  const diags = typecheckModule(lowerModule(parse(lex(canonicalize(src))).ast as AstModule), { controls: r });
  assert.equal(diags.filter((d) => d.code === ErrorCode.GOV_PROFILE_UNKNOWN).length, 1, JSON.stringify(diags));
});

// 根 frameworks 形态不可信：非数组、null/非对象条目、空白 id 都不抛出，只是不计入已登记框架
function registryWithFrameworks(frameworks: unknown): ControlRegistry {
  return controlRegistryFrom({
    version: '9',
    frameworks,
    controls: [],
    clauses: [],
    profiles: [profile('ok', true, true, []), profile('blank', true, true, ['']), profile('eu', true, true, ['EU_AI_ACT'])],
  } as unknown as ControlsRegistryData);
}

test('根 frameworks 畸形时不抛出，畸形条目与空白 id 不计入', () => {
  const variants: unknown[] = [
    'EU_AI_ACT',
    null,
    [null, 7, 'EU_AI_ACT', { id: '' }, { id: '   ' }, { id: 3 }],
  ];
  for (const fws of variants) {
    const r = registryWithFrameworks(fws);
    assert.deepEqual(profileIds(r, ['ok', 'blank', 'eu']), ['ok'], JSON.stringify(fws));
  }
  const good = registryWithFrameworks([null, { id: ' ' }, { id: 'EU_AI_ACT' }]);
  assert.deepEqual(profileIds(good, ['ok', 'blank', 'eu']), ['ok', 'eu']);
});

// 空白的确切定义：只由 ASCII 空白（空格 \t \n \v \f \r，即 Java 正则默认的 \s）组成；
// 其它 Unicode 空白（如 NBSP）不算空白，id 照常登记，以便 Java 用 id.matches("\\s*") 得到同一结果
test('空白 id 只按 ASCII 空白判定', () => {
  for (const blank of ['', ' ', '\t\n\v\f\r ']) {
    const r = controlRegistryFrom({
      version: '9', frameworks: [{ id: blank }], controls: [], clauses: [],
      profiles: [profile('p', true, true, [blank])],
    } as unknown as ControlsRegistryData);
    assert.equal(r.profile?.('p'), undefined, JSON.stringify(blank));
  }
  const nbsp = controlRegistryFrom({
    version: '9', frameworks: [{ id: ' ' }], controls: [], clauses: [],
    profiles: [profile('p', true, true, [' '])],
  } as unknown as ControlsRegistryData);
  assert.deepEqual(nbsp.profile?.('p')?.frameworks, [' ']);
});
