/**
 * LayoutMap 的数据形态与稳定错误码（ADR 0058 §7.3、§7.5）。
 *
 * LayoutMap 是同一份 canonical 源码的第二种排版，只给人看：内容 span 在两个视图里原样出现，
 * 结构 span 在 canonical 里是 `canonical`、在 display 里换成 `display`（可为空串以隐藏）。
 */

/** 内容 span `{ text }`，或结构 span `{ canonical, display }`；按 canonical 源码顺序排列。 */
export type LayoutSpan = { text: string } | { canonical: string; display: string };

/** 一份 layout；`v` 为格式版本，当前恒为 1。 */
export interface PolicyLayout {
  v: 1;
  spans: LayoutSpan[];
}

/** 规模上限（§7.6）。字节一律按 UTF-8 计；单个结构 span 的 display 按字符（Unicode 码点）计。 */
export const LAYOUT_LIMITS = {
  sourceBytes: 12288,
  sourceLines: 200,
  spans: 400,
  serializedBytes: 49152,
  displayBytes: 24576,
  structuralDisplayChars: 256,
} as const;

export type LayoutLimitName = keyof typeof LAYOUT_LIMITS;

/** §7.5 的稳定错误码；cloud 原样作为 400 响应的 `code`。 */
export type LayoutErrorCode =
  | 'layout_invalid_format'
  | 'layout_too_large'
  | 'layout_roundtrip_mismatch'
  | 'layout_structural_hides_value'
  | 'layout_content_parity'
  | 'layout_display_mismatch'
  | 'layout_structural_hides_operator'
  /** L10a（ADR 0059 修订 5）：隐藏转义符的形状不合规 */
  | 'layout_escape_delimiter_invalid'
  /** L10b：去掉被隐藏的反引号会得到另一个程序，或无法证明不会（未给编译上下文） */
  | 'layout_hidden_escape_changes_program';

/** 包格式 1.1 的排版规则号（ADR 0059 修订 4 §4）；只由 `./layout` 的包规则函数填入。 */
export type LayoutRule = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8' | 'L9' | 'L10a' | 'L10b';

/** 失败的附加定位：`offset` 为 canonical 源码中的 UTF-16 偏移；`limit` 为超出的上限名。 */
export interface LayoutErrorDetail {
  offset?: number;
  limit?: LayoutLimitName;
  rule?: LayoutRule;
}

/** parseLayout / serializeLayout 拒绝时抛出；validatePolicyLayout 把它转成 `LayoutValidation`。 */
export class LayoutError extends Error {
  readonly code: LayoutErrorCode;
  readonly offset?: number;
  readonly limit?: LayoutLimitName;
  /** 包规则（L1–L9）失败时的规则号；保存校验 validatePolicyLayout 不填 */
  readonly rule?: LayoutRule;

  constructor(code: LayoutErrorCode, message: string, detail: LayoutErrorDetail = {}) {
    super(message);
    this.name = 'LayoutError';
    this.code = code;
    if (detail.offset !== undefined) this.offset = detail.offset;
    if (detail.limit !== undefined) this.limit = detail.limit;
    if (detail.rule !== undefined) this.rule = detail.rule;
  }
}

export type LayoutValidation =
  | { ok: true }
  | ({ ok: false; code: LayoutErrorCode; message: string } & LayoutErrorDetail);

/** 偏移映射的结果区间 [start, end)；内容 span 内的偏移映射为 start === end 的一个点。 */
export interface LayoutRange {
  start: number;
  end: number;
}
