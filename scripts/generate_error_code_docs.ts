#!/usr/bin/env node
/**
 * 错误码文档生成脚本
 *
 * 从 shared/error_codes.json 生成 Markdown 格式的错误码文档
 */

import fs from 'node:fs';
import process from 'node:process';

interface ErrorCodeEntry {
  code: string;
  category: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  help: string;
}

type ErrorCodes = Record<string, ErrorCodeEntry>;

function generateDocs(errorCodes: ErrorCodes): string {
  const entries = Object.entries(errorCodes);

  // 按 category 分组
  const byCategory = new Map<string, Array<[string, ErrorCodeEntry]>>();
  for (const entry of entries) {
    const category = entry[1].category;
    if (!byCategory.has(category)) {
      byCategory.set(category, []);
    }
    byCategory.get(category)!.push(entry);
  }

  // 按 category 排序
  const sortedCategories = Array.from(byCategory.keys()).sort();

  let markdown = `# Aster 语言错误码参考

本文档列出了 Aster 语言编译器和类型检查器使用的所有错误码。

**总计**: ${entries.length} 个错误码

## 按类别分类

`;

  for (const category of sortedCategories) {
    const categoryEntries = byCategory.get(category)!;
    // 按 code 排序
    categoryEntries.sort((a, b) => a[1].code.localeCompare(b[1].code));

    const categoryName = getCategoryDisplayName(category);
    markdown += `### ${categoryName} (${category})\n\n`;
    markdown += `共 ${categoryEntries.length} 个错误码\n\n`;
    markdown += `| 错误码 | 严重性 | 消息模板 | 解决方案 |\n`;
    markdown += `|--------|--------|----------|----------|\n`;

    for (const [key, entry] of categoryEntries) {
      const severity = getSeverityIcon(entry.severity);
      // 转义特殊字符：管道符、花括号、尖括号（VitePress会将{var}识别为Vue模板，<T>识别为HTML标签）
      const message = entry.message
        .replace(/\|/g, '\\|')
        .replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const help = entry.help
        .replace(/\|/g, '\\|')
        .replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
      markdown += `| **${entry.code}** \`${key}\` | ${severity} | ${message} | ${help} |\n`;
    }

    markdown += `\n`;
  }

  // 添加附录
  markdown += `## 附录

### 严重性级别

- 🔴 **error**: 阻止编译，必须修复
- 🟡 **warning**: 不阻止编译，但建议修复
- 🔵 **info**: 信息提示，可选择性处理

### 占位符说明

错误消息模板中的 \`{name}\` 形式表示占位符，运行时会被具体值替换。例如：
- \`{expected}\`、\`{actual}\`: 期望类型与实际类型
- \`{func}\`、\`{name}\`: 函数名或变量名
- \`{capability}\`: 能力名称（如 Http、Sql）

### 错误码编号规则

- **E001-E099**: 类型系统错误
- **E100-E199**: 作用域与导入错误
- **E200-E299**: 效果系统错误
- **E300-E399**: 能力系统错误
- **E400-E499**: PII 隐私相关错误
- **E500-E599**: 异步编程错误
- **W0xx**: 警告级别错误码（使用 W 前缀）

---

*本文档由 \`scripts/generate_error_code_docs.ts\` 自动生成*
`;

  return markdown;
}

function getCategoryDisplayName(category: string): string {
  const names: Record<string, string> = {
    type: '类型系统',
    effect: '效果系统',
    capability: '能力系统',
    async: '异步编程',
    scope: '作用域与导入',
    pii: 'PII 隐私保护',
    syntax: '语法',
    semantic: '语义',
  };
  return names[category] || category;
}

function getSeverityIcon(severity: string): string {
  const icons: Record<string, string> = {
    error: '🔴 error',
    warning: '🟡 warning',
    info: '🔵 info',
  };
  return icons[severity] || severity;
}

function main(): void {
  const inputPath = process.argv[2] || 'shared/error_codes.json';
  const outputPath = process.argv[3] || 'docs/error-codes.md';

  console.log(`读取错误码: ${inputPath}`);

  let errorCodes: ErrorCodes;
  try {
    const content = fs.readFileSync(inputPath, 'utf8');
    errorCodes = JSON.parse(content) as ErrorCodes;
  } catch (error) {
    console.error(`错误: 无法读取或解析 ${inputPath}`);
    console.error((error as Error).message);
    process.exit(1);
  }

  console.log(`生成文档: ${outputPath}`);
  const markdown = generateDocs(errorCodes);

  fs.writeFileSync(outputPath, markdown, 'utf8');
  console.log(`✅ 成功生成 ${Object.keys(errorCodes).length} 个错误码的文档`);
}

main();
