/**
 * 跨项目词法同步验证脚本。
 *
 * 读取 aster-lang-core 导出的 lexicons.json（Java 单一真源），
 * 验证 aster-lang-ts 的 SemanticTokenKind 枚举、分类映射、
 * 关键词值、标点配置和规范化配置与 Java 保持同步。
 *
 * 用法：
 *   pnpm run build && node dist/scripts/verify-lexicon-sync.js [path-to-lexicons.json]
 *
 * 默认读取：../aster-lang-core/build/generated/lexicons/lexicons.json
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SemanticTokenKind, SEMANTIC_TOKEN_CATEGORIES } from '../src/config/token-kind.js';
import { EN_US } from '../src/config/lexicons/en-US.js';
import { ZH_CN } from '../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../src/config/lexicons/de-DE.js';
import type { Lexicon } from '../src/config/lexicons/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface JavaLexicon {
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
    customRules?: Array<{ name: string; pattern: string; replacement: string }>;
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
  messages: Record<string, string>;
}

interface LexiconsJson {
  version: string;
  generatedAt: string;
  tokenKinds: string[];
  categories: Record<string, string[]>;
  lexicons: Record<string, JavaLexicon>;
  checksum: string;
}

const TS_LEXICONS: Record<string, Lexicon> = {
  'en-US': EN_US,
  'zh-CN': ZH_CN,
  'de-DE': DE_DE,
};

function main(): void {
  const jsonPath = process.argv[2]
    ?? resolve(__dirname, '../../../aster-lang-core/build/generated/lexicons/lexicons.json');

  let json: LexiconsJson;
  try {
    json = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  } catch {
    console.error(`无法读取 lexicons.json: ${jsonPath}`);
    console.error('请先运行: cd ../aster-lang-core && ./gradlew exportLexicons');
    process.exit(1);
  }

  const javaTokens = new Set(json.tokenKinds);
  const tsTokens = new Set<string>(Object.values(SemanticTokenKind));

  let errors = 0;
  let warnings = 0;

  // ──────────────────────────────────────────────
  // 1. SemanticTokenKind 枚举同步
  // ──────────────────────────────────────────────

  console.log('\n─── 1. SemanticTokenKind 枚举同步 ───');

  const missingInTs = [...javaTokens].filter(t => !tsTokens.has(t));
  if (missingInTs.length > 0) {
    console.error(`[ERROR] Java 有 ${missingInTs.length} 个 token 在 TS 中缺失：`);
    for (const t of missingInTs) console.error(`  - ${t}`);
    errors += missingInTs.length;
  }

  const missingInJava = [...tsTokens].filter(t => !javaTokens.has(t));
  if (missingInJava.length > 0) {
    console.error(`[ERROR] TS 有 ${missingInJava.length} 个 token 在 Java 中缺失：`);
    for (const t of missingInJava) console.error(`  - ${t}`);
    errors += missingInJava.length;
  }

  if (missingInTs.length === 0 && missingInJava.length === 0) {
    console.log(`  [OK] ${tsTokens.size} 个 token 完全同步`);
  }

  // ──────────────────────────────────────────────
  // 2. 分类映射同步
  // ──────────────────────────────────────────────

  console.log('\n─── 2. 分类映射同步 ───');

  const javaCategories = json.categories;
  const tsCategories = SEMANTIC_TOKEN_CATEGORIES;
  let catErrors = 0;

  for (const [catName, javaMembers] of Object.entries(javaCategories)) {
    const tsMembers = tsCategories[catName];
    if (!tsMembers) {
      console.error(`  [ERROR] Java 分类 "${catName}" 在 TS 中缺失`);
      errors++;
      catErrors++;
      continue;
    }

    const javaSet = new Set(javaMembers);
    const tsSet = new Set(tsMembers as string[]);

    const missing = [...javaSet].filter(m => !tsSet.has(m));
    const extra = [...tsSet].filter(m => !javaSet.has(m as string));

    if (missing.length > 0) {
      console.error(`  [ERROR] 分类 "${catName}" TS 缺失: ${missing.join(', ')}`);
      errors += missing.length;
      catErrors++;
    }
    if (extra.length > 0) {
      console.warn(`  [WARN] 分类 "${catName}" TS 多出: ${(extra as string[]).join(', ')}`);
      warnings += extra.length;
    }
  }

  for (const catName of Object.keys(tsCategories)) {
    if (!javaCategories[catName]) {
      console.warn(`  [WARN] TS 分类 "${catName}" 在 Java 中不存在`);
      warnings++;
    }
  }

  if (catErrors === 0) {
    console.log(`  [OK] ${Object.keys(javaCategories).length} 个分类同步`);
  }

  // ──────────────────────────────────────────────
  // 3. 关键词值一致性
  // ──────────────────────────────────────────────

  console.log('\n─── 3. 关键词值一致性 ───');

  for (const [localeId, javaLex] of Object.entries(json.lexicons)) {
    const tsLex = TS_LEXICONS[localeId];
    if (!tsLex) {
      console.warn(`  [WARN] Java lexicon "${localeId}" 在 TS 中无对应实现`);
      warnings++;
      continue;
    }

    let kwErrors = 0;
    for (const [tokenKind, javaValue] of Object.entries(javaLex.keywords)) {
      const tsValue = tsLex.keywords[tokenKind as SemanticTokenKind];
      if (tsValue === undefined) {
        // 已在枚举同步检查中报告
        continue;
      }
      if (tsValue !== javaValue) {
        console.error(`  [ERROR] ${localeId}.${tokenKind}: Java="${javaValue}" TS="${tsValue}"`);
        errors++;
        kwErrors++;
      }
    }

    if (kwErrors === 0) {
      console.log(`  [OK] ${localeId}: ${Object.keys(javaLex.keywords).length} 个关键词值一致`);
    }
  }

  // ──────────────────────────────────────────────
  // 4. 标点配置一致性
  // ──────────────────────────────────────────────

  console.log('\n─── 4. 标点配置一致性 ───');

  for (const [localeId, javaLex] of Object.entries(json.lexicons)) {
    const tsLex = TS_LEXICONS[localeId];
    if (!tsLex) continue;

    let punctErrors = 0;
    const jp = javaLex.punctuation;
    const tp = tsLex.punctuation;

    // 标点字段映射：Java 扁平 → TS 嵌套
    const checks: [string, string, string][] = [
      ['statementEnd', jp.statementEnd, tp.statementEnd],
      ['listSeparator', jp.listSeparator, tp.listSeparator],
      ['enumSeparator', jp.enumSeparator, tp.enumSeparator],
      ['blockStart', jp.blockStart, tp.blockStart],
      ['stringQuotes.open', jp.stringQuoteOpen, tp.stringQuotes.open],
      ['stringQuotes.close', jp.stringQuoteClose, tp.stringQuotes.close],
    ];

    for (const [field, javaVal, tsVal] of checks) {
      if (javaVal !== tsVal) {
        console.error(`  [ERROR] ${localeId}.punctuation.${field}: Java="${javaVal}" TS="${tsVal}"`);
        errors++;
        punctErrors++;
      }
    }

    // markers（可选）
    if (jp.markerOpen || jp.markerClose) {
      if (!tp.markers) {
        console.error(`  [ERROR] ${localeId}: Java 有 markers，TS 缺失`);
        errors++;
        punctErrors++;
      } else {
        if (jp.markerOpen !== tp.markers.open) {
          console.error(`  [ERROR] ${localeId}.punctuation.markers.open: Java="${jp.markerOpen}" TS="${tp.markers.open}"`);
          errors++;
          punctErrors++;
        }
        if (jp.markerClose !== tp.markers.close) {
          console.error(`  [ERROR] ${localeId}.punctuation.markers.close: Java="${jp.markerClose}" TS="${tp.markers.close}"`);
          errors++;
          punctErrors++;
        }
      }
    }

    if (punctErrors === 0) {
      console.log(`  [OK] ${localeId}: 标点配置一致`);
    }
  }

  // ──────────────────────────────────────────────
  // 5. 规范化配置一致性
  // ──────────────────────────────────────────────

  console.log('\n─── 5. 规范化配置一致性 ───');

  for (const [localeId, javaLex] of Object.entries(json.lexicons)) {
    const tsLex = TS_LEXICONS[localeId];
    if (!tsLex) continue;

    let canonErrors = 0;
    const jc = javaLex.canonicalization;
    const tc = tsLex.canonicalization;

    // whitespaceMode
    if (jc.whitespaceMode.toLowerCase() !== tc.whitespaceMode) {
      console.error(`  [ERROR] ${localeId}.whitespaceMode: Java="${jc.whitespaceMode}" TS="${tc.whitespaceMode}"`);
      errors++;
      canonErrors++;
    }

    // fullWidthToHalf
    if (jc.fullWidthToHalf !== tc.fullWidthToHalf) {
      console.error(`  [ERROR] ${localeId}.fullWidthToHalf: Java=${jc.fullWidthToHalf} TS=${tc.fullWidthToHalf}`);
      errors++;
      canonErrors++;
    }

    // removeArticles
    if (jc.removeArticles !== tc.removeArticles) {
      console.error(`  [ERROR] ${localeId}.removeArticles: Java=${jc.removeArticles} TS=${tc.removeArticles}`);
      errors++;
      canonErrors++;
    }

    // allowedDuplicates
    const javaDups = (jc.allowedDuplicates ?? []).map(g => [...g].sort().join(',')).sort();
    const tsDups = (tc.allowedDuplicates ?? []).map(g => [...g].sort().join(',')).sort();
    if (JSON.stringify(javaDups) !== JSON.stringify(tsDups)) {
      console.error(`  [ERROR] ${localeId}.allowedDuplicates 不一致：`);
      console.error(`    Java: ${JSON.stringify(javaDups)}`);
      console.error(`    TS:   ${JSON.stringify(tsDups)}`);
      errors++;
      canonErrors++;
    }

    // compoundPatterns
    const javaPatterns = (jc.compoundPatterns ?? []).map(p =>
      `${p.name}:${p.opener}:[${p.contextualKeywords.join(',')}]:${p.closer}`
    ).sort();
    const tsPatterns = (tc.compoundPatterns ?? []).map(p =>
      `${p.name}:${p.opener}:[${p.contextualKeywords.join(',')}]:${p.closer ?? 'DEDENT'}`
    ).sort();
    if (JSON.stringify(javaPatterns) !== JSON.stringify(tsPatterns)) {
      console.error(`  [ERROR] ${localeId}.compoundPatterns 不一致：`);
      console.error(`    Java: ${JSON.stringify(javaPatterns)}`);
      console.error(`    TS:   ${JSON.stringify(tsPatterns)}`);
      errors++;
      canonErrors++;
    }

    if (canonErrors === 0) {
      console.log(`  [OK] ${localeId}: 规范化配置一致`);
    }
  }

  // ──────────────────────────────────────────────
  // 汇总
  // ──────────────────────────────────────────────

  console.log(`\n═══ 词法同步验证结果 ═══`);
  console.log(`Java token 数: ${javaTokens.size}`);
  console.log(`TS token 数:   ${tsTokens.size}`);
  console.log(`Locale 数:     ${Object.keys(json.lexicons).length}`);
  console.log(`错误: ${errors}, 警告: ${warnings}`);

  if (errors > 0) {
    console.error('\n验证失败！请重新运行 generate:lexicons 以同步词法表。');
    process.exit(1);
  }

  console.log('\n验证通过：Java 和 TS 的词法配置完全同步。');
}

main();
