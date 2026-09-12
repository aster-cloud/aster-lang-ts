import type { NodeIdentity } from './node-id-map.js';

/**
 * 跨版本 change impact（TS 侧）—— 与 `aster-lang-core` 的 `ChangeImpact` 对等实现。
 *
 * <h2>这是 ADR 0037 §4 的核心能力</h2>
 *
 * ```
 *   $10,000 → $20,000
 *        ↓
 *   PaymentApproval.threshold 已 stale
 * ```
 *
 * 之所以能回答，是因为 `NodeIdMap` 把「是哪个节点」（nodeId）与「它变了没有」
 * （contentHash）拆成两个字段：阈值改动时 nodeId 不变、contentHash 变，于是
 * 可以报 `MODIFIED` 而不是「一个节点消失 + 一个节点出现」。
 *
 * <h2>★结果的解读边界</h2>
 *
 * `MODIFIED` 的判定是**内容指纹不同**，不是「语义变了」。两者大多数时候一致，
 * 但并非总是——例如把 `x plus y` 写成 `y plus x`，指纹变而语义可能等价。
 * **本模块只报「变了」，不声称「行为会不同」**；后者需要真正的语义比对。
 *
 * 同理 `REMOVED`/`ADDED` 在**重命名**时会成对出现——那是路径方案的固有代价
 * （ADR 0037 §8.5），需由显式 rename 声明消解，而不是由本模块猜测。
 * 猜错会把两个不同的节点当成同一个，比「识别为新节点」更危险。
 */

export type ChangeKind =
  /** nodeId 两侧都在，contentHash 不同 → 同一个节点，内容变了。 */
  | 'MODIFIED'
  /** nodeId 只在新版出现。 */
  | 'ADDED'
  /** nodeId 只在旧版出现。 */
  | 'REMOVED';

export interface Change {
  /** 稳定标识（`ADDED`/`REMOVED` 时只在一侧存在）。 */
  readonly nodeId: string;
  readonly kind: ChangeKind;
  /** 节点类型（`Func`/`If`/...）。 */
  readonly nodeKind: string;
  /**
   * 受本次变更波及的祖先 nodeId（由内向外），
   * 即 ADR 0037 §4 里「谁已经 stale」的答案。
   */
  readonly staleAncestors: readonly string[];
}

/**
 * 比较两个版本的节点标识表。
 *
 * @returns 变更列表，按 nodeId 字典序（确定顺序，便于比对与快照）
 */
export function diffNodeIds(
  before: ReadonlyMap<string, NodeIdentity>,
  after: ReadonlyMap<string, NodeIdentity>,
): readonly Change[] {
  const all = new Set<string>([...before.keys(), ...after.keys()]);
  const changes: Change[] = [];

  for (const id of [...all].sort()) {
    const b = before.get(id);
    const a = after.get(id);
    if (b === undefined) {
      changes.push({ nodeId: id, kind: 'ADDED', nodeKind: a!.kind, staleAncestors: ancestorsOf(id, after) });
    } else if (a === undefined) {
      changes.push({ nodeId: id, kind: 'REMOVED', nodeKind: b.kind, staleAncestors: ancestorsOf(id, before) });
    } else if (b.contentHash !== a.contentHash) {
      changes.push({ nodeId: id, kind: 'MODIFIED', nodeKind: a.kind, staleAncestors: ancestorsOf(id, after) });
    }
  }
  return changes;
}

/**
 * 一个节点变更后，哪些祖先随之 stale。
 *
 * <p>★注意方向：**祖先 stale，后代不 stale**。改了 if 条件里的阈值，是「包含
 * 它的那条规则」需要重新审视；而阈值节点的子节点（字面量本身）并没有变。
 * 反过来标记会把影响面夸大到整棵子树。
 */
function ancestorsOf(nodeId: string, universe: ReadonlyMap<string, NodeIdentity>): readonly string[] {
  const out: string[] = [];
  let cur = nodeId;
  for (;;) {
    const cut = lastSegmentStart(cur);
    if (cut <= 0) break;
    cur = cur.slice(0, cut);
    if (universe.has(cur)) out.push(cur);
  }
  return out;
}

/**
 * 找到最后一个路径段的起点。
 *
 * <p>路径形如 `$.decls{approve}.body.statements[0].cond`，分隔符是 `.`、`[`、`{`。
 * ★不能简单用 `lastIndexOf('.')`——名字段 `{a.b.c}` 里可能含点（模块路径式的
 * Import 名就是如此），那样会从名字中间切断，产生一个不存在的祖先。
 */
function lastSegmentStart(path: string): number {
  let depth = 0;
  for (let i = path.length - 1; i >= 0; i--) {
    const c = path[i]!;
    if (c === '}') {
      depth++;
    } else if (c === '{') {
      depth--;
      if (depth === 0) {
        // {name} 段：其起点是前面那个 '.'（如 .decls{approve}）
        const dot = path.lastIndexOf('.', i);
        return dot > 0 ? dot : i;
      }
    } else if (depth === 0 && (c === '.' || c === '[')) {
      return i;
    }
  }
  return -1;
}
