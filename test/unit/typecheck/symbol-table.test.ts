/**
 * SymbolTable 单元测试
 *
 * 覆盖作用域遮蔽、捕获标记、类型别名展开与 Scope 管理等关键路径，以提升 symbol_table.ts 行覆盖率。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SymbolTable, DuplicateSymbolError } from '../../../src/typecheck/symbol_table.js';
import { Core } from '../../../src/core/core_ir.js';
import type { SymbolInfo } from '../../../src/typecheck/symbol_table.js';
import type { Core as CoreTypes, PiiDataCategory } from '../../../src/types.js';

const typeName = (name: string): CoreTypes.TypeName => Core.TypeName(name);
const maybeType = (inner: CoreTypes.Type): CoreTypes.Maybe => Core.Maybe(inner);
const optionType = (inner: CoreTypes.Type): CoreTypes.Option => Core.Option(inner);
const listType = (inner: CoreTypes.Type): CoreTypes.List => Core.List(inner);
const mapType = (key: CoreTypes.Type, val: CoreTypes.Type): CoreTypes.Map => Core.Map(key, val);
const typeApp = (base: string, args: readonly CoreTypes.Type[]): CoreTypes.TypeApp => Core.TypeApp(base, args);
const piiType = (baseType: CoreTypes.Type, sensitivity: 'L1' | 'L2' | 'L3', category: PiiDataCategory): CoreTypes.PiiType =>
  Core.Pii(baseType, sensitivity, category);
const resultType = (ok: CoreTypes.Type, err: CoreTypes.Type): CoreTypes.Result => Core.Result(ok, err);

const defineVar = (table: SymbolTable, name: string, type: CoreTypes.Type): void => {
  table.define(name, type, 'var');
};

describe('SymbolTable', () => {
  describe('遮蔽与重复定义', () => {
    it('同一作用域重复定义应抛出 DuplicateSymbolError', () => {
      const table = new SymbolTable();
      defineVar(table, 'value', typeName('Int'));

      assert.throws(() => {
        defineVar(table, 'value', typeName('Text'));
      }, DuplicateSymbolError);
    });

    it('嵌套作用域遮蔽应触发 onShadow 并设置 shadowedFrom', () => {
      const table = new SymbolTable();
      defineVar(table, 'shadowed', typeName('Int'));
      const outer = table.lookup('shadowed');
      assert.ok(outer, '外层符号应该存在');

      const shadowEvents: Array<{ current: SymbolInfo; shadowed: SymbolInfo }> = [];
      table.enterScope('function');
      table.define('shadowed', typeName('Text'), 'var', {
        onShadow(current, shadowed) {
          shadowEvents.push({ current, shadowed });
        },
      });

      const inner = table.lookupInCurrentScope('shadowed');
      assert.ok(inner, '内层遮蔽符号应该被存储在当前作用域');

      assert.strictEqual(shadowEvents.length, 1, 'onShadow 回调应被调用一次');
      assert.strictEqual(shadowEvents[0]?.current, inner);
      assert.strictEqual(shadowEvents[0]?.shadowed, outer);
      assert.strictEqual(inner.shadowedFrom, outer);
    });
  });

  describe('捕获标记', () => {
    it('markCaptured 与 getCapturedSymbols 应暴露闭包捕获信息', () => {
      const table = new SymbolTable();
      defineVar(table, 'outer', typeName('Int'));

      table.enterScope('lambda');
      table.markCaptured('outer');
      table.exitScope();

      const captured = table.getCapturedSymbols();
      assert.strictEqual(captured.length, 1, '捕获列表应包含被标记的符号');
      assert.strictEqual(captured[0]?.name, 'outer');
      assert.strictEqual(captured[0]?.captured, true);
      assert.strictEqual(table.lookup('outer')?.captured, true, '符号实例本身应被标记为 captured');
    });
  });

  describe('Scope 管理', () => {
    it('lookup 与 lookupInCurrentScope 应区分作用域', () => {
      const table = new SymbolTable();
      defineVar(table, 'global', typeName('Int'));

      table.enterScope('function');
      defineVar(table, 'local', typeName('Bool'));

      assert.ok(table.lookup('global'), 'lookup 应可穿透到父作用域');
      assert.strictEqual(table.lookupInCurrentScope('global'), undefined, 'lookupInCurrentScope 仅在当前作用域查找');

      assert.ok(table.lookupInCurrentScope('local'));
      table.exitScope();

      assert.ok(table.lookup('global'));
      assert.strictEqual(table.lookup('local'), undefined, '退出子作用域后局部符号应不可见');
    });

    it('exitScope 在 root 作用域应抛出错误', () => {
      const table = new SymbolTable();
      assert.throws(() => table.exitScope(), { message: 'Cannot exit root scope' });
    });
  });

  describe('类型别名', () => {
    it('resolveTypeAlias 应展开别名并缓存结果', () => {
      const table = new SymbolTable();
      table.defineTypeAlias('AliasInt', typeName('Int'));
      table.defineTypeAlias('MaybeAlias', maybeType(typeName('AliasInt')));

      const first = table.resolveTypeAlias('MaybeAlias');
      assert.ok(first, '第一次解析应返回 Maybe 类型');
      assert.strictEqual(first.kind, 'Maybe');
      assert.strictEqual((first.type as CoreTypes.TypeName).name, 'Int');

      const second = table.resolveTypeAlias('MaybeAlias');
      assert.strictEqual(first, second, 'aliasCache 应返回同一对象以证明缓存生效');
    });

    it('resolveTypeAlias 应检测循环别名', () => {
      const table = new SymbolTable();
      table.defineTypeAlias('A', typeName('B'));
      table.defineTypeAlias('B', typeName('A'));

      const resolved = table.resolveTypeAlias('A');
      assert.ok(resolved, '循环别名应返回原始 TypeName 以防止无限递归');
      assert.strictEqual(resolved.kind, 'TypeName');
      assert.strictEqual(resolved.name, 'A');
    });

    it('expandAliasType 应递归展开 TypeApp/FuncType/PiiType 等复合结构', () => {
      const table = new SymbolTable();
      table.defineTypeAlias('UserId', typeName('Int'));
      table.defineTypeAlias('MaybeUserId', maybeType(typeName('UserId')));
      table.defineTypeAlias('OptionalUserList', optionType(listType(typeName('MaybeUserId'))));

      const complexFunc: CoreTypes.FuncType = {
        kind: 'FuncType',
        params: [
          typeApp('Wrapper', [
            typeName('MaybeUserId'),
            mapType(typeName('UserId'), typeName('MaybeUserId')),
          ]),
          piiType(
            resultType(typeName('OptionalUserList'), typeName('Error')),
            'L2',
            'email'
          ),
        ],
        ret: resultType(typeName('UserId'), listType(typeName('MaybeUserId'))),
      };

      table.defineTypeAlias('ComplexAlias', complexFunc);
      const resolved = table.resolveTypeAlias('ComplexAlias');
      assert.ok(resolved && resolved.kind === 'FuncType', '函数别名应成功解析');

      const params = resolved.params as readonly CoreTypes.Type[];
      const expandedTypeApp = params[0] as CoreTypes.TypeApp;
      assert.strictEqual(expandedTypeApp.kind, 'TypeApp');
      const firstArg = expandedTypeApp.args[0] as CoreTypes.Maybe;
      assert.strictEqual(firstArg.kind, 'Maybe');
      assert.strictEqual((firstArg.type as CoreTypes.TypeName).name, 'Int', 'TypeApp 参数应展开别名');

      const secondArg = expandedTypeApp.args[1] as CoreTypes.Map;
      assert.strictEqual((secondArg.key as CoreTypes.TypeName).name, 'Int');
      assert.strictEqual(((secondArg.val as CoreTypes.Maybe).type as CoreTypes.TypeName).name, 'Int');

      const piiParam = params[1] as CoreTypes.PiiType;
      const piiResult = piiParam.baseType as CoreTypes.Result;
      const optionOk = piiResult.ok as CoreTypes.Option;
      const innerList = optionOk.type as CoreTypes.List;
      const listElement = innerList.type as CoreTypes.Maybe;
      assert.strictEqual(listElement.kind, 'Maybe');
      assert.strictEqual((listElement.type as CoreTypes.TypeName).name, 'Int');

      const retResult = resolved.ret as CoreTypes.Result;
      assert.strictEqual((retResult.ok as CoreTypes.TypeName).name, 'Int');
      const retList = retResult.err as CoreTypes.List;
      assert.strictEqual(((retList.type as CoreTypes.Maybe).type as CoreTypes.TypeName).name, 'Int');
    });
  });
});
