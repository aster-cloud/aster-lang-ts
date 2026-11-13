/**
 * 类型级测试（由 `pnpm typecheck` 执行，不产生运行期断言）：Core.* 与由 v2 schema 生成的类型
 * 双向可赋值且相等（ADR 0055 §3「合规检查」）。任何一侧多出、缺少字段或可空性不同都会编译失败。
 */
import type { Core } from '../../src/types.js';
import type * as CoreIrV2 from '../../src/core/core-ir-v2.generated.js';

/** A 与 B 是否为同一类型（含 readonly 与可选性）。 */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/** 只接受 true 的断言位。 */
type Expect<T extends true> = T;

export type CoreIrV2TypeAssertions = [
  Expect<Equals<Core.Module, CoreIrV2.IrModule>>,
  Expect<Equals<Core.Declaration, CoreIrV2.IrDecl>>,
  Expect<Equals<Core.Func, CoreIrV2.IrFunc>>,
  Expect<Equals<Core.Field, CoreIrV2.IrField>>,
  Expect<Equals<Core.Parameter, CoreIrV2.IrParam>>,
  Expect<Equals<Core.Annotation, CoreIrV2.IrAnnotation>>,
  Expect<Equals<Core.Constraint, CoreIrV2.IrConstraint>>,
  Expect<Equals<Core.Statement, CoreIrV2.IrStmt>>,
  Expect<Equals<Core.Expression, CoreIrV2.IrExpr>>,
  Expect<Equals<Core.Pattern, CoreIrV2.IrPat>>,
  Expect<Equals<Core.Type, CoreIrV2.IrType>>,
  Expect<Equals<Core.Origin, CoreIrV2.IrOrigin>>,
];

/** 双向可赋值（与 Equals 互为佐证）：值层面的赋值同样必须通过。 */
export function assignBothWays(a: Core.Module, b: CoreIrV2.IrModule): [CoreIrV2.IrModule, Core.Module] {
  return [a, b];
}
