/**
 * 推断命名规则副本 shared/type-inference-naming-rules.json 与 aster-lang-locales 真相源
 * type-inference/naming-rules.json 逐字节相同（ADR 0056 §3.2，副本模式同 ADR 0045 §2.2）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { locateLocalesTypeInference } from '../../helpers/locales-type-inference.js';

test('naming-rules 副本与 locales 真相源逐字节相同', (t) => {
  const source = locateLocalesTypeInference('naming-rules.json');
  if (source === undefined) return t.skip('本地未并列 checkout aster-lang-locales');
  const copy = readFileSync(join(process.cwd(), 'shared', 'type-inference-naming-rules.json'));
  const expected = readFileSync(source);
  assert.deepEqual(JSON.parse(copy.toString('utf8')), JSON.parse(expected.toString('utf8')));
  assert.ok(copy.equals(expected), '整文件复制同步：副本须与真相源逐字节相同');
});

test('naming-rules.generated.ts 与 shared 副本同步', async () => {
  const { NAMING_RULES_PATH, NAMING_RULES_MODULE_PATH, renderNamingRulesModule } = await import(
    '../../../scripts/generate-naming-rules.js'
  );
  const { NAMING_RULES } = await import('../../../src/parser/naming-rules.generated.js');
  const shared = JSON.parse(readFileSync(join(process.cwd(), NAMING_RULES_PATH), 'utf8')) as unknown;
  assert.equal(readFileSync(join(process.cwd(), NAMING_RULES_MODULE_PATH), 'utf8'), renderNamingRulesModule(shared),
    '重新运行 node dist/scripts/generate-naming-rules.js 并提交生成物');
  assert.deepEqual(NAMING_RULES, shared);
});
