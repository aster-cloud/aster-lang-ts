import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CORE_IR_SCHEMA_MODULE_PATH,
  CORE_IR_SCHEMA_PATH,
  CORE_IR_TYPES_PATH,
  renderCoreIrSchemaModule,
  renderCoreIrTypes,
} from '../../../scripts/generate-core-ir-types.js';
import { CORE_IR_V2_SCHEMA } from '../../../src/core/core-ir-v2.schema.generated.js';
import { locateLocalesCoreIr } from '../../helpers/locales-core-ir.js';

// ADR 0055 §3：shared/ 副本与 aster-lang-locales 真相源深度相等，生成物与副本同步。
const root = process.cwd();
const readRepo = (p: string): string => readFileSync(join(root, p), 'utf8');
const sharedSchema = (): Record<string, unknown> => JSON.parse(readRepo(CORE_IR_SCHEMA_PATH)) as Record<string, unknown>;

test('schema copy equals locales source', (t) => {
  const source = locateLocalesCoreIr('core-ir.v2.schema.json');
  if (source === undefined) return t.skip('本地未并列 checkout aster-lang-locales');
  assert.deepEqual(sharedSchema(), JSON.parse(readFileSync(source, 'utf8')));
});

test('generated types are fresh', async () => {
  assert.equal(readRepo(CORE_IR_TYPES_PATH), await renderCoreIrTypes(sharedSchema()),
    '重新运行 node dist/scripts/generate-core-ir-types.js 并提交生成物');
});

test('generated schema module is fresh and equals the shared copy', () => {
  assert.equal(readRepo(CORE_IR_SCHEMA_MODULE_PATH), renderCoreIrSchemaModule(sharedSchema()),
    '重新运行 node dist/scripts/generate-core-ir-types.js 并提交生成物');
  assert.deepEqual(CORE_IR_V2_SCHEMA, sharedSchema());
});
