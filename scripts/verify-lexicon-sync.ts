/**
 * 跨项目词法同步验证脚本。
 *
 * 读取 aster-lang-core 导出的 lexicons.json（Java 单一真源），
 * 验证 aster-lang-ts 的 SemanticTokenKind 枚举和分类映射与 Java 保持同步。
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

const __dirname = dirname(fileURLToPath(import.meta.url));

interface LexiconsJson {
  version: string;
  generatedAt: string;
  tokenKinds: string[];
  categories: Record<string, string[]>;
  lexicons: Record<string, {
    id: string;
    name: string;
    keywords: Record<string, string>;
  }>;
  checksum: string;
}

function main() {
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

  // 1. 检查 Java 有但 TS 缺失的 token
  const missingInTs = [...javaTokens].filter(t => !tsTokens.has(t));
  if (missingInTs.length > 0) {
    console.error(`\n[ERROR] Java 中有 ${missingInTs.length} 个 token 在 TS 中缺失：`);
    for (const t of missingInTs) {
      console.error(`  - ${t}`);
    }
    errors += missingInTs.length;
  }

  // 2. 检查 TS 有但 Java 缺失的 token
  const missingInJava = [...tsTokens].filter(t => !javaTokens.has(t));
  if (missingInJava.length > 0) {
    console.error(`\n[ERROR] TS 中有 ${missingInJava.length} 个 token 在 Java 中缺失：`);
    for (const t of missingInJava) {
      console.error(`  - ${t}`);
    }
    errors += missingInJava.length;
  }

  // 3. 验证分类映射
  const javaCategories = json.categories;
  const tsCategories = SEMANTIC_TOKEN_CATEGORIES;

  for (const [catName, javaMembers] of Object.entries(javaCategories)) {
    const tsMembers = tsCategories[catName];
    if (!tsMembers) {
      console.error(`\n[ERROR] Java 分类 "${catName}" 在 TS SEMANTIC_TOKEN_CATEGORIES 中缺失`);
      errors++;
      continue;
    }

    const javaSet = new Set(javaMembers);
    const tsSet = new Set(tsMembers as string[]);

    const missingMembers = [...javaSet].filter(m => !tsSet.has(m));
    const extraMembers = [...tsSet].filter(m => !javaSet.has(m as string));

    if (missingMembers.length > 0) {
      console.error(`\n[ERROR] 分类 "${catName}" 中 TS 缺失: ${missingMembers.join(', ')}`);
      errors += missingMembers.length;
    }
    if (extraMembers.length > 0) {
      console.warn(`\n[WARN] 分类 "${catName}" 中 TS 多出: ${(extraMembers as string[]).join(', ')}`);
      warnings += extraMembers.length;
    }
  }

  // 检查 TS 有但 Java 没有的分类
  for (const catName of Object.keys(tsCategories)) {
    if (!javaCategories[catName]) {
      console.warn(`\n[WARN] TS 分类 "${catName}" 在 Java 中不存在`);
      warnings++;
    }
  }

  // 4. 验证每个 lexicon 的关键词完整性
  for (const [localeId, lexicon] of Object.entries(json.lexicons)) {
    const javaKeywords = Object.keys(lexicon.keywords);
    const missingKw = javaKeywords.filter(k => !tsTokens.has(k));
    if (missingKw.length > 0) {
      console.error(`\n[ERROR] Java lexicon "${localeId}" 有 ${missingKw.length} 个关键词的 token 在 TS enum 中缺失：`);
      for (const k of missingKw) {
        console.error(`  - ${k}: "${lexicon.keywords[k]}"`);
      }
      errors += missingKw.length;
    }
  }

  // 汇总
  console.log(`\n=== 词法同步验证结果 ===`);
  console.log(`Java token 数: ${javaTokens.size}`);
  console.log(`TS token 数:   ${tsTokens.size}`);
  console.log(`错误: ${errors}, 警告: ${warnings}`);

  if (errors > 0) {
    console.error('\n验证失败！请同步 SemanticTokenKind 枚举。');
    process.exit(1);
  }

  console.log('\n验证通过：Java 和 TS 的 SemanticTokenKind 保持同步。');
}

main();
