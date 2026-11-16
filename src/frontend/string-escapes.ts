/**
 * 字符串字面量转义：`lexer.ts` 中 `readEscape` 的逆。
 *
 * 把任意字符串值写成可放进当前 lexicon 引号之间的字面量内容，使 lex 读回的值与原值逐码元相等。
 * 结束引号可能不是 ASCII（zh-CN 为「」），lexer 见到它就结束字符串，故结束引号也必须转义；
 * `readEscape` 没有对应的单字符转义，只能写作 `\uXXXX`。
 */

/** 有单字符转义的字符（与 readEscape 的 switch 分支一一对应，`/` 无需转义故不列出）。 */
const SIMPLE_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['\\', '\\\\'],
  ['"', '\\"'],
  ["'", "\\'"],
  ['\n', '\\n'],
  ['\r', '\\r'],
  ['\t', '\\t'],
  ['\b', '\\b'],
  ['\f', '\\f'],
  ['\0', '\\0'],
]);

function unicodeEscape(unit: number): string {
  return '\\u' + unit.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * 转义字符串值。`closeQuote` 为当前 lexicon 的结束引号；它可能由多个码元组成，逐码元写作 `\uXXXX`。
 * 其余 U+0000–U+001F 控制字符写作 `\uXXXX`，其它字符（含代理对）原样保留。
 */
export function escapeStringLiteral(value: string, closeQuote: string): string {
  let out = '';
  let i = 0;
  while (i < value.length) {
    if (closeQuote && !SIMPLE_ESCAPES.has(closeQuote) && value.startsWith(closeQuote, i)) {
      for (let k = 0; k < closeQuote.length; k++) out += unicodeEscape(closeQuote.charCodeAt(k));
      i += closeQuote.length;
      continue;
    }
    const ch = value[i]!;
    const unit = value.charCodeAt(i);
    out += SIMPLE_ESCAPES.get(ch) ?? (unit <= 0x1f ? unicodeEscape(unit) : ch);
    i++;
  }
  return out;
}
