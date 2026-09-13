import type { CstModule } from './cst.js';

function reflowSeams(text: string): string {
  let s = text;
  // Collapse '. :' → ':' (optionally with spaces)
  s = s.replace(/\.\s*:/g, ':');
  // Remove spaces before punctuation ., : ! ? ;
  // ★以下三条的左锚都是 **ReDoS 修复**，不是可选优化。
  //   无锚时 `\s+`/`[ \t]+`/`\n+` 会从空白 run 的**每个**位置重新起跑并扫到
  //   串尾（后缀失配时全部回退），呈二次增长。本函数吃的是**用户源码**
  //   （LSP 格式化 / formatter），属攻击者可控输入。
  //   左锚不改语义：一段空白的**起点**前面不可能还是同类空白。
  //
  //   实测（改前 / 改后均为 n=10000→20000→40000）：
  //     \s+([.,:!?;])   162ms → 668ms → 2571ms（×4.0）
  //     [ \t]+(?=\n)    224ms → 895ms → 3599ms（×4.0）
  //     \n+$            144ms → 576ms → 2297ms（×4.0）
  //
  //   ★第三条 `\n+$` 是**补测出来的**：它只在「失配后缀」载荷上暴露
  //   （`'x' + '\n'.repeat(n) + 'y'`——结尾不是行尾）。用「匹配成功」的载荷
  //   完全看不见——这正是本轮审计反复吃到的教训。
  //
  //   等价性实证：随机 200000 组，三条分别有 125136 / 20548 / 2586 组确有替换
  //   （证明样本非空洞），逐字节零分歧。
  s = s.replace(/(?<!\s)\s+([.,:!?;])/g, '$1');
  // Trim trailing spaces at end of lines
  s = s.replace(/(?<![ \t])[ \t]+(?=\n)/g, '');
  // Ensure at most one trailing newline
  s = s.replace(/(?<!\n)\n+$/g, '\n');
  return s;
}

// Lossless CST printer: re-emit the original bytes using token offsets and the
// captured fullText. Falls back to concatenating token lexemes with leading /
// trailing trivia if fullText is not present.
export function printCNLFromCst(mod: CstModule, opts?: { reflow?: boolean }): string {
  const tokens = mod.tokens || [];
  const src = mod.fullText;
  if (src && tokens.length > 0) {
    let out = '';
    // Leading trivia
    out += src.slice(0, tokens[0]!.startOffset);
    for (let i = 0; i < tokens.length; i++) {
      const prevEnd = i === 0 ? tokens[0]!.startOffset : tokens[i - 1]!.endOffset;
      const cur = tokens[i]!;
      out += src.slice(prevEnd, cur.startOffset); // inter-token trivia
      out += src.slice(cur.startOffset, cur.endOffset); // token lexeme
    }
    // Trailing trivia
    out += src.slice(tokens[tokens.length - 1]!.endOffset);
    return opts?.reflow ? reflowSeams(out) : out;
  }
  // Fallback path (no fullText): stitch together leading + lexemes + trailing
  let out = mod.leading?.text ?? '';
  out += tokens.map(t => t.lexeme).join('');
  out += mod.trailing?.text ?? '';
  return opts?.reflow ? reflowSeams(out) : out;
}

// Print a range from the original source using offsets from the same text used
// to build the CST. If reflow is requested, apply the minimal seam fixes within
// the slice only (does not adjust surrounding context).
export function printRangeFromCst(
  mod: CstModule,
  startOffset: number,
  endOffset: number,
  opts?: { reflow?: boolean }
): string {
  const src = mod.fullText || '';
  const slice = src.slice(startOffset, endOffset);
  return opts?.reflow ? reflowSeams(slice) : slice;
}
