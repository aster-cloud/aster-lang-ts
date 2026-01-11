#!/usr/bin/env node
/**
 * 错误码验证脚本
 *
 * 检查 shared/error_codes.json 的规范性：
 * - Code 唯一性
 * - Category 枚举值有效性
 * - Message 格式正确性
 * - Help 文本存在性
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

const VALID_CATEGORIES = new Set([
  'type',
  'effect',
  'capability',
  'async',
  'scope',
  'pii',
  'syntax',
  'semantic',
]);

const VALID_SEVERITIES = new Set(['error', 'warning', 'info']);

function validateErrorCodes(filePath: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 读取文件
  let errorCodes: ErrorCodes;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    errorCodes = JSON.parse(content) as ErrorCodes;
  } catch (error) {
    errors.push(`无法读取或解析 ${filePath}: ${(error as Error).message}`);
    return { valid: false, errors };
  }

  const seenCodes = new Map<string, string>();
  const entries = Object.entries(errorCodes);

  for (const [key, entry] of entries) {
    const prefix = `[${key}]`;

    // 检查必需字段
    if (!entry.code) {
      errors.push(`${prefix} 缺少 code 字段`);
      continue;
    }
    if (!entry.category) {
      errors.push(`${prefix} 缺少 category 字段`);
    }
    if (!entry.severity) {
      errors.push(`${prefix} 缺少 severity 字段`);
    }
    if (!entry.message) {
      errors.push(`${prefix} 缺少 message 字段`);
    }
    if (!entry.help) {
      errors.push(`${prefix} 缺少 help 字段`);
    }

    // 检查 code 唯一性
    if (seenCodes.has(entry.code)) {
      errors.push(
        `${prefix} code "${entry.code}" 重复，已在 "${seenCodes.get(entry.code)}" 中使用`,
      );
    } else {
      seenCodes.set(entry.code, key);
    }

    // 检查 code 格式 (E001-E999 或 W001-W999)
    if (!/^[EW]\d{3,4}$/.test(entry.code)) {
      errors.push(
        `${prefix} code "${entry.code}" 格式无效，应为 E001-E999 或 W001-W999`,
      );
    }

    // 检查 category 有效性
    if (!VALID_CATEGORIES.has(entry.category)) {
      errors.push(
        `${prefix} category "${entry.category}" 无效，有效值: ${Array.from(VALID_CATEGORIES).join(', ')}`,
      );
    }

    // 检查 severity 有效性
    if (!VALID_SEVERITIES.has(entry.severity)) {
      errors.push(
        `${prefix} severity "${entry.severity}" 无效，有效值: ${Array.from(VALID_SEVERITIES).join(', ')}`,
      );
    }

    // 检查 message 包含占位符的语法
    const placeholderMatches = entry.message.match(/\{[^}]+\}/g) || [];
    for (const placeholder of placeholderMatches) {
      const name = placeholder.slice(1, -1);
      // 检查占位符名称是否有效（不包含空格或特殊字符）
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        errors.push(
          `${prefix} message 中的占位符 "${placeholder}" 格式无效，应使用 {variableName} 格式`,
        );
      }
    }

    // 检查 help 文本不为空
    if (entry.help.trim().length === 0) {
      errors.push(`${prefix} help 文本为空`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function main(): void {
  const filePath = process.argv[2] || 'shared/error_codes.json';

  console.log(`验证错误码文件: ${filePath}\n`);

  const result = validateErrorCodes(filePath);

  if (result.valid) {
    console.log('✅ 所有错误码验证通过！');
    console.log(`   共 ${Object.keys(JSON.parse(fs.readFileSync(filePath, 'utf8'))).length} 个错误码`);
    process.exit(0);
  } else {
    console.log('❌ 发现以下问题：\n');
    for (const error of result.errors) {
      console.log(`   ${error}`);
    }
    console.log(`\n共 ${result.errors.length} 个问题`);
    process.exit(1);
  }
}

main();
