#!/usr/bin/env ts-node
/**
 * 根据 shared/error_codes.json 生成 Java 与 TypeScript 端的错误码常量。
 * 自动化生成确保双端共享一致的编号、消息模板与分类信息。
 */
import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';

interface ErrorSpec {
  code: string;
  category: ErrorCategoryLiteral;
  severity: ErrorSeverityLiteral;
  message: string;
  help: string;
}

type ErrorCategoryLiteral = 'type' | 'scope' | 'effect' | 'capability' | 'pii' | 'async' | 'other';
type ErrorSeverityLiteral = 'error' | 'warning' | 'info';

interface ErrorTable {
  readonly [key: string]: ErrorSpec;
}

const PROJECT_ROOT = resolve(new URL('.', import.meta.url).pathname, '..');
const ERROR_TABLE_PATH = resolve(PROJECT_ROOT, 'shared', 'error_codes.json');
const TS_OUTPUT = resolve(PROJECT_ROOT, 'src', 'error_codes.ts');
const JAVA_OUTPUT = resolve(
  PROJECT_ROOT,
  'aster-core',
  'src',
  'main',
  'java',
  'aster',
  'core',
  'typecheck',
  'ErrorCode.java'
);

async function main(): Promise<void> {
  const raw = await fs.readFile(ERROR_TABLE_PATH, 'utf8');
  const table = JSON.parse(raw) as ErrorTable;

  const entries = Object.entries(table).map(([name, spec]) => ({
    name,
    ...spec,
  }));

  entries.sort((a, b) => a.code.localeCompare(b.code));

  await Promise.all([
    ensureDirectory(dirname(TS_OUTPUT)),
    ensureDirectory(dirname(JAVA_OUTPUT)),
  ]);

  await Promise.all([
    fs.writeFile(TS_OUTPUT, renderTypeScript(entries), 'utf8'),
    fs.writeFile(JAVA_OUTPUT, renderJava(entries), 'utf8'),
  ]);

  console.log('生成错误码文件完成:');
  console.log(`  - ${TS_OUTPUT}`);
  console.log(`  - ${JAVA_OUTPUT}`);
}

async function ensureDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function renderTypeScript(entries: Array<{ name: string } & ErrorSpec>): string {
  const categories = new Set(entries.map(e => e.category));
  const severities = new Set(entries.map(e => e.severity));

  const header =
    `// 本文件由 scripts/generate_error_codes.ts 自动生成，请勿手动修改。\n` +
    `// 源数据: shared/error_codes.json\n\n`;

  const categoryUnion = [...categories].map(c => `'${c}'`).join(' | ');
  const severityUnion = [...severities].map(s => `'${s}'`).join(' | ');

  const enumLines = entries.map(
    e => `  ${e.name} = "${e.code}",`
  );

  const messageLines = entries.map(
    e => `  [ErrorCode.${e.name}]: "${escapeForDoubleQuotes(e.message)}",`
  );

  const metadataLines = entries.map(e => {
    const help = escapeForDoubleQuotes(e.help);
    const message = escapeForDoubleQuotes(e.message);
    return [
      `  [ErrorCode.${e.name}]: {`,
      `    code: ErrorCode.${e.name},`,
      `    category: '${e.category}',`,
      `    severity: '${e.severity}',`,
      `    message: "${message}",`,
      `    help: "${help}",`,
      '  },',
    ].join('\n');
  });

  return [
    header,
    `export type ErrorCategory = ${categoryUnion};`,
    `export type ErrorSeverity = ${severityUnion};`,
    '',
    'export const enum ErrorCode {',
    ...enumLines,
    '}',
    '',
    'export interface ErrorMetadata {',
    '  readonly code: ErrorCode;',
    '  readonly category: ErrorCategory;',
    '  readonly severity: ErrorSeverity;',
    '  readonly message: string;',
    '  readonly help: string;',
    '}',
    '',
    'export const ERROR_MESSAGES: Record<ErrorCode, string> = {',
    ...messageLines,
    '};',
    '',
    'export const ERROR_METADATA: Record<ErrorCode, ErrorMetadata> = {',
    ...metadataLines,
    '};',
    '',
    '/**',
    ' * 使用命名参数填充错误消息模板。',
    ' */',
    'export function formatErrorMessage(code: ErrorCode, params: Record<string, string | number>): string {',
    '  const template = ERROR_MESSAGES[code] ?? "";',
    '  return template.replace(/\\{(\\w+)\\}/g, (_, key) => {',
    '    const value = params[key];',
    '    return value === undefined ? `{${key}}` : String(value);',
    '  });',
    '}',
    '',
    '/**',
    ' * 获取详细元数据，包含分类与帮助信息。',
    ' */',
    'export function getErrorMetadata(code: ErrorCode): ErrorMetadata {',
    '  return ERROR_METADATA[code];',
    '}',
    '',
  ].join('\n');
}

function renderJava(entries: Array<{ name: string } & ErrorSpec>): string {
  const header =
    `// 本文件由 scripts/generate_error_codes.ts 自动生成，请勿手动修改。\n` +
    `// 源数据: shared/error_codes.json\n`;

  const enumLines = entries.map(e => {
    const javaMessage = toJavaTemplate(e.message);
    const help = escapeForDoubleQuotes(e.help);
    const category = toJavaCategory(e.category);
    const severity = toJavaSeverity(e.severity);
    return `  ${e.name}("${e.code}", Category.${category}, Severity.${severity}, "${javaMessage}", "${help}"),`;
  });

  return [
    `${header}`,
    'package aster.core.typecheck;',
    '',
    'import java.util.Locale;',
    '',
    '/**',
    ' * 错误码与消息模板的枚举定义，由共享 JSON 自动生成，确保 Java 与 TypeScript 行为一致。',
    ' */',
    'public enum ErrorCode {',
    ...enumLines,
    '  ;',
    '',
    '  private final String code;',
    '  private final Category category;',
    '  private final Severity severity;',
    '  private final String messageTemplate;',
    '  private final String help;',
    '',
    '  ErrorCode(String code, Category category, Severity severity, String messageTemplate, String help) {',
    '    this.code = code;',
    '    this.category = category;',
    '    this.severity = severity;',
    '    this.messageTemplate = messageTemplate;',
    '    this.help = help;',
    '  }',
    '',
    '  public String code() {',
    '    return code;',
    '  }',
    '',
    '  public Category category() {',
    '    return category;',
    '  }',
    '',
    '  public Severity severity() {',
    '    return severity;',
    '  }',
    '',
    '  public String messageTemplate() {',
    '    return messageTemplate;',
    '  }',
    '',
    '  public String help() {',
    '    return help;',
    '  }',
    '',
    '  /**',
    '   * 使用占位符顺序填充消息模板，调用方需确保参数顺序正确。',
    '   */',
    '  public String format(Object... args) {',
    '    return String.format(Locale.ROOT, messageTemplate, args);',
    '  }',
    '',
    '  public enum Category {',
    '    TYPE,',
    '    SCOPE,',
    '    EFFECT,',
    '    CAPABILITY,',
    '    PII,',
    '    ASYNC,',
    '    OTHER',
    '  }',
    '',
    '  public enum Severity {',
    '    ERROR,',
    '    WARNING,',
    '    INFO',
    '  }',
    '}',
    '',
  ].join('\n');
}

function escapeForDoubleQuotes(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function toJavaTemplate(message: string): string {
  const escaped = escapeForDoubleQuotes(message);
  return escaped.replace(/\{[^}]+\}/g, "%s");
}

function toJavaCategory(category: ErrorCategoryLiteral): string {
  switch (category) {
    case 'type':
      return 'TYPE';
    case 'scope':
      return 'SCOPE';
    case 'effect':
      return 'EFFECT';
    case 'capability':
      return 'CAPABILITY';
    case 'pii':
      return 'PII';
    case 'async':
      return 'ASYNC';
    default:
      return 'OTHER';
  }
}

function toJavaSeverity(severity: ErrorSeverityLiteral): string {
  switch (severity) {
    case 'error':
      return 'ERROR';
    case 'warning':
      return 'WARNING';
    default:
      return 'INFO';
  }
}

void main().catch(err => {
  console.error('生成错误码文件失败:', err);
  process.exitCode = 1;
});
