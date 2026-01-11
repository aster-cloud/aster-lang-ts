import type { Effect } from '../types.js';

/**
 * 表示某个函数的效应签名，用于跨模块传播与缓存。
 */
export interface EffectSignature {
  readonly module: string;
  readonly function: string;
  readonly qualifiedName: string;
  readonly declared: ReadonlySet<Effect>;
  readonly inferred: ReadonlySet<Effect>;
  readonly required: ReadonlySet<Effect>;
}
