/**
 * 测试数据工厂
 * 用于创建测试所需的各种类型和数据结构
 */

import type { Core } from '../../src/types.js';

export const TestFactories = {
  /**
   * 创建 TypeName
   */
  createTypeName(name: string): Core.TypeName {
    return { kind: 'TypeName', name };
  },

  /**
   * 创建 TypeApp
   */
  createTypeApp(base: string, args: Core.Type[]): Core.TypeApp {
    return { kind: 'TypeApp', base, args };
  },

  /**
   * 创建 FuncType
   */
  createFuncType(params: Core.Type[], ret: Core.Type): Core.FuncType {
    return { kind: 'FuncType', params, ret };
  },

  // 预定义常用类型
  intType: { kind: 'TypeName', name: 'Int' } as Core.TypeName,
  textType: { kind: 'TypeName', name: 'Text' } as Core.TypeName,
  boolType: { kind: 'TypeName', name: 'Bool' } as Core.TypeName,
  voidType: { kind: 'TypeName', name: 'Void' } as Core.TypeName,
};
