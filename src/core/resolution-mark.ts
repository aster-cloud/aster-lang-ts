/**
 * @module core/resolution-mark
 *
 * R1 未定点的标记（ADR 0051 §4 ResolutionMark）。lower 对 R1 无法决定的位置保留原写法并登记标记，
 * R2 只读取（不删除），因此同一 Core 上重复运行 R2 结果相同；R2 的输出由新节点构成，不再携带标记。与 inferred_fields 相同，以对象身份为键的旁路表携带，不进入 Core IR，
 * 因此未运行 R2 时 IR、golden 与跨引擎指纹均不变；反序列化得到的 Core 不带标记。
 */
import type { Core, Origin, ResolvedRole } from '../types.js';

export interface ResolutionMark {
  /** 源码原写法 */
  readonly written: string;
  /** 裸单段名在 R1（无期望类型规则）下得到的角色；缺省表示 R1 未命中 */
  readonly r1Role?: ResolvedRole;
  /** 由 UFCS 拆分 `recv.method(…)` 得到的接收者或方法名：首段可能是命名空间，未命中不报错 */
  readonly ufcs?: true;
}

/** 可能留给 R2 的节点：值位置名字、Set 目标、模式构造器与模式名。 */
export type MarkableNode = Core.Name | Core.Set | Core.PatCtor | Core.PatName;

const marks = new WeakMap<MarkableNode, ResolutionMark>();

/** 登记一个留给 R2 的位置（仅供降级阶段调用）。 */
export function markForResolution(node: MarkableNode, mark: ResolutionMark): void {
  marks.set(node, mark);
}

/** 读取标记（不删除）。 */
export function resolutionMarkOf(node: MarkableNode): ResolutionMark | undefined {
  return marks.get(node);
}

/**
 * 在 origin 上记录原写法与角色：仅当写法与规范名不同且节点带 origin 时写入，
 * 否则原样返回（不新增 origin）。
 */
export function withResolvedOrigin(
  origin: Origin | undefined,
  written: string,
  canonical: string,
  role: ResolvedRole
): Origin | undefined {
  if (!origin || written === canonical) return origin;
  return { ...origin, written, role };
}
