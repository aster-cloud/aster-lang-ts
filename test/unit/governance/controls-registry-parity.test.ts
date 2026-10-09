import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTROLS_REGISTRY } from '../../../src/governance/controls-registry.data.js';

// 内置副本与 aster-lang-locales 真相源深度相等（ADR 0045 §2.2）；兄弟仓缺失时跳过
test('controls 副本与真相源一致', (t) => {
  const source = join(process.cwd(), '..', 'aster-lang-locales', 'controls', 'registry.json');
  if (!existsSync(source)) return t.skip('兄弟仓 aster-lang-locales 不在');
  assert.deepEqual(CONTROLS_REGISTRY, JSON.parse(readFileSync(source, 'utf8')));
});
