/**
 * Core IR v2 的 `Func.effects`（ADR 0055 #5）到效应检查用的效应引用。
 *
 * v2 的 effects 只含授权型具体效应 `io` / `cpu`（小写）与已声明的效应变量（名字等于 effectParams 中某项），
 * 不再有 declaredEffects。这里把小写名映射回 Effect 枚举、把效应变量映射为 EffectVar；
 * 其余名字（只可能出现在手工构造的 IR 中）按 pure 处理，与 core EffectChecker 一致。
 * 纯函数，Node 与浏览器两份效应推断共用。
 */
import { Effect } from '../types.js';
import type { Core, Ty } from '../types.js';

/** 一个函数声明的效应：具体效应枚举或效应变量。 */
export type DeclaredEffect = Effect | Ty.EffectVar;

/** 按源码顺序返回函数声明的效应。 */
export function declaredEffectsOf(func: Pick<Core.Func, 'effects' | 'effectParams'>): DeclaredEffect[] {
  const params = new Set(func.effectParams);
  return func.effects.map((name): DeclaredEffect => {
    if (params.has(name)) return { kind: 'EffectVar', name };
    if (name === 'io') return Effect.IO;
    if (name === 'cpu') return Effect.CPU;
    return Effect.PURE;
  });
}

/** 函数是否声明了某个具体效应（io / cpu）。 */
export function declaresEffect(func: Pick<Core.Func, 'effects'>, effect: 'io' | 'cpu'): boolean {
  return func.effects.includes(effect);
}
