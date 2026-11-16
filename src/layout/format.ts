/**
 * LayoutMap 的拼接、结构校验与确定性序列化（ADR 0058 §7.3）。
 *
 * 序列化形态固定为 `{"v":1,"spans":[…]}`：内容 span 为 `{"text":…}`，结构 span 为
 * `{"canonical":…,"display":…}`，键序固定、无多余空白、字符串按 JSON.stringify 转义；
 * 相邻内容 span 先合并，同一排版只有一种文本，`layoutSha256` 才能复现。
 */
import { LAYOUT_LIMITS, LayoutError } from './types.js';
import type { LayoutSpan, PolicyLayout } from './types.js';

/** span 在 canonical 视图中的文字 */
export function canonicalOf(span: LayoutSpan): string {
  return 'text' in span ? span.text : span.canonical;
}

/** span 在 display 视图中的文字 */
export function displayOf(span: LayoutSpan): string {
  return 'text' in span ? span.text : span.display;
}

/** 编译用的规范源码：各 span 的 canonical 侧依次拼接 */
export function toCanonical(layout: PolicyLayout): string {
  return layout.spans.map(canonicalOf).join('');
}

/** 给人看的显示排版：各 span 的 display 侧依次拼接 */
export function toDisplay(layout: PolicyLayout): string {
  return layout.spans.map(displayOf).join('');
}

/** UTF-8 字节数（不依赖 TextEncoder，按码点累计；孤立代理按替换字符 3 字节计） */
export function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

function invalid(message: string): LayoutError {
  return new LayoutError('layout_invalid_format', message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(obj);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(obj, k));
}

/** 校验单个 span 的形态，返回只含已知键的副本 */
function readSpan(raw: unknown, index: number): LayoutSpan {
  if (isPlainObject(raw) && hasExactKeys(raw, ['text'])) {
    if (typeof raw.text !== 'string' || raw.text === '') throw invalid(`spans[${index}].text must be a non-empty string`);
    return { text: raw.text };
  }
  if (isPlainObject(raw) && hasExactKeys(raw, ['canonical', 'display'])) {
    if (typeof raw.canonical !== 'string' || raw.canonical === '') {
      throw invalid(`spans[${index}].canonical must be a non-empty string`);
    }
    if (typeof raw.display !== 'string') throw invalid(`spans[${index}].display must be a string`);
    return { canonical: raw.canonical, display: raw.display };
  }
  throw invalid(`spans[${index}] must be exactly {text} or {canonical, display}`);
}

const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/**
 * 同一视图里相邻的两段非空文字不得把一个代理对拆开（§7.8：span 边界不落在字符中间）。
 * 空串不占位置，所以跨过 display 为空的结构 span 也要检查。
 */
function assertNoSplitSurrogate(pieces: readonly string[], view: string): void {
  let prev = '';
  for (const piece of pieces) {
    if (piece === '') continue;
    if (prev !== '' && isHigh(prev.charCodeAt(prev.length - 1)) && isLow(piece.charCodeAt(0))) {
      throw invalid(`a surrogate pair is split across spans in the ${view} view`);
    }
    prev = piece;
  }
}

/**
 * §7.3 的结构校验：恰为 `{ v: 1, spans }`，spans 非空，每个 span 恰为两种形态之一，
 * `text` 与结构 span 的 `canonical` 非空，任一视图里 span 边界不拆代理对。
 * 返回只含已知键的副本；不合规时抛 `layout_invalid_format`。
 */
export function readLayout(value: unknown): PolicyLayout {
  if (!isPlainObject(value) || !hasExactKeys(value, ['v', 'spans'])) {
    throw invalid('layout must be exactly {v, spans}');
  }
  if (value.v !== 1) throw invalid('layout.v must be 1');
  if (!Array.isArray(value.spans) || value.spans.length === 0) throw invalid('layout.spans must be a non-empty array');
  const spans = value.spans.map(readSpan);
  assertNoSplitSurrogate(spans.map(canonicalOf), 'canonical');
  assertNoSplitSurrogate(spans.map(displayOf), 'display');
  return { v: 1, spans };
}

/** 合并相邻内容 span（结构 span 各自携带一段映射，不合并） */
export function mergeContentSpans(spans: readonly LayoutSpan[]): LayoutSpan[] {
  const out: LayoutSpan[] = [];
  for (const span of spans) {
    const last = out[out.length - 1];
    if ('text' in span && last && 'text' in last) {
      out[out.length - 1] = { text: last.text + span.text };
    } else {
      out.push(span);
    }
  }
  return out;
}

function serializeSpan(span: LayoutSpan): string {
  return 'text' in span
    ? `{"text":${JSON.stringify(span.text)}}`
    : `{"canonical":${JSON.stringify(span.canonical)},"display":${JSON.stringify(span.display)}}`;
}

/** 确定性序列化；先做结构校验，不合规的 layout 抛 `layout_invalid_format` 而不产出文本 */
export function serializeLayout(layout: PolicyLayout): string {
  const spans = mergeContentSpans(readLayout(layout).spans);
  return `{"v":1,"spans":[${spans.map(serializeSpan).join(',')}]}`;
}

/**
 * 解析 layout 文本（存储列或导入的手写 JSON）。键序与空白不限；超过 serializedBytes 的文本
 * 不解析（`layout_too_large`），其余拒绝一律 `layout_invalid_format`。
 */
export function parseLayout(text: string): PolicyLayout {
  if (utf8Length(text) > LAYOUT_LIMITS.serializedBytes) {
    throw new LayoutError('layout_too_large', `layout text exceeds ${LAYOUT_LIMITS.serializedBytes} bytes`, {
      limit: 'serializedBytes',
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw invalid('layout text is not valid JSON');
  }
  return readLayout(value);
}
