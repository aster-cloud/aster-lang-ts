import type { TextSpan } from './mapping-ir.js';

/**
 * SourceIR —— 人类 artifact 的结构化表示（ADR 0037 §2/§9.5）。
 *
 * <h2>它解决的问题，与 LayoutMap 不是同一个</h2>
 *
 * ```
 *   LayoutMap（aster-dev/src/lib/layout-map.ts）
 *     display ↔ canonical，用于**本来就是 Aster 源码**的文本（《静夜思》demo）
 *     手写、平铺、全文档逐字符覆盖 —— 20 字的诗可以，50 页的 Policy 不行
 *
 *   SourceIR（本模块）
 *     **从未是 Aster** 的人类文档（Policy / SOP / 合同）的结构
 *     机械推导、**嵌套**（标题层级）、只标结构不改内容
 * ```
 *
 * <h2>★唯一的硬约束：offset 必须可回切原文</h2>
 *
 * `MappingIR.TextSpan` 是**字符偏移**的。SourceIR 的每个节点都必须携带能**逐字节
 * 切回原文**的 span，否则「文本片段 ↔ IR 节点」这条链在第一步就断了。
 *
 * 故本模块**不做任何文本改写**——不 trim、不规范化、不转义。节点只记
 * 「这段文本在哪里、是什么结构角色」，内容永远从原文按 span 切。
 *
 * <p>★这条约束还带来一个可机械验证的不变式：
 * {@link verifyCoverage} 检查所有叶子 span 拼起来是否**无重叠、无越界**。
 * 没有它，一个错位的 span 会静默把映射指向错误的文本。
 */

/** 结构角色。刻意保持**小而封闭**——每多一种就多一份解析歧义。 */
export type SectionKind =
  /** 整篇文档。 */
  | 'DOCUMENT'
  /** 标题及其管辖范围（`#`..`######`）。 */
  | 'HEADING'
  /** 普通段落。 */
  | 'PARAGRAPH'
  /** 列表项（`-` / `*` / `1.`）。 */
  | 'LIST_ITEM'
  /** 代码块（``` 围栏）——★内容不参与语义映射，但位置要占住，否则覆盖率对不上。 */
  | 'CODE_BLOCK';

/**
 * SourceIR 节点。
 *
 * <p>★`span` 指向**原始文档**的字符偏移；`text` 是冗余副本，便于调用方
 * 独立核对（与 `MappingIR.CandidateMapping` 同样的设计——不依赖调用方重新切片）。
 */
export interface SourceNode {
  /** 稳定标识，形如 `doc` / `doc.h[0]` / `doc.h[0].p[1]`。 */
  readonly nodeId: string;
  readonly kind: SectionKind;
  readonly span: TextSpan;
  readonly text: string;
  /** 标题层级（1..6）；非 HEADING 为 `undefined`。 */
  readonly level?: number;
  readonly children: readonly SourceNode[];
}

/**
 * 从 Markdown 文本推导 SourceIR。
 *
 * <p>★**只标结构，不改内容**。返回的每个节点都能用 `text.slice(span.start, span.end)`
 * 逐字节切回原文——这由 {@link verifyCoverage} 机械验证。
 *
 * <p>选 Markdown 是因为它是本仓 Policy/SOP 的实际载体（实测
 * `docs/p0a-signability-policy.md`：8 个标题、8 个列表项、19 个段落块）。
 * 其他格式（docx/pdf）应当先转成 Markdown 再进本模块，而不是在这里堆解析器。
 */
export function parseSourceIr(document: string): SourceNode {
  // ★`text` 在 span 扩展后必须重算，否则 text 与 span 不再自洽（verifyCoverage 会抓）。
  const blocks = splitBlocks(document);
  const root: MutableNode = {
    nodeId: 'doc', kind: 'DOCUMENT',
    span: { start: 0, end: document.length },
    text: document, children: [],
  };

  // 标题栈：栈顶是当前生效的最深标题。遇到同级或更浅的标题就出栈。
  const stack: { level: number; node: MutableNode }[] = [];
  const counters = new Map<string, Map<string, number>>();

  for (const block of blocks) {
    const parent = stack.length > 0 ? stack[stack.length - 1]!.node : root;
    const heading = matchHeading(block.text);

    if (heading !== undefined) {
      while (stack.length > 0 && stack[stack.length - 1]!.level >= heading.level) {
        stack.pop();
      }
      const host = stack.length > 0 ? stack[stack.length - 1]!.node : root;
      const node: MutableNode = {
        nodeId: nextId(counters, host.nodeId, 'h'),
        kind: 'HEADING', span: block.span, text: block.text,
        level: heading.level, children: [],
      };
      host.children.push(node);
      stack.push({ level: heading.level, node });
      continue;
    }

    const kind = classify(block.text);
    parent.children.push({
      nodeId: nextId(counters, parent.nodeId, prefixOf(kind)),
      kind, span: block.span, text: block.text, children: [],
    });
  }

  // ★HEADING 的 span 必须**覆盖其管辖范围**，而不只是标题那一行。
  //   否则父子 span 不满足包含关系：`doc.h[0]` = [0,8) 而其子段落 = [17,42)，
  //   `nodeAtOffset` 无法从父下降到子，「点击原文 → 定位结构」直接失效。
  //   实测踩过：查 `$10,000` 的所在节点返回 DOCUMENT 而非那个段落。
  extendHeadingSpans(root, document.length);
  return freeze(root, document);
}

/**
 * 把每个 HEADING 的 `span.end` 扩展到它最后一个后代的结尾。
 *
 * <p>★这使 span 树满足**包含不变式**（父覆盖子），这是 {@link nodeAtOffset}
 * 能逐层下降的前提，也是 {@link verifyCoverage} 现在会检查的一条。
 *
 * <p>`text` 同步扩展——`text` 必须始终等于 `document.slice(span)`。
 */
function extendHeadingSpans(node: MutableNode, docLength: number): void {
  node.children.forEach(c => extendHeadingSpans(c, docLength));
  if (node.kind !== 'HEADING' || node.children.length === 0) return;
  const lastEnd = Math.max(...node.children.map(c => c.span.end));
  if (lastEnd > node.span.end) {
    node.span = { start: node.span.start, end: lastEnd };
  }
}

/**
 * 机械验证 SourceIR 的覆盖不变式。
 *
 * <p>检查每个节点的 `text` 是否**逐字节等于** `document.slice(span.start, span.end)`，
 * 以及叶子节点之间**无重叠**。
 *
 * <p>★没有这道检查，一个错位的 span 会静默把映射指向错误的文本——不报错，
 * 只是双向导航跳到别处。这与 `MappingIR` 里「span 与 text 必须自洽」同源。
 *
 * @returns 违规列表；空数组表示通过
 */
export function verifyCoverage(root: SourceNode, document: string): string[] {
  const problems: string[] = [];
  const leaves: SourceNode[] = [];

  (function walk(n: SourceNode): void {
    const slice = document.slice(n.span.start, n.span.end);
    if (slice !== n.text) {
      problems.push(
        `${n.nodeId}: text 与 span 切片不符 —— span=[${n.span.start},${n.span.end}) `
        + `切片 ${JSON.stringify(slice.slice(0, 30))} vs text ${JSON.stringify(n.text.slice(0, 30))}`);
    }
    if (n.span.start < 0 || n.span.end > document.length || n.span.end < n.span.start) {
      problems.push(`${n.nodeId}: span 越界或倒置 [${n.span.start},${n.span.end})`);
    }
    if (n.children.length === 0) {
      leaves.push(n);
    } else {
      // ★包含不变式：父的 span 必须覆盖每个子。
      //   没有这条，`doc.h[0]`=[0,8) 而其子段落=[17,42) 这种「子在父之外」
      //   的树能悄悄通过——`nodeAtOffset` 无法下降，「点击原文→定位结构」
      //   静默失效。实测踩过：查 $10,000 返回 DOCUMENT 而非那个段落。
      for (const c of n.children) {
        if (c.span.start < n.span.start || c.span.end > n.span.end) {
          problems.push(
            `${c.nodeId} 不被父 ${n.nodeId} 包含：子 [${c.span.start},${c.span.end}) `
            + `父 [${n.span.start},${n.span.end})`);
        }
      }
      n.children.forEach(walk);
    }
  })(root);

  // 叶子按起点排序后，相邻两个不得重叠。
  const sorted = [...leaves].sort((a, b) => a.span.start - b.span.start);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.span.start < prev.span.end) {
      problems.push(
        `叶子 span 重叠：${prev.nodeId} [${prev.span.start},${prev.span.end}) `
        + `与 ${cur.nodeId} [${cur.span.start},${cur.span.end})`);
    }
  }
  return problems;
}

/** 找出包含某个字符偏移的**最深**节点——「点击原文 → 定位结构」的基础。 */
export function nodeAtOffset(root: SourceNode, offset: number): SourceNode | undefined {
  if (offset < root.span.start || offset >= root.span.end) return undefined;
  for (const child of root.children) {
    const hit = nodeAtOffset(child, offset);
    if (hit !== undefined) return hit;
  }
  return root;
}

// ───────────────────────── 内部实现 ─────────────────────────

interface MutableNode {
  nodeId: string;
  kind: SectionKind;
  span: TextSpan;
  text: string;
  level?: number;
  children: MutableNode[];
}

interface Block { readonly span: TextSpan; readonly text: string }

/**
 * 按空行切块，并**保留每块的精确偏移**。
 *
 * <p>★不能用 `split(/\n\s*\n/)` 然后累加长度——分隔符长度不固定（`\n\n` vs
 * `\n   \n`），累加会漂移。这里逐字符扫描，偏移由扫描位置直接给出。
 *
 * <p>围栏代码块（```）内的空行**不切**——否则一个代码块会被撕成多块，
 * 而它的内容本就不该参与结构划分。
 */
function splitBlocks(doc: string): Block[] {
  const blocks: Block[] = [];
  const lines = lineSpans(doc);
  let fenced = false;
  let cur: { start: number; end: number } | null = null;

  const flush = (): void => {
    if (cur === null) return;
    const text = doc.slice(cur.start, cur.end);
    if (text.trim().length > 0) blocks.push({ span: { ...cur }, text });
    cur = null;
  };

  for (const ls of lines) {
    const line = doc.slice(ls.start, ls.end);
    if (/^\s*```/.test(line)) {
      if (fenced) { // 收尾围栏：并入当前块后结束
        if (cur !== null) cur.end = ls.end;
        fenced = false;
        flush();
      } else {
        flush();
        fenced = true;
        cur = { start: ls.start, end: ls.end };
      }
      continue;
    }
    if (!fenced && line.trim().length === 0) { flush(); continue; }
    if (cur === null) cur = { start: ls.start, end: ls.end };
    else cur.end = ls.end;
  }
  flush();
  return blocks;
}

/** 每行的 `[start, end)`，**不含**行尾换行（换行归入块间空隙）。 */
function lineSpans(doc: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i <= doc.length; i++) {
    if (i === doc.length || doc[i] === '\n') {
      out.push({ start, end: i });
      start = i + 1;
    }
  }
  return out;
}

function matchHeading(text: string): { level: number } | undefined {
  const m = /^(#{1,6})\s+\S/.exec(text);
  return m === null ? undefined : { level: m[1]!.length };
}

function classify(text: string): SectionKind {
  if (/^\s*```/.test(text)) return 'CODE_BLOCK';
  if (/^\s*(?:[-*+]\s|\d+\.\s)/.test(text)) return 'LIST_ITEM';
  return 'PARAGRAPH';
}

function prefixOf(kind: SectionKind): string {
  switch (kind) {
    case 'LIST_ITEM': return 'li';
    case 'CODE_BLOCK': return 'code';
    default: return 'p';
  }
}

/** 在**同一父节点**下按前缀递增编号——保证 nodeId 在文档内唯一且可预测。 */
function nextId(counters: Map<string, Map<string, number>>, parentId: string, prefix: string): string {
  let byPrefix = counters.get(parentId);
  if (byPrefix === undefined) { byPrefix = new Map(); counters.set(parentId, byPrefix); }
  const n = byPrefix.get(prefix) ?? 0;
  byPrefix.set(prefix, n + 1);
  return `${parentId}.${prefix}[${n}]`;
}

function freeze(n: MutableNode, document?: string): SourceNode {
  const children = n.children.map(c => freeze(c, document));
  if (document !== undefined) n.text = document.slice(n.span.start, n.span.end);
  return n.level === undefined
    ? { nodeId: n.nodeId, kind: n.kind, span: n.span, text: n.text, children }
    : { nodeId: n.nodeId, kind: n.kind, span: n.span, text: n.text, level: n.level, children };
}
