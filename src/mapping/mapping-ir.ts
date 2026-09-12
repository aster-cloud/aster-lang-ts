/**
 * MappingIR —— 「人类文本片段 ↔ Core IR 节点」的可验证映射（ADR 0037 §4/§7）。
 *
 * <h2>本模块的范围：只做「机器能证明的那一类」</h2>
 *
 * ADR §3 定的分工是：
 *
 * ```
 *   LLM / 启发式 / 人   →  提出候选映射（candidate）
 *   确定性 verifier     →  判定 verified / review-required / rejected
 * ```
 *
 * **AI 可以提出映射，但不能定义什么叫正确。** 本模块实现的是那个
 * **确定性 verifier**，且只覆盖「能机械证明」的一类：**精确值字面量**
 * （`"$10,000"` ↔ `Decimal("10000")`）。
 *
 * 带业务含义的映射（`"requires approval"` ↔ `RequireApprovalBeforeExecution`）
 * 本模块一律判 `REVIEW_REQUIRED` —— **不猜**。这与 §3 的
 * 「Human reviews only what machines cannot prove」一致。
 *
 * <h2>★硬约束：只能读两引擎已经一致的那部分（ADR §5 / §5.1）</h2>
 *
 * 归一化（`ir-normalize`，与 parity 门禁同源）会剥掉 derived analysis：
 *
 * ```
 *   type, ret, retType, typeParams, typeInferred, retTypeInferred,
 *   constraints, piiCategories, piiLevel, effectCaps, effectCapsExplicit, captures
 * ```
 *
 * 因此 verifier **只能**依赖：`kind`、`value`、`name`、`origin`、`nodeId`。
 *
 * ★ADR §7 原文举的 `"$10,000" ↔ Money(10000)` **不可验证**——`Money` 是
 * **类型**，而类型层是两引擎合法分叉的层。可验证的写法是
 * `"$10,000" ↔ Decimal("10000")`（`Decimal` 是**节点 kind**，归一化后保留）。
 *
 * <h2>★第二个坑：canonical 形态 ≠ 源码文本</h2>
 *
 * `100.00m` 在 IR 里是 `{kind:"Decimal", value:"100"}`——尾随零被规范化掉。
 * 故**不能做字符串相等比较**，必须按值比较。
 */

/** 人类文本里的一段（字符偏移，半开区间 `[start, end)`）。 */
export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

/** 一条**候选**映射：由 LLM / 启发式 / 人提出，尚未判定。 */
export interface CandidateMapping {
  /** 人类 artifact 里的文本片段位置。 */
  readonly span: TextSpan;
  /** 该片段的原文（冗余存一份，便于 verifier 独立核对，不依赖调用方重新切片）。 */
  readonly text: string;
  /** 目标 Core IR 节点的稳定标识（`NodeIdMap` 的 nodeId）。 */
  readonly nodeId: string;
}

export type VerificationVerdict =
  /** 机器已证明：文本与目标节点的值精确对应。 */
  | 'VERIFIED'
  /** 机器无法证明，需要人（领域专家 / 程序员）确认。**不是**「错」。 */
  | 'REVIEW_REQUIRED'
  /** 机器已证伪：文本与目标节点的值**矛盾**。 */
  | 'REJECTED';

export interface VerificationResult {
  readonly mapping: CandidateMapping;
  readonly verdict: VerificationVerdict;
  /** 判定依据（人类可读），**始终**给出——包括 VERIFIED，便于审计复核。 */
  readonly reason: string;
  /** 目标节点的 kind（若节点存在）。 */
  readonly nodeKind?: string;
}

/** verifier 需要的最小节点信息——**刻意**只暴露合法字段，从类型上挡住误用。 */
export interface VerifiableNode {
  readonly kind: string;
  /** 字面量的值；非字面量节点为 `undefined`。 */
  readonly value?: unknown;
  /** 声明/引用的名字；无名节点为 `undefined`。 */
  readonly name?: string;
}

/**
 * 能被机械验证的字面量 kind，及其**值比较**方式。
 *
 * ★`Double` **不在**此列：它在 IR 里用 JS `number` 承载，源码文本与 IR 值
 * **不可逆**（实测 `1.0` → `1`、`1e3` → `1000`）。机器无法证明「这段文本
 * 就是这个 Double」，故一律交人复核，而不是用一个近似规则假装能证。
 */
const EXACT_VALUE_KINDS = new Set(['Int', 'Long', 'Decimal', 'String', 'Bool', 'PatInt']);

/**
 * 验证一条候选映射。
 *
 * @param mapping  候选映射
 * @param resolve  按 nodeId 取节点；返回 `undefined` 表示节点不存在
 */
export function verifyMapping(
  mapping: CandidateMapping,
  resolve: (nodeId: string) => VerifiableNode | undefined,
): VerificationResult {
  const span = mapping.span;
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0
      || span.end <= span.start) {
    return result(mapping, 'REJECTED',
      `文本区间非法：[${span.start}, ${span.end}) —— 必须是 start ≥ 0 且 end > start 的整数区间。`);
  }
  if (mapping.text.length !== span.end - span.start) {
    // ★区间长度与文本长度必须自洽，否则 span 指向的根本不是这段文本。
    //   不自洽时**不能**默默采信 text —— 那会让「双向导航」跳到错误位置。
    return result(mapping, 'REJECTED',
      `text 长度 ${mapping.text.length} 与区间宽度 ${span.end - span.start} 不符。`);
  }

  const node = resolve(mapping.nodeId);
  if (node === undefined) {
    return result(mapping, 'REJECTED', `目标节点不存在：${mapping.nodeId}`);
  }

  if (!EXACT_VALUE_KINDS.has(node.kind)) {
    // 非精确值节点（Call / If / Func / Double …）：机器证不了，交人。
    // ★这**不是**失败。ADR §3：Human reviews only what machines cannot prove。
    return result(mapping, 'REVIEW_REQUIRED',
      `目标是 ${node.kind} 节点，不属于可机械证明的精确值字面量`
      + `（${[...EXACT_VALUE_KINDS].join('/')}）——需人工确认语义对应关系。`,
      node.kind);
  }

  const literal = parseLiteralFromText(mapping.text, node.kind);
  if (literal === undefined) {
    return result(mapping, 'REVIEW_REQUIRED',
      `无法从文本「${mapping.text}」中机械解析出 ${node.kind} 值——需人工确认。`,
      node.kind);
  }

  if (valuesEqual(literal, node.value, node.kind)) {
    return result(mapping, 'VERIFIED',
      `文本「${mapping.text}」解析为 ${node.kind} ${JSON.stringify(literal)}，`
      + `与目标节点的值一致。`, node.kind);
  }

  return result(mapping, 'REJECTED',
    `文本「${mapping.text}」解析为 ${JSON.stringify(literal)}，`
    + `但目标节点的值是 ${JSON.stringify(node.value)} —— 两者矛盾。`, node.kind);
}

function result(mapping: CandidateMapping, verdict: VerificationVerdict,
                reason: string, nodeKind?: string): VerificationResult {
  return { mapping, verdict, reason, ...(nodeKind === undefined ? {} : { nodeKind }) };
}

/**
 * 从人类文本里机械解析出字面量值。
 *
 * <p>返回 `undefined` = 解析不出来（→ 交人复核），**不是**解析成错的值。
 *
 * <p>★容许人类书写惯例（货币符号、千分位、前后空白），因为这正是
 * MappingIR 要跨越的鸿沟：`"$10,000"` 与 `10000` 之间那一步。
 */
function parseLiteralFromText(text: string, kind: string): unknown {
  const t = text.trim();
  if (t.length === 0) return undefined;

  switch (kind) {
    case 'Bool': {
      const lower = t.toLowerCase();
      if (lower === 'true' || lower === 'yes') return true;
      if (lower === 'false' || lower === 'no') return false;
      return undefined;
    }
    case 'String': {
      // 带引号则剥掉引号；否则取原文。★不做 trim 之外的任何改写——
      //   字符串的值是什么就是什么，规范化会制造假匹配。
      if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"'))
          || (t[0] === "'" && t.endsWith("'")))) {
        return t.slice(1, -1);
      }
      return text;
    }
    case 'Int':
    case 'Long':
    case 'PatInt':
    case 'Decimal': {
      const numeric = stripHumanNumberDecorations(t);
      if (numeric === undefined) return undefined;
      return numeric;
    }
    default:
      return undefined;
  }
}

/**
 * 剥掉人类数字书写的装饰：货币符号、千分位逗号、正号。
 *
 * <p>返回**规范化后的十进制字符串**（保留符号与小数点），无法识别时返回
 * `undefined`。★不转成 JS number —— Long/Decimal 超出 number 安全范围时
 * 会静默丢精度（`9007199254740993` → `…992`，本仓已实测踩过）。
 */
function stripHumanNumberDecorations(t: string): string | undefined {
  // 允许：可选货币符号 → 可选正负号 → 数字（可含千分位逗号）→ 可选小数部分
  const m = /^[$€£¥]?\s*([+-]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(t);
  if (m === null) return undefined;
  const sign = m[1] === '-' ? '-' : '';
  const intPart = m[2]!.replace(/,/g, '');
  const frac = m[3];
  return frac === undefined ? `${sign}${intPart}` : `${sign}${intPart}.${frac}`;
}

/**
 * 按**值**比较，不按文本。
 *
 * <p>★`100.00m` 在 IR 里是 `value:"100"`（尾随零被规范化）。若做字符串相等，
 * 文本 `"$10,000.00"` 会验不过一个数值上完全正确的 `Decimal("10000")`。
 */
function valuesEqual(fromText: unknown, fromNode: unknown, kind: string): boolean {
  if (kind === 'Bool') return fromText === fromNode;
  if (kind === 'String') return fromText === fromNode;

  // 数值类：两侧都规范成十进制字符串再比，全程不经过 JS number（避免精度丢失）。
  const a = canonicalDecimalString(fromText);
  const b = canonicalDecimalString(fromNode);
  return a !== undefined && b !== undefined && a === b;
}

/**
 * 把数值规范成可比较的十进制字符串：去尾随零、去多余前导零、`-0` → `0`。
 *
 * <p>全程字符串运算，**不经过 JS number** —— 超安全整数范围的 Long
 * 一旦过一次 number 就会静默丢精度。
 */
function canonicalDecimalString(v: unknown): string | undefined {
  let s: string;
  if (typeof v === 'string') s = v.trim();
  else if (typeof v === 'number') {
    if (!Number.isFinite(v)) return undefined;
    s = String(v);
  } else if (typeof v === 'bigint') s = v.toString();
  else return undefined;

  const m = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(s);
  if (m === null) return undefined;
  const sign = m[1] === '-' ? '-' : '';
  const intPart = m[2]!.replace(/^0+(?=\d)/, '');
  const frac = (m[3] ?? '').replace(/0+$/, '');
  const body = frac.length > 0 ? `${intPart}.${frac}` : intPart;
  // -0 / -0.0 归一为 0
  return /^0(?:\.0*)?$/.test(body) ? intPart : `${sign}${body}`;
}
