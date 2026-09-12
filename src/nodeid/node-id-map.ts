import { createHash } from 'node:crypto';

/**
 * Stable IR Node ID（TS 侧）—— 与 `aster-lang-core` 的 `NodeIdMap` 对等实现。
 *
 * <h2>为什么是两个字段而不是一个</h2>
 *
 * ADR 0037 §8 的实测：三种候选方案各有一个**灾难场景**，且互不重叠
 * （基线 16 节点的身份存活率）：
 *
 * ```
 *   编辑                  结构hash   结构路径   命名作用域路径
 *   改阈值                 10/16      16/16      16/16
 *   前面插入一条规则        16/16       5/16      16/16
 *   重命名规则             14/16      16/16       1/16
 * ```
 *
 * 结论是**复合键**，两者职责分离：
 *
 * ```
 *   nodeId      = 命名作用域路径   ← 「是哪个节点」（跨版本稳定）
 *   contentHash = 子树内容指纹     ← 「它变了没有」（change impact 的信号）
 * ```
 *
 * <h2>★跨引擎口径：contentHash 必须对「归一化后」的 IR 取 hash</h2>
 *
 * 两引擎的**原始** Core IR 字段本就不同，且这是 ADR 0016 §B/§C 认定的**合法
 * 分岔**（推导分析层，不是源码结构）：
 *
 * ```
 *   Java 独有   annotations / retAnnotations / piiLevel / piiCategories
 *   TS   独有   retTypeInferred / constraints / typeInferred
 * ```
 *
 * 所以直接对原始 IR 取 hash，两侧**必定**不等。调用方必须先用
 * `@aster-cloud/aster-lang-test/ir-normalize` 的 `normalizeIr` 归一化——那是
 * parity 门禁使用的**同一份**规则（单源，避免「门禁说一致、hash 说不一致」
 * 且两边都不报错的漂移）。
 *
 * <h2>与 ADR 0032 anchor 的边界（★不可混用）</h2>
 *
 * ```
 *   anchor ("L21C5-L21C22")  位置派生，**同一版本内**稳定 → trace 跨执行聚合
 *   nodeId (命名作用域路径)   结构派生，**跨版本**稳定     → 双向导航 / change impact
 * ```
 *
 * 用其中一个去做另一个的工作，会让「跨版本统计」悄悄退化成「同版本统计」，
 * 且不报错。
 */

/** ID 方案版本。变更路径构造规则或 hash 口径必须 bump，否则跨版本比对会静默错配。 */
export const NODE_ID_VERSION = 'aster-node-id/v1';

/**
 * canonical 算法版本前缀。★必须与 Java `CanonicalJson.CANONICALIZATION_VERSION`
 * 和 aster-cloud `canonical-json.ts` 保持一致，否则同一棵树在两侧产出不同 hash。
 */
const CANONICALIZATION_VERSION = 'aster-canonical-json/v1';

/** 一个节点的稳定标识。 */
export interface NodeIdentity {
  /** 命名作用域路径，如 `$.decls{approve}.body.statements[0]`。 */
  readonly nodeId: string;
  /** 该节点子树（剥掉 origin）的 canonical hash。 */
  readonly contentHash: string;
  /** 节点类型（`Func` / `If` / ...），便于调试与过滤。 */
  readonly kind: string;
}

/** 不参与身份与内容判定的字段。位置不是内容。 */
function isIdentityIrrelevant(field: string): boolean {
  return field === 'origin';
}

/**
 * canonical JSON 序列化（object key 按 Unicode code point 升序，array 保序）。
 *
 * <p>★这是 Java `CanonicalJson` 的**子集**：归一化后的 Core IR 只含
 * null / boolean / string / 安全整数 / array / object，不含 Decimal 与浮点，
 * 故不需要 aster-cloud 那份实现里的 Decimal 展开与 typeCtx 机制。
 *
 * <p>★遇到浮点或超安全整数范围的数值会**抛错而非静默降级**——跨引擎浮点表示
 * 不一致，静默处理会产出两侧不同的 hash 且无人察觉（与 Java 同口径）。
 */
function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`canonical JSON 不支持 NaN/Infinity：${value}`);
    }
    if (!Number.isSafeInteger(value)) {
      throw new Error(
        `canonical JSON 只接受安全整数（跨引擎浮点表示不一致）：${value}`);
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => compareByCodePoint(a, b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw new Error(`canonical JSON 不支持的类型：${typeof value}`);
}

/**
 * 按 Unicode code point 比较（★不能用默认的 `<`——JS 字符串比较按 UTF-16
 * code unit，对增补平面字符与 Java 的 code point 序不一致，会产出不同的 hash）。
 */
function compareByCodePoint(a: string, b: string): number {
  const ai = [...a];
  const bi = [...b];
  const n = Math.min(ai.length, bi.length);
  for (let i = 0; i < n; i++) {
    const ca = ai[i]!.codePointAt(0)!;
    const cb = bi[i]!.codePointAt(0)!;
    if (ca !== cb) return ca - cb;
  }
  return ai.length - bi.length;
}

/** `sha256(version + "\n" + canonicalJson(value))`，hex。与 Java 同算法同前缀。 */
export function canonicalHash(value: unknown): string {
  return createHash('sha256')
    .update(`${CANONICALIZATION_VERSION}\n${canonicalJson(value)}`, 'utf8')
    .digest('hex');
}

/** 深拷贝并剥掉不参与身份判定的字段。 */
function stripIdentityIrrelevant(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripIdentityIrrelevant);
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (isIdentityIrrelevant(k)) continue;
      out[k] = stripIdentityIrrelevant(v);
    }
    return out;
  }
  return node;
}

/**
 * 数组元素的路径段：**有名字就用名字**，否则退回下标。
 *
 * <p>这一行是整个方案的关键——它让「在前面插入一条规则」不再移动后续规则的身份
 * （实测：纯下标路径 5/16 存活，改用名字后 16/16）。
 */
function segmentOf(element: unknown, index: number): string {
  if (element !== null && typeof element === 'object' && !Array.isArray(element)) {
    const el = element as Record<string, unknown>;
    // ★`_` 不是名字，是**占位符**：裸表达式语句一律降为 `Let "_" be expr`
    //   （求值并丢弃结果）。若拿它当路径段，同一函数体里的多条裸表达式语句
    //   会全部塌成 `statements{_}` —— nodeId 撞车，Map 只保留最后一条，
    //   其余节点的身份**静默消失**。
    //   实测（tier1 全语料）：1 个样本、4 个节点因此丢失身份。
    //   占位名退回下标，回到「按位置区分」——这正是无名节点的正确处理方式。
    if (typeof el.name === 'string' && el.name !== '_') return `{${el.name}}`;
    // Import 没有 name，用 path 充当名字：它同样是「重排后仍指同一个导入」的标识。
    if (typeof el.path === 'string') return `{${el.path}}`;
  }
  return `[${index}]`;
}

/**
 * 为一棵 Core IR 计算全部节点的稳定标识。
 *
 * @param ir 建议先经 `normalizeIr` 归一化——跨引擎比较时**必须**先归一化，
 *           否则两侧的 contentHash 恒不相等（见本文件头部说明）。
 * @returns nodeId → NodeIdentity，按插入顺序（路径的深度优先序，确定）
 */
export function computeNodeIds(ir: unknown): ReadonlyMap<string, NodeIdentity> {
  const out = new Map<string, NodeIdentity>();
  walk(ir, '$', out);
  return out;
}

function walk(node: unknown, path: string, out: Map<string, NodeIdentity>): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
  const obj = node as Record<string, unknown>;

  // 只有带 kind 的对象才是「IR 节点」；Field/Param 等无 kind 的结构体不单独发 ID，
  // 它们随宿主节点的 contentHash 一起变化（与 Java 侧口径一致）。
  if (typeof obj.kind === 'string') {
    out.set(path, {
      nodeId: path,
      contentHash: canonicalHash(stripIdentityIrrelevant(obj)),
      kind: obj.kind,
    });
  }

  for (const [field, value] of Object.entries(obj)) {
    if (isIdentityIrrelevant(field)) continue;
    if (Array.isArray(value)) {
      value.forEach((el, i) => walk(el, `${path}.${field}${segmentOf(el, i)}`, out));
    } else {
      walk(value, `${path}.${field}`, out);
    }
  }
}
