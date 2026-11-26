/**
 * LSP 的名字转义支持（ADR 0064 §6）：语义着色、悬停、快速修复「用作名字」（候选出现，名字位置的判定见 name-escape-fix.ts）与补全时插入转义写法共用的判定。
 */
import type { TextEdit } from 'vscode-languageserver/node.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { EN_US } from '../config/lexicons/en-US.js';
import { escapeClose } from '../frontend/name-escape.js';
import { buildFullTranslationIndex } from '../frontend/keyword-translator.js';
import { STRUCTURAL_KEYWORD_NAMES } from '../parser/parse-issue.js';
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
 * 该词的每个整词出现（字符串、注释与已有转义之外）改写为 `` `word` `` 的编辑，按位置排序：快速修复「用作名字」的候选集。
 * 词法上分不清名字与关键词，快速修复只取其中编译判定在名字位置上的子集（ADR 0064 §6 N1 修订，#404，见 name-escape-fix.ts）。
 */
export function escapeAllOccurrences(text: string, word: string, lexicon?: Lexicon): TextEdit[] {
  const edits: TextEdit[] = [];
  // 转义里只能是一个标识符词素（ADR 0064 §3）：含反引号或空白（多词关键词 `gib zurueck`）的写法转义后是 E902，不给修复
  if (word === '' || word.includes('`') || /\s/u.test(word)) return edits;
  // 字符串定界符：词法器认 ASCII `"`、作者词法表的引号对与弯引号 “”（引号归一把它换成定界符）
  const quotes = lexicon?.punctuation.stringQuotes ?? EN_US.punctuation.stringQuotes;
  const closers = new Map<string, string>([['"', '"'], ['“', '”'], ['「', '」'], [quotes.open, quotes.close]]);
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
      const close = closers.get(ch);
      if (close !== undefined) {
        quote = close;
        continue;
      }
      if (ch === '#' || (ch === '/' && line[i + 1] === '/')) break;
      const escapeEnd = escapeClose(line, i);
      if (escapeEnd > 0) {
        i = escapeEnd;
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

const PHRASES_CACHE = new WeakMap<Lexicon, { readonly phrases: ReadonlySet<string>; readonly maxWords: number }>();

/** 词法表里多词结构关键词（E901 的对象）的小写写法，含规范化变体（de `gib zurueck` / `gib zurück`），与关键词翻译同一索引。 */
function structuralPhrases(lexicon: Lexicon): { readonly phrases: ReadonlySet<string>; readonly maxWords: number } {
  let entry = PHRASES_CACHE.get(lexicon);
  if (!entry) {
    const phrases = new Set<string>();
    let maxWords = 1;
    for (const [source, target] of buildFullTranslationIndex(lexicon).index) {
      const words = source.split(' ').length;
      if (words < 2 || !STRUCTURAL_KEYWORD_NAMES.has(target)) continue;
      phrases.add(source);
      maxWords = Math.max(maxWords, words);
    }
    entry = { phrases, maxWords };
    PHRASES_CACHE.set(lexicon, entry);
  }
  return entry;
}

/**
 * 诊断范围为空时（E901 的 span 是关键词起点的零宽位置，编译器与 LSP 发布的诊断都如此），取该位置起的那个关键词的源码写法：
 * 起点必须在词首；多词结构关键词（de `Gib zurück`）按关键词翻译索引取整个短语，否则取该位置的整词。不在词首时为空串。
 */
export function keywordSpellingAt(text: string, pos: { line: number; character: number }, lexicon?: Lexicon): string {
  const line = text.split('\n')[pos.line] ?? '';
  const start = pos.character;
  if (start > 0 && IDENT_CHAR.test(line[start - 1]!)) return '';
  // 起点起的连续整词：[词首, 词尾) 的偏移；词之间只隔空格或制表符
  const words: [number, number][] = [];
  const maxWords = lexicon ? structuralPhrases(lexicon).maxWords : 1;
  let i = start;
  while (words.length < maxWords) {
    let end = i;
    while (end < line.length && IDENT_CHAR.test(line[end]!)) end++;
    if (end === i) break;
    words.push([i, end]);
    i = end;
    while (line[i] === ' ' || line[i] === '\t') i++;
  }
  if (words.length === 0) return '';
  for (let n = words.length; n >= 2 && lexicon; n--) {
    const phrase = words.slice(0, n).map(([s, e]) => line.slice(s, e).toLowerCase()).join(' ');
    if (structuralPhrases(lexicon).phrases.has(phrase)) return line.slice(start, words[n - 1]![1]);
  }
  return line.slice(start, words[0]![1]);
}
