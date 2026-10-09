import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlCompletions } from '../../../src/lsp/completion.js';

test('@control(" 处补全全部注册表键', () => {
  const items = controlCompletions('@control("');
  assert.ok(items);
  assert.deepEqual(items!.map((i) => i.label).sort(), ['EU_AI_ACT:ART14', 'GDPR:ART17', 'GDPR:ART22', 'GDPR:ART6', 'SOX:404']);
});

test('按已输入前缀过滤，detail 为英文标题', () => {
  const items = controlCompletions('  @control( "GDPR:ART2');
  assert.deepEqual(items!.map((i) => i.label), ['GDPR:ART22']);
  assert.equal(items![0]!.detail, 'Automated individual decision-making');
});

test('非 @control 字符串上下文返回 null', () => {
  assert.equal(controlCompletions('@id("'), null);
  assert.equal(controlCompletions('Rule main'), null);
});
