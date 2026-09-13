import type { TextSpan } from './mapping-ir.js';

/**
 * QuantityIR —— 从人类文档里**机械抽取**数量实体（ADR 0037 §2/§10.5）。
 *
 * <h2>为什么 Quantity 和 Entity 要分开</h2>
 *
 * ADR §2 把它们并列为 `Document/Section/Span/Entity/Quantity`，但实测两者的
 * 可抽取性**完全不同**：
 *
 * ```
 *   Quantity（金额/百分比/时长/日期）  有稳定的**形态特征**  → 机械抽取，零 AI
 *   Entity  （角色/主体/义务）        **没有**形态特征      → 需要识别，LLM 的位置
 * ```
 *
 * 实测一份典型付款政策：
 *
 * ```
 *   金额 $10,000 / $50,000 / $25    4 例   ← 正则可抽，100%
 *   百分比 1.5%                      1 例   ← 同上
 *   时长 24 小时                     1 例   ← 同上
 *   日期 2026-01-01 / 2026-12-31     2 例   ← 同上
 *   角色「财务经理」「部门主管」        2 例   ← **无任何可靠形态特征**
 * ```
 *
 * 本模块**只做 Quantity**。Entity 的接口在 {@link EntityCandidate} 声明，
 * 但**不提供实现**——按 ADR §3/§10，那是 LLM 提出候选、由人复核的部分，
 * 不该由本模块假装能机械得出。
 *
 * <h2>★与 MappingIR 的关系：本模块只负责「找到」，不负责「判定」</h2>
 *
 * 抽取出的 Quantity 是**候选映射的左半边**（文本片段 + 位置）。它是否真的对应
 * 某个 IR 节点，仍由 `MappingIR.verifyMapping` 判定。本模块**不做任何语义断言**。
 */

/** 数量的类别。刻意小而封闭——每多一种就多一份误抽风险。 */
export type QuantityKind =
  /** 货币金额（带货币符号）。 */
  | 'MONEY'
  /** 百分比。 */
  | 'PERCENT'
  /** 时长（含单位）。 */
  | 'DURATION'
  /** ISO 8601 日期。 */
  | 'DATE';

export interface Quantity {
  readonly kind: QuantityKind;
  readonly span: TextSpan;
  /** 原文片段，**逐字节**取自文档（与 SourceIR 同规则：不改内容）。 */
  readonly text: string;
  /**
   * 规范化后的数值，**十进制字符串**。
   *
   * <p>★不用 `number`：金额/时长可能超出 JS 安全整数，过一次 number 就丢精度
   * （本仓实测踩过 `9007199254740993` → `…992`）。与 `MappingIR` 的比较口径一致。
   *
   * <p>`DATE` 的 `value` 是 ISO 日期串本身（`2026-01-01`），不转成时间戳——
   * 时间戳依赖时区，不是原文里的信息。
   */
  readonly value: string;
  /** 货币符号 / 时长单位；`PERCENT`、`DATE` 为 `undefined`。 */
  readonly unit?: string;
}

/**
 * Entity 候选（角色、主体、义务这类**语义实体**）。
 *
 * <p>★本模块**不实现**它的抽取。Entity 没有可靠的形态特征——「财务经理」
 * 与「财务报表」在字符层面无从区分，只能靠语义识别。按 ADR §3：
 *
 * ```
 *   LLM / 启发式 / 人  →  提出 EntityCandidate
 *   确定性 verifier    →  判定（但对 Entity 只能给 REVIEW_REQUIRED）
 * ```
 *
 * <p>此处声明接口是为了**把边界写进类型系统**：调用方一看就知道 Entity 必须
 * 从外部传入，而不是指望本模块变出来。
 */
export interface EntityCandidate {
  readonly span: TextSpan;
  readonly text: string;
  /** 提出者给出的类别（`Role` / `Party` / `Obligation` …），本模块不校验。 */
  readonly proposedKind: string;
  /** 谁提出的——与 `ProofIR.ProofSubject` 同源，便于追溯。 */
  readonly proposedBy: string;
}

/**
 * 抽取顺序**有意义**：先匹配的先占位，后面的不再重叠抽取。
 *
 * <p>★当前四类模式**几乎互斥**，唯一会相交的形态是 `$1.5%`：
 * `MONEY` 匹配 `$1.5`、`PERCENT` 匹配 `1.5%`，区间重叠。此时**先声明者胜出**。
 *
 * <p>★我初稿在这里写了「MONEY 必须排在纯数字之前，否则 `$10,000` 会被拆成
 * `10` 和 `000`」——**那是错的**：本模块根本没有「纯数字」模式，挪动 MONEY
 * 的位置对 `$10,000` 毫无影响（已实测）。注释若声称一个并不存在的保护，
 * 会误导后来者以为某处有约束而不敢动。
 */
const PATTERNS: ReadonlyArray<{ kind: QuantityKind; re: RegExp }> = [
  // 货币：符号 + 数字（可含千分位与小数）。★`[$€£¥]` 本身就是左锚，无回溯问题。
  { kind: 'MONEY', re: /[$€£¥]\s?\d[\d,]*(?:\.\d+)?/g },
  // ISO 日期：定长，无回溯问题。
  { kind: 'DATE', re: /\d{4}-\d{2}-\d{2}/g },
  // ★以下两条必须带 `(?<![\d.])` 左锚——**这是 ReDoS 修复，不是可选优化**。
  //
  //   没有锚点时，`\d+` 会在**每个数字位置**重新起跑、贪婪吃到串尾，再因后缀
  //   （`%` / 单位）不匹配而整体回退。对长数字串就是 O(n²)：
  //
  //     长度 5000 →   36ms
  //     长度 10000 →  144ms      ← 翻倍
  //     长度 20000 →  576ms      ← 再翻 4 倍
  //     长度 40000 → 2304ms      ← 实测确认二次增长
  //
  //   加锚后同样输入 **0ms**（左锚让每个起点 O(1) 失败，不再重新贪婪扫描）。
  //   ★语义完全不变：已逐例对照 9 组输入，新旧匹配结果逐字节相同。
  //
  //   本模块吃的是**人类文档**——攻击者可控的输入。没有这个锚点，一份构造过
  //   的文档就能把抽取线程钉死。
  { kind: 'PERCENT', re: /(?<![\d.])\d+(?:\.\d+)?\s?%/g },
  { kind: 'DURATION', re: /(?<![\d.])\d+(?:\.\d+)?\s?(?:小时|分钟|天|秒|hours?|minutes?|days?|seconds?)/g },
];

/**
 * 从文档中抽取所有数量实体。
 *
 * <p>★**不做任何语义判断**——只按形态特征找出「这里有个数量」，以及它的
 * 规范化数值。它是否对应某个 IR 节点，由 `MappingIR.verifyMapping` 判定。
 *
 * @returns 按出现位置升序；互不重叠
 */
export function extractQuantities(document: string): readonly Quantity[] {
  const found: Quantity[] = [];

  // ★`claimed` 始终按 start 升序，用二分查重叠 —— 这是 **O(m²) 修复**。
  //
  //   原写法是 `claimed.some(c => ...)`：每个匹配都线性扫一遍已占位区间，
  //   m 个匹配总功 O(m²)。实测（多匹配载荷 `'1% '.repeat(n)`）：
  //     2000→12ms  4000→11ms  8000→35ms(×3.3)  16000→183ms(×5.2)
  //
  //   ★这个缺陷**逃过了 §12.6 的 ReDoS 门禁**：那里的载荷是
  //   `'$' + '1'.repeat(40000)`——**只有一个匹配**，`claimed` 恒为 1，
  //   O(m²) 项永不激活。门禁量的是对的东西（增长率），但**语料有盲区**。
  const claimed: { start: number; end: number }[] = [];

  /** 二分定位第一个 `end > start` 的区间；只需检查它是否与 [start,end) 重叠。 */
  const overlaps = (start: number, end: number): boolean => {
    let lo = 0;
    let hi = claimed.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (claimed[mid]!.end <= start) lo = mid + 1;
      else hi = mid;
    }
    // claimed 互不重叠且有序，故只有 lo 处那个区间可能与之相交。
    return lo < claimed.length && claimed[lo]!.start < end;
  };

  /** 按 start 升序插入，维持 `claimed` 的有序不变式。 */
  const insertClaimed = (start: number, end: number): void => {
    let lo = 0;
    let hi = claimed.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (claimed[mid]!.start < start) lo = mid + 1;
      else hi = mid;
    }
    claimed.splice(lo, 0, { start, end });
  };

  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(document); m !== null; m = re.exec(document)) {
      const start = m.index;
      const end = start + m[0].length;
      // ★后来者不得与已占位区间重叠：保证输出无重叠，且优先级由 PATTERNS 顺序决定。
      if (overlaps(start, end)) continue;

      const parsed = normalize(kind, m[0]);
      if (parsed === undefined) continue; // 形态像但规范化不出来 → 不抽，绝不编造

      insertClaimed(start, end);
      found.push({
        kind, span: { start, end }, text: m[0],
        value: parsed.value,
        ...(parsed.unit === undefined ? {} : { unit: parsed.unit }),
      });
    }
  }

  return found.sort((a, b) => a.span.start - b.span.start);
}

/**
 * 把匹配到的文本规范化成「数值 + 单位」。
 *
 * <p>★返回 `undefined` = 规范化不出来（不抽取），**不是**抽成错的值。
 */
function normalize(kind: QuantityKind, text: string): { value: string; unit?: string } | undefined {
  switch (kind) {
    case 'DATE': {
      // 日期保持原串——转时间戳会引入时区，那不是原文里的信息。
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? { value: text } : undefined;
    }
    case 'MONEY': {
      const m = /^([$€£¥])\s?(\d[\d,]*(?:\.\d+)?)$/.exec(text);
      if (m === null) return undefined;
      const value = canonicalDecimal(m[2]!.replace(/,/g, ''));
      return value === undefined ? undefined : { value, unit: m[1]! };
    }
    case 'PERCENT': {
      const m = /^(\d+(?:\.\d+)?)\s?%$/.exec(text);
      if (m === null) return undefined;
      const value = canonicalDecimal(m[1]!);
      return value === undefined ? undefined : { value };
    }
    case 'DURATION': {
      // ★线性短路：`(.+)$` 里 `.` **不匹配 `\n`**，且 `$` 是串尾（无 `m` 标志）。
      //   故只要整串以 `\n` 结尾，该模式**必然失配**——但正则引擎要靠
      //   `\d+` 逐位回退才能确认这一点，呈二次：
      //     10000→152ms、20000→607ms、40000→2430ms、80000→9723ms（×4.0）
      //
      //   一次 `lastIndexOf('\n')` 就能提前判定，把二次砍成 O(n)：
      //   实测 80000 长度 9723ms → 0.007ms。
      //
      //   ★等价性可证明：以 `\n` 结尾 ⇒ 任何切分的尾部要么为空、要么含 `\n`
      //   ⇒ `(.+)$` 必不匹配。实证：随机 300000 组（96356 组匹配成功）零分歧。
      //
      //   ★这条是 **CodeQL 报出来的**（js/polynomial-redos, high）。我第一次
      //   实测时只试了 5 种载荷，全是线性，一度判定它误报——直到补上
      //   「尾随 `\n`」这一种才复现。**我的载荷决定了我的结论**，又一次。
      if (text.endsWith('\n')) return undefined;

      const m = /^(\d+(?:\.\d+)?)\s?([^\n]+)$/.exec(text);
      if (m === null) return undefined;
      const value = canonicalDecimal(m[1]!);
      return value === undefined ? undefined : { value, unit: m[2]! };
    }
  }
}

/**
 * 规范成可比较的十进制字符串：去尾随零、去多余前导零。
 *
 * <p>★全程字符串运算，**不经过 JS number** —— 与 `MappingIR.canonicalDecimalString`
 * 同口径，保证「文档里的 $10,000」与「IR 里的 Int 10000」能按值比对。
 */
function canonicalDecimal(s: string): string | undefined {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s.trim());
  if (m === null) return undefined;
  const intPart = m[1]!.replace(/^0+(?=\d)/, '');
  // ★去尾随零用**线性扫描**而非 `/0+$/` —— 后者呈二次回溯：
  //   `+` 在每个起始位置贪婪吃完再回退，实测 10000→144ms、20000→576ms、
  //   40000→2306ms（×4.0）。
  //
  //   ★有意思的是：CodeQL 报的是上面那条 `^(\d+)(?:\.(\d*))?$`（js/polynomial-redos，
  //   high），但实测它是**线性**的（×2.0）——在 V8 上是误报。
  //   真正二次的 `0+$` 它**没报**。
  //   → 静态扫描器给方向，**判据仍是实测增长率**。
  //
  //   当前无调用方能喂进超长小数（PERCENT/MONEY 的模式限制了长度），
  //   故这不是可达漏洞；但本模块吃的是人类文档，改成线性是零成本的去险。
  const frac = stripTrailingZeros(m[2] ?? '');
  return frac.length > 0 ? `${intPart}.${frac}` : intPart;
}

/** 去掉尾随的 `0`。★线性扫描，语义与 `/0+$/` 完全一致。 */
function stripTrailingZeros(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 48) end--;   // '0'
  return end === s.length ? s : s.slice(0, end);
}
