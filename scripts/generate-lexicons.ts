/**
 * 词法表代码生成脚本。
 *
 * 读取 aster-lang-core 导出的 lexicons.json（Java 单一真源），
 * 为每个 locale 生成对应的 TypeScript 词法表文件。
 *
 * 用法：
 *   npx tsx scripts/generate-lexicons.ts [path-to-lexicons.json]
 *
 * 默认读取：../aster-lang-core/build/generated/lexicons/lexicons.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── JSON Schema ────────────────────────────────────────────

interface LexiconsJson {
  version: string;
  generatedAt: string;
  tokenKinds: string[];
  categories: Record<string, string[]>;
  lexicons: Record<string, ExportedLexicon>;
  checksum: string;
}

interface ExportedLexicon {
  id: string;
  name: string;
  direction: string;
  keywords: Record<string, string>;
  punctuation: {
    statementEnd: string;
    listSeparator: string;
    enumSeparator: string;
    blockStart: string;
    stringQuoteOpen: string;
    stringQuoteClose: string;
    markerOpen?: string;
    markerClose?: string;
  };
  canonicalization: {
    fullWidthToHalf: boolean;
    whitespaceMode: string;
    removeArticles: boolean;
    articles?: string[];
    customRules?: Array<{
      name: string;
      pattern: string;
      replacement: string;
    }>;
    allowedDuplicates?: string[][];
    compoundPatterns?: Array<{
      name: string;
      opener: string;
      contextualKeywords: string[];
      closer: string;
    }>;
    preTranslationTransformers?: string[];
    postTranslationTransformers?: string[];
  };
  messages: {
    unexpectedToken: string;
    expectedKeyword: string;
    undefinedVariable: string;
    typeMismatch: string;
    unterminatedString: string;
    invalidIndentation: string;
  };
}

// ─── 常量名映射 ─────────────────────────────────────────────

/** locale id → TS 常量名 */
function constName(localeId: string): string {
  return localeId.replace(/-/g, '_').toUpperCase();
}

// ─── 代码生成 ────────────────────────────────────────────────

function generateLexiconFile(lex: ExportedLexicon, tokenKinds: string[]): string {
  const lines: string[] = [];

  lines.push(`// @generated — 由 scripts/generate-lexicons.ts 自动生成，请勿手动修改`);
  lines.push(``);
  lines.push(`import { SemanticTokenKind } from '../token-kind.js';`);
  lines.push(`import type { Lexicon } from './types.js';`);
  lines.push(``);
  lines.push(`export const ${constName(lex.id)}: Lexicon = {`);
  lines.push(`  id: ${quote(lex.id)},`);
  lines.push(`  name: ${quote(lex.name)},`);
  lines.push(`  direction: ${quote(lex.direction)},`);
  lines.push(``);

  // keywords（按 tokenKinds 声明顺序）
  lines.push(`  keywords: {`);
  for (const kind of tokenKinds) {
    const value = lex.keywords[kind];
    if (value !== undefined) {
      lines.push(`    [SemanticTokenKind.${kind}]: ${quote(value)},`);
    }
  }
  lines.push(`  },`);
  lines.push(``);

  // punctuation
  lines.push(`  punctuation: {`);
  lines.push(`    statementEnd: ${quote(lex.punctuation.statementEnd)},`);
  lines.push(`    listSeparator: ${quote(lex.punctuation.listSeparator)},`);
  lines.push(`    enumSeparator: ${quote(lex.punctuation.enumSeparator)},`);
  lines.push(`    blockStart: ${quote(lex.punctuation.blockStart)},`);
  lines.push(`    stringQuotes: {`);
  lines.push(`      open: ${quote(lex.punctuation.stringQuoteOpen)},`);
  lines.push(`      close: ${quote(lex.punctuation.stringQuoteClose)},`);
  lines.push(`    },`);
  if (lex.punctuation.markerOpen && lex.punctuation.markerClose) {
    lines.push(`    markers: {`);
    lines.push(`      open: ${quote(lex.punctuation.markerOpen)},`);
    lines.push(`      close: ${quote(lex.punctuation.markerClose)},`);
    lines.push(`    },`);
  }
  lines.push(`  },`);
  lines.push(``);

  // canonicalization
  const canon = lex.canonicalization;
  lines.push(`  canonicalization: {`);
  lines.push(`    fullWidthToHalf: ${canon.fullWidthToHalf},`);
  lines.push(`    whitespaceMode: ${quote(canon.whitespaceMode.toLowerCase())},`);
  lines.push(`    removeArticles: ${canon.removeArticles},`);

  if (canon.articles && canon.articles.length > 0) {
    lines.push(`    articles: [${canon.articles.map(quote).join(', ')}],`);
  }

  if (canon.customRules && canon.customRules.length > 0) {
    lines.push(`    customRules: [`);
    for (const rule of canon.customRules) {
      lines.push(`      { name: ${quote(rule.name)}, pattern: ${quote(rule.pattern)}, replacement: ${quote(rule.replacement)} },`);
    }
    lines.push(`    ],`);
  }

  if (canon.allowedDuplicates && canon.allowedDuplicates.length > 0) {
    lines.push(`    allowedDuplicates: [`);
    for (const group of canon.allowedDuplicates) {
      const items = group.map(k => `SemanticTokenKind.${k}`).join(', ');
      lines.push(`      [${items}],`);
    }
    lines.push(`    ],`);
  }

  if (canon.compoundPatterns && canon.compoundPatterns.length > 0) {
    lines.push(`    compoundPatterns: [`);
    for (const cp of canon.compoundPatterns) {
      lines.push(`      {`);
      lines.push(`        name: ${quote(cp.name)},`);
      lines.push(`        opener: SemanticTokenKind.${cp.opener},`);
      lines.push(`        contextualKeywords: [`);
      for (const kw of cp.contextualKeywords) {
        lines.push(`          SemanticTokenKind.${kw},`);
      }
      lines.push(`        ],`);
      lines.push(`        closer: ${quote(cp.closer)},`);
      lines.push(`      },`);
    }
    lines.push(`    ],`);
  }

  // 丢弃 preTranslationTransformers / postTranslationTransformers（Java-only 概念）

  lines.push(`  },`);
  lines.push(``);

  // messages
  lines.push(`  messages: {`);
  lines.push(`    unexpectedToken: ${quote(lex.messages.unexpectedToken)},`);
  lines.push(`    expectedKeyword: ${quote(lex.messages.expectedKeyword)},`);
  lines.push(`    undefinedVariable: ${quote(lex.messages.undefinedVariable)},`);
  lines.push(`    typeMismatch: ${quote(lex.messages.typeMismatch)},`);
  lines.push(`    unterminatedString: ${quote(lex.messages.unterminatedString)},`);
  lines.push(`    invalidIndentation: ${quote(lex.messages.invalidIndentation)},`);
  lines.push(`  },`);

  lines.push(`};`);
  lines.push(``);

  return lines.join('\n');
}

/** 安全引号：使用单引号，转义内部单引号和反斜杠 */
function quote(s: string): string {
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
  return `'${escaped}'`;
}

// ─── 主流程 ──────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2).filter(a => a !== '--');
  const jsonPath = args[0]
    ?? resolve(__dirname, '../../aster-lang-core/build/generated/lexicons/lexicons.json');

  let json: LexiconsJson;
  try {
    json = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  } catch {
    console.error(`无法读取 lexicons.json: ${jsonPath}`);
    console.error('请先运行: cd ../aster-lang-core && ./gradlew exportLexicons');
    process.exit(1);
  }

  const outputDir = resolve(__dirname, '../src/config/lexicons');
  let generated = 0;

  for (const [localeId, lexicon] of Object.entries(json.lexicons)) {
    const filename = `${localeId}.ts`;
    const content = generateLexiconFile(lexicon, json.tokenKinds);
    const outputPath = resolve(outputDir, filename);
    writeFileSync(outputPath, content, 'utf-8');
    console.log(`生成: ${filename}`);
    generated++;
  }

  console.log(`\n完成：生成 ${generated} 个词法表文件 (lexicons.json v${json.version})`);
}

main();
