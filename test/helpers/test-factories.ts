/**
 * 测试数据工厂
 * 用于创建测试所需的各种类型和数据结构（Core IR v2 形状，ADR 0055）
 */

import type { Core } from '../../src/types.js';
import { Core as CoreIR } from '../../src/core/core_ir.js';

export const TestFactories = {
  /**
   * 创建 TypeName
   */
  createTypeName(name: string): Core.TypeName {
    return CoreIR.TypeName(name);
  },

  /**
   * 创建 TypeApp
   */
  createTypeApp(base: string, args: Core.Type[]): Core.TypeApp {
    return CoreIR.TypeApp(base, args);
  },

  /**
   * 创建 FuncType
   */
  createFuncType(params: Core.Type[], ret: Core.Type): Core.FuncType {
    return CoreIR.FuncType(params, ret);
  },

  // 预定义常用类型
  intType: CoreIR.TypeName('Int'),
  textType: CoreIR.TypeName('Text'),
  boolType: CoreIR.TypeName('Bool'),
  voidType: CoreIR.TypeName('Void'),
};
