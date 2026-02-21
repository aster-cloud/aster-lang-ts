/**
 * 领域词汇表代码生成脚本。
 *
 * 读取 aster-lang-core 导出的 vocabularies.json（Java 单一真源），
 * 为每个 domain:locale 组合生成对应的 TypeScript 词汇表文件。
 *
 * 用法：
 *   npx tsx scripts/generate-vocabularies.ts [path-to-vocabularies.json]
 *
 * 默认读取：../aster-lang-core/build/generated/vocabularies/vocabularies.json
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── JSON Schema ────────────────────────────────────────────

interface VocabulariesJson {
  version: string;
  generatedAt: string;
  vocabularies: Record<string, ExportedVocabulary>;
  checksum?: string;
}

interface ExportedVocabulary {
  id: string;
  name: string;
  locale: string;
  version: string;
  metadata?: {
    author?: string;
    createdAt?: string;
    description?: string;
  };
  structs: ExportedMapping[];
  fields: ExportedMapping[];
  functions: ExportedMapping[];
  enumValues: ExportedMapping[];
}

interface ExportedMapping {
  canonical: string;
  localized: string;
  parent?: string;
  description?: string;
  aliases?: string[];
}

// ─── 常量名映射 ─────────────────────────────────────────────

/** "insurance.auto:zh-CN" → "INSURANCE_AUTO_ZH_CN" */
function constName(key: string): string {
  return key
    .replace(/[.:]/g, '_')
    .replace(/-/g, '_')
    .toUpperCase();
}

/** "insurance.auto:zh-CN" → "insurance.auto.zh-CN" */
function fileName(key: string): string {
  return key.replace(':', '.');
}

// ─── 代码生成 ────────────────────────────────────────────────

function generateVocabularyFile(vocab: ExportedVocabulary, key: string): string {
  const lines: string[] = [];
  const name = constName(key);

  lines.push(`// @generated — 由 scripts/generate-vocabularies.ts 自动生成，请勿手动修改`);
  lines.push(``);
  lines.push(`import { type DomainVocabulary, IdentifierKind } from '../types.js';`);
  lines.push(``);
  lines.push(`export const ${name}: DomainVocabulary = {`);
  lines.push(`  id: ${quote(vocab.id)},`);
  lines.push(`  name: ${quote(vocab.name)},`);
  lines.push(`  locale: ${quote(vocab.locale)},`);
  lines.push(`  version: ${quote(vocab.version)},`);

  // metadata（仅当有非空字段时才生成）
  if (vocab.metadata) {
    const metaFields: string[] = [];
    if (vocab.metadata.author) metaFields.push(`    author: ${quote(vocab.metadata.author)},`);
    if (vocab.metadata.createdAt) metaFields.push(`    createdAt: ${quote(vocab.metadata.createdAt)},`);
    if (vocab.metadata.description) metaFields.push(`    description: ${quote(vocab.metadata.description)},`);
    if (metaFields.length > 0) {
      lines.push(``);
      lines.push(`  metadata: {`);
      lines.push(...metaFields);
      lines.push(`  },`);
    }
  }

  // structs
  lines.push(``);
  lines.push(`  structs: [`);
  for (const m of (vocab.structs ?? [])) {
    lines.push(`    {`);
    lines.push(`      canonical: ${quote(m.canonical)},`);
    lines.push(`      localized: ${quote(m.localized)},`);
    lines.push(`      kind: IdentifierKind.STRUCT,`);
    if (m.description) {
      lines.push(`      description: ${quote(m.description)},`);
    }
    if (m.aliases && m.aliases.length > 0) {
      lines.push(`      aliases: [${m.aliases.map(quote).join(', ')}],`);
    }
    lines.push(`    },`);
  }
  lines.push(`  ],`);

  // fields
  lines.push(``);
  lines.push(`  fields: [`);
  for (const m of (vocab.fields ?? [])) {
    lines.push(`    {`);
    lines.push(`      canonical: ${quote(m.canonical)},`);
    lines.push(`      localized: ${quote(m.localized)},`);
    lines.push(`      kind: IdentifierKind.FIELD,`);
    if (m.parent) {
      lines.push(`      parent: ${quote(m.parent)},`);
    }
    if (m.description) {
      lines.push(`      description: ${quote(m.description)},`);
    }
    if (m.aliases && m.aliases.length > 0) {
      lines.push(`      aliases: [${m.aliases.map(quote).join(', ')}],`);
    }
    lines.push(`    },`);
  }
  lines.push(`  ],`);

  // functions
  lines.push(``);
  lines.push(`  functions: [`);
  for (const m of (vocab.functions ?? [])) {
    lines.push(`    {`);
    lines.push(`      canonical: ${quote(m.canonical)},`);
    lines.push(`      localized: ${quote(m.localized)},`);
    lines.push(`      kind: IdentifierKind.FUNCTION,`);
    if (m.description) {
      lines.push(`      description: ${quote(m.description)},`);
    }
    if (m.aliases && m.aliases.length > 0) {
      lines.push(`      aliases: [${m.aliases.map(quote).join(', ')}],`);
    }
    lines.push(`    },`);
  }
  lines.push(`  ],`);

  // enumValues
  lines.push(``);
  lines.push(`  enumValues: [`);
  for (const m of (vocab.enumValues ?? [])) {
    lines.push(`    {`);
    lines.push(`      canonical: ${quote(m.canonical)},`);
    lines.push(`      localized: ${quote(m.localized)},`);
    lines.push(`      kind: IdentifierKind.ENUM_VALUE,`);
    if (m.description) {
      lines.push(`      description: ${quote(m.description)},`);
    }
    if (m.aliases && m.aliases.length > 0) {
      lines.push(`      aliases: [${m.aliases.map(quote).join(', ')}],`);
    }
    lines.push(`    },`);
  }
  lines.push(`  ],`);

  lines.push(`};`);
  lines.push(``);

  return lines.join('\n');
}

function generateIndexFile(keys: string[]): string {
  const lines: string[] = [];

  lines.push(`// @generated — 由 scripts/generate-vocabularies.ts 自动生成，请勿手动修改`);
  lines.push(``);

  for (const key of keys) {
    const name = constName(key);
    const file = fileName(key);
    lines.push(`export { ${name} } from './${file}.js';`);
  }
  lines.push(``);

  return lines.join('\n');
}

/** 安全引号：使用单引号，转义特殊字符（含 U+2028/U+2029） */
function quote(s: string): string {
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `'${escaped}'`;
}

// ─── 主流程 ──────────────────────────────────────────────────

function main() {
  const jsonPath = process.argv[2]
    ?? resolve(__dirname, '../../aster-lang-core/build/generated/vocabularies/vocabularies.json');

  let json: VocabulariesJson;
  try {
    json = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  } catch {
    console.error(`无法读取 vocabularies.json: ${jsonPath}`);
    console.error('请先运行: cd ../aster-lang-core && ./gradlew exportVocabularies');
    process.exit(1);
  }

  // 校验 checksum
  if (json.checksum) {
    const vocabsJson = JSON.stringify(json.vocabularies);
    const actualChecksum = createHash('sha256').update(vocabsJson, 'utf-8').digest('hex');
    if (actualChecksum !== json.checksum) {
      console.error(`checksum 校验失败：期望 ${json.checksum}，实际 ${actualChecksum}`);
      console.error('vocabularies.json 可能已损坏，请重新运行 exportVocabularies');
      process.exit(1);
    }
    console.log(`checksum 校验通过: ${json.checksum.substring(0, 16)}...`);
  } else {
    console.warn('警告: vocabularies.json 缺少 checksum 字段，跳过完整性校验');
  }

  const outputDir = resolve(__dirname, '../src/config/lexicons/identifiers/domains');
  mkdirSync(outputDir, { recursive: true });

  const sortedKeys = Object.keys(json.vocabularies).sort();
  let generated = 0;

  for (const key of sortedKeys) {
    const vocab = json.vocabularies[key]!;
    const file = `${fileName(key)}.ts`;
    const content = generateVocabularyFile(vocab, key);
    const outputPath = resolve(outputDir, file);
    writeFileSync(outputPath, content, 'utf-8');
    console.log(`生成: ${file}`);
    generated++;
  }

  // 生成 index.ts
  const indexContent = generateIndexFile(sortedKeys);
  writeFileSync(resolve(outputDir, 'index.ts'), indexContent, 'utf-8');
  console.log(`生成: index.ts`);

  console.log(`\n完成：生成 ${generated} 个领域词汇表文件 + index.ts (vocabularies.json v${json.version})`);
}

main();
