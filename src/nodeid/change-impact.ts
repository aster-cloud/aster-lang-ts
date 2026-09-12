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


/**
 * 一次**显式声明**的重命名：`Rule approve` → `Rule assess`。
 *
 * <p>★为什么必须显式声明、不能自动推断：直觉上可以「按 contentHash 配对」，
 * 但 **contentHash 不唯一**。两条函数体相同的规则，其 `body` / `statements[0]`
 * / `ret` 等各级节点的 hash 全部相同：
 *
 * ```
 *   Rule alpha, produce:    Rule beta, produce:
 *     Return 1.               Return 1.
 *   → $.decls{alpha}.body 与 $.decls{beta}.body 的 contentHash **完全相同**
 * ```
 *
 * 于是把 `alpha` 改名为 `gamma` 后，`beta.body` 的 hash 在新版里能匹配到
 * **两个**候选，无法判定谁是谁——自动配对会把两条规则的身份互换，且**不报错**。
 *
 * <p>★把两个不同的节点当成同一个，比「识别为新节点」危险得多：前者给出
 * **错误**的溯源答案，后者只是丢失历史关联。立场是**宁可少认，不可错认**。
 */
export interface Rename {
  readonly oldName: string;
  readonly newName: string;
}

/** 构造并校验一条重命名声明。空名 / 新旧同名都是调用方的错误，直接暴露。 */
export function rename(oldName: string, newName: string): Rename {
  if (!oldName?.trim() || !newName?.trim()) {
    throw new Error('rename 的新旧名字都不能为空');
  }
  if (oldName === newName) {
    throw new Error(`rename 的新旧名字相同：${oldName}`);
  }
  return { oldName, newName };
}

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
  renames: readonly Rename[] = [],
): readonly Change[] {
  if (renames.length > 0) {
    before = applyRenames(before, renames);
  }
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
 * 把旧版的 nodeId 按声明的重命名做**路径段替换**，使整棵子树一次性迁移。
 *
 * <p>★只替换完整的 `{name}` 路径段，不做子串替换——朴素的字符串 replace 会让
 * `approve` 误伤 `approveAll`。
 *
 * <p>★同一个 oldName 不允许被声明成多个不同的新名字：那是自相矛盾的输入，
 * 静默取其一会给出无声错误的溯源结果。
 */
function applyRenames(
  before: ReadonlyMap<string, NodeIdentity>,
  renames: readonly Rename[],
): ReadonlyMap<string, NodeIdentity> {
  const mapping = new Map<string, string>();
  for (const r of renames) {
    const prev = mapping.get(r.oldName);
    if (prev !== undefined && prev !== r.newName) {
      throw new Error(`同一个名字被声明重命名到多个目标：${r.oldName} → ${prev} / ${r.newName}`);
    }
    mapping.set(r.oldName, r.newName);
  }

  const out = new Map<string, NodeIdentity>();
  for (const [id, v] of before) {
    const renamed = renamePathSegments(id, mapping);
    out.set(renamed, renamed === id ? v : { ...v, nodeId: renamed });
  }
  return out;
}

/** 逐个 `{name}` 段做整段匹配替换。 */
function renamePathSegments(path: string, mapping: ReadonlyMap<string, string>): string {
  let out = '';
  let i = 0;
  while (i < path.length) {
    const c = path[i]!;
    if (c !== '{') {
      out += c;
      i++;
      continue;
    }
    const close = path.indexOf('}', i);
    if (close < 0) { // 不成对的 '{'：原样输出，不猜
      out += path.slice(i);
      break;
    }
    const name = path.slice(i + 1, close);
    out += `{${mapping.get(name) ?? name}}`;
    i = close + 1;
  }
  return out;
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
