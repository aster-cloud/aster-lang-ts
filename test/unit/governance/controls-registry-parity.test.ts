import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTROLS_REGISTRY } from '../../../src/governance/controls-registry.data.js';
import { locateSiblingSource } from '../../helpers/sibling-source.js';

// 内置副本与真相源深度相等（ADR 0045 §2.2）。候选依次为：本地兄弟 locales、CI 子目录 locales、
// CI 已 checkout 的 core classpath 副本（core 侧有自己的 locales 一致性门禁，故传递相等）。
// CI 中全部缺失即失败；本地未并列 checkout 时跳过。
test('controls 副本与真相源一致', (t) => {
  const cwd = process.cwd();
  const source = locateSiblingSource(
    [
      join(cwd, '..', 'aster-lang-locales', 'controls', 'registry.json'),
      join(cwd, 'aster-lang-locales', 'controls', 'registry.json'),
      join(cwd, 'aster-lang-core', 'src', 'main', 'resources', 'governance', 'controls-registry.json'),
    ],
    'aster-lang-locales 或 aster-lang-core 以校验控制项注册表副本一致性',
  );
  if (source === undefined) return t.skip('本地未并列 checkout aster-lang-locales');
  assert.deepEqual(CONTROLS_REGISTRY, JSON.parse(readFileSync(source, 'utf8')));
});

test('CI 中真相源缺失即失败而非跳过', () => {
  const missing = [join(process.cwd(), 'no-such-dir', 'registry.json')];
  assert.equal(locateSiblingSource(missing, 'x', {}), undefined);
  assert.equal(locateSiblingSource(missing, 'x', { CI: '' }), undefined);
  assert.throws(() => locateSiblingSource(missing, 'x', { CI: 'true' }), /CI 中必须 checkout x/);
  assert.throws(() => locateSiblingSource(missing, 'x', { GITHUB_ACTIONS: 'true' }), /CI 中必须 checkout x/);
});
