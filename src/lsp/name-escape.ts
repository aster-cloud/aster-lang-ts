/**
 * LSP 的名字转义支持（ADR 0064 §6）：语义着色、悬停、快速修复「用作名字」与补全时插入转义写法共用的判定。
 */
import type { TextEdit } from 'vscode-languageserver/node.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { EN_US } from '../config/lexicons/en-US.js';
import { escapeClose } from '../frontend/name-escape.js';
import type { Token } from '../types.js';

/** 名字写成转义 `` `x` ``。 */
export function escapedName(name: string): string {
  return `\`${name}\``;
}

/** 词法表全部关键词（规范拼写与官方别名）的单词，小写。 */
function keywordWords(lexicon: Lexicon): Set<string> {
  const out = new Set<string>();
  const phrases = [...Object.values(lexicon.keywords), ...Object.values(lexicon.aliases ?? {}).flat()];
  for (const phrase of phrases) {
    for (const word of String(phrase ?? '').toLowerCase().split(/\s+/)) if (word !== '') out.add(word);
  }
  return out;
}

const WORDS_CACHE = new WeakMap<Lexicon, Set<string>>();

/**
 * 名字是否与关键词同形（作者语言的词法表或 en-US，大小写不敏感）：补全在名字位置插入这类名字时写成转义，
 * 否则它可能被读成关键词（ADR 0064 §6「补全」）。
 */
export function isKeywordHomograph(name: string, lexicon: Lexicon | undefined): boolean {
  const lower = name.toLowerCase();
  for (const lex of lexicon && lexicon !== EN_US ? [lexicon, EN_US] : [EN_US]) {
    let words = WORDS_CACHE.get(lex);
    if (!words) {
      words = keywordWords(lex);
      WORDS_CACHE.set(lex, words);
    }
    if (words.has(lower)) return true;
  }
  return false;
}

/** 补全插入的名字文本：关键词同形词写成转义，其余原样。 */
export function completionName(name: string, lexicon: Lexicon | undefined): string {
  return isKeywordHomograph(name, lexicon) ? escapedName(name) : name;
}

/** 光标（0 基 LSP 位置）所在的转义 token；不在转义上时为 undefined。 */
export function escapedTokenAt(tokens: readonly Token[], pos: { line: number; character: number }): Token | undefined {
  const line = pos.line + 1;
  const col = pos.character + 1;
  return tokens.find(t => t?.escaped === true && t.start.line === line && t.start.col <= col && col < t.end.col);
}

/** 悬停在转义名上时的说明行。 */
export function escapedHoverLine(tokens: readonly Token[], pos: { line: number; character: number }): string | null {
  const t = escapedTokenAt(tokens, pos);
  return t ? `escaped name ${escapedName(String(t.value))} (a name, not a keyword)` : null;
}

/** 标识符字符（四个语言包的词法字符，含组合记号），用于整词判定。 */
const IDENT_CHAR = /[\p{L}\p{M}\p{Nd}_]/u;

/**
 * 快速修复「用作名字」：把文档里该词的每个整词出现（字符串、注释与已有转义之外）改写为 `` `word` ``。
 * 对 E901、W802、E808 与关键词误作名字的错误都适用：改写后该词在所有位置都是名字（ADR 0064 N1、N6）。
 */
export function escapeAllOccurrences(text: string, word: string): TextEdit[] {
  const edits: TextEdit[] = [];
  if (word === '' || word.includes('`')) return edits;
  const lines = text.split('\n');
  lines.forEach((line, lineNo) => {
    let quote: string | null = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (quote !== null) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === '「' || ch === '“') {
        quote = ch === '「' ? '」' : ch === '“' ? '”' : '"';
        continue;
      }
      if (ch === '#' || (ch === '/' && line[i + 1] === '/')) break;
      const close = escapeClose(line, i);
      if (close > 0) {
        i = close;
        continue;
      }
      if (!line.startsWith(word, i)) continue;
      const before = i > 0 ? line[i - 1]! : '';
      const after = line[i + word.length] ?? '';
      if ((before !== '' && IDENT_CHAR.test(before)) || (after !== '' && IDENT_CHAR.test(after))) continue;
      edits.push({
        range: { start: { line: lineNo, character: i }, end: { line: lineNo, character: i + word.length } },
        newText: escapedName(word),
      });
      i += word.length - 1;
    }
  });
  return edits;
}
