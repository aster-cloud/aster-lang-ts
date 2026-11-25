/**
 * 名字转义 `` `x` ``（ADR 0064）在规范化阶段的片段识别：规范化器各步与变换器共用，保证每一步看到同一组不透明片段。
 */

/**
 * 名字转义片段的结束位置（ADR 0064 N2a）：text[i] 是反引号且同一行里还有一个反引号时返回后者的下标，否则 -1。
 * 未闭合的反引号不形成片段，留给词法器报 E902。只看字符，不判断内容是否合法。与 aster-lang-core
 * Canonicalizer.escapeClose 相同。
 */
export function escapeClose(text: string, i: number): number {
  if (text[i] !== '`') return -1;
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j];
    if (c === '`') return j;
    if (c === '\n' || c === '\r') return -1;
  }
  return -1;
}
