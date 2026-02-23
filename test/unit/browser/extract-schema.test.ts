import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractSchema } from '../../../src/browser.js';

describe('extractSchema', () => {
  it('应提取基本类型参数', () => {
    const source = `
Module test.schema.basic.

Rule greet given name as Text, age as Int, produce Text:
  Return name.
`;
    const result = extractSchema(source);
    assert.ok(result.success);
    assert.equal(result.parameters!.length, 2);
    assert.equal(result.parameters![0]!.name, 'name');
    assert.equal(result.parameters![0]!.type, 'Text');
    assert.equal(result.parameters![0]!.typeKind, 'primitive');
    assert.equal(result.parameters![1]!.name, 'age');
    assert.equal(result.parameters![1]!.type, 'Int');
    assert.equal(result.parameters![1]!.typeKind, 'primitive');
  });

  it('应提取结构体参数及字段', () => {
    const source = `
Module test.schema.struct.

Define User has name as Text, age as Int.

Rule process given user as User, produce Text:
  Return user.name.
`;
    const result = extractSchema(source);
    assert.ok(result.success);
    assert.equal(result.parameters!.length, 1);
    const param = result.parameters![0]!;
    assert.equal(param.name, 'user');
    assert.equal(param.type, 'User');
    assert.equal(param.typeKind, 'struct');
    assert.ok(param.fields);
    assert.equal(param.fields!.length, 2);
    assert.equal(param.fields![0]!.name, 'name');
    assert.equal(param.fields![0]!.type, 'Text');
    assert.equal(param.fields![1]!.name, 'age');
    assert.equal(param.fields![1]!.type, 'Int');
  });

  it('应提取枚举类型信息', () => {
    const source = `
Module test.schema.enum.

Define Status as one of Pending, Approved, Rejected.

Rule check given status as Status, produce Bool:
  Return true.
`;
    const result = extractSchema(source);
    assert.ok(result.success);
    assert.equal(result.parameters!.length, 1);
    // 枚举在 extractSchema 中被识别为非基本类型
    const param = result.parameters![0]!;
    assert.equal(param.name, 'status');
    assert.equal(param.type, 'Status');
  });

  it('应在多函数模块中选取第一个函数', () => {
    const source = `
Module test.schema.multi.

Rule first given a as Int, produce Int:
  Return a.

Rule second given b as Text, produce Text:
  Return b.
`;
    const result = extractSchema(source);
    assert.ok(result.success);
    assert.equal(result.functionName, 'first');
    assert.equal(result.parameters!.length, 1);
    assert.equal(result.parameters![0]!.name, 'a');
  });

  it('应通过 functionName 选项指定目标函数', () => {
    const source = `
Module test.schema.target.

Rule first given a as Int, produce Int:
  Return a.

Rule second given b as Text, produce Text:
  Return b.
`;
    const result = extractSchema(source, { functionName: 'second' });
    assert.ok(result.success);
    assert.equal(result.functionName, 'second');
    assert.equal(result.parameters!.length, 1);
    assert.equal(result.parameters![0]!.name, 'b');
    assert.equal(result.parameters![0]!.type, 'Text');
  });

  it('应在无函数时返回错误', () => {
    const source = `
Module test.schema.nofunc.

Define User has name as Text.
`;
    const result = extractSchema(source);
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  it('应返回模块名', () => {
    const source = `
Module my.app.

Rule main, produce Int:
  Return 42.
`;
    const result = extractSchema(source);
    assert.ok(result.success);
    assert.equal(result.moduleName, 'my.app');
  });
});
