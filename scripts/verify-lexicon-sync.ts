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
import { HI_IN } from '../src/config/lexicons/hi-IN.js';
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
  'hi-IN': HI_IN,
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
  // 3b. first-party lexicon 完整性（Java exportLexicons 的每个 first-party 包必须
  //     覆盖全部非可选 tokenKind）
  //
  // 检查对象是 `json.lexicons[localeId]`（Java exportLexicons 产出的 first-party 包），
  // 非 TS `TS_LEXICONS` 本体（TS 侧枚举缺失由第 1 段 SemanticTokenKind 同步检查覆盖）。
  //
  // 背景：LexiconRegistry.OPTIONAL_KINDS 在 runtime 缺失只告警不跳过包。这会让
  // "某语言包漏了新 keyword"静默通过——本检查确保每个 first-party 语言包对
  // **非可选** tokenKind 全覆盖。
  //
  // ★两个 OPTIONAL_KINDS 语义**故意解耦**（不再要求逐字对齐）：
  //   - runtime `LexiconRegistry.OPTIONAL_KINDS`：对**所有**加载的 SPI 包（含旧
  //     published 包、第三方包）宽容——缺可选 token 只 warn 不塌。APPLY 仍在其中，
  //     以兼容尚未发布含 APPLY 的旧 published 语言包（免发版迁移），待下次自然发版
  //     发含 APPLY 的新版后再从 runtime 收紧。
  //   - CI 本检查的 `CI_OPTIONAL_KINDS`：只作用于 **first-party 语言包**（en/zh/de/hi，
  //     它们都随此仓/生态一起演进）。APPLY 已是稳定特性（ADR 0027，双引擎+四语全就绪），
  //     故此处**移除 APPLY**，把它转正为 first-party 必需 token：未来任何 first-party
  //     包漏 APPLY → 硬 ERROR（而非旧版只 warn 的静默通过）。
  // ──────────────────────────────────────────────

  console.log('\n─── 3b. first-party lexicon 完整性 ───');

  // CI first-party 可选 token（与 runtime LexiconRegistry.OPTIONAL_KINDS 故意解耦，
  // 见上方注释）。APPLY 已从此集移除 → first-party 包必须包含 APPLY。
  const CI_OPTIONAL_KINDS = new Set<string>(['IMPORT_VERSION', 'THEN']);
  const requiredKinds = [...javaTokens].filter(t => !CI_OPTIONAL_KINDS.has(t));

  for (const localeId of Object.keys(TS_LEXICONS)) {
    const javaLex = json.lexicons[localeId];
    if (!javaLex) {
      console.error(`  [ERROR] first-party lexicon "${localeId}" 未出现在 Java exportLexicons 输出`);
      errors++;
      continue;
    }
    const missing = requiredKinds.filter(k => !(k in javaLex.keywords));
    if (missing.length > 0) {
      console.error(`  [ERROR] ${localeId} 缺少必需 tokenKind: ${missing.join(', ')}`);
      errors += missing.length;
    } else {
      const optionalMissing = [...CI_OPTIONAL_KINDS].filter(k => javaTokens.has(k) && !(k in javaLex.keywords));
      if (optionalMissing.length > 0) {
        console.warn(`  [WARN] ${localeId} 缺可选 tokenKind（迁移期允许）: ${optionalMissing.join(', ')}`);
        warnings += optionalMissing.length;
      } else {
        console.log(`  [OK] ${localeId}: 覆盖全部 ${requiredKinds.length} 必需 + 可选 tokenKind`);
      }
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
