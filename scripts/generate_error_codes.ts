#!/usr/bin/env ts-node
/**
 * 根据 shared/error_codes.json 生成 Java 与 TypeScript 端的错误码常量脚手架。
 *
 * 单一真源约定：`shared/error_codes.json` 是错误码「码表数据」（code / category /
 * severity / message / help）的唯一真源。双引擎码表一致性由 parity 测试强制
 * （见 test 中的 error-codes-parity 与 Java 侧 ErrorCodeParityTest），而非依赖
 * 盲目重新生成——因为两端生成文件在码表之外还含有手工维护的功能增强
 * （例如 error_codes.ts 的本地化 formatErrorMessage 第三参数），直接覆盖会造成功能回退。
 *
 * 因此本脚本的定位是「参考/脚手架生成器」：可用于新增码时对照产出模板片段，
 * 但增删码表后应以 parity 测试为准绳，人工把改动同步进两端生成文件并保留其功能层。
 *
 * 跨仓布局：aster-lang-ts 与 aster-lang-core 为并列 checkout 的独立仓
 * （历史 monorepo 已归档），Java 输出走 sibling 相对路径 `../aster-lang-core/...`。
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
// 生成物实际位于 src/diagnostics/（历史 monorepo 拆分后文件迁移，旧路径 src/ 已失效）。
const TS_OUTPUT = resolve(PROJECT_ROOT, 'src', 'diagnostics', 'error_codes.ts');
// aster-lang-core 是并列独立仓，走 sibling 相对路径（依赖两仓于同一父目录并列 checkout）。
const JAVA_OUTPUT = resolve(
  PROJECT_ROOT,
  '..',
  'aster-lang-core',
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

  // 默认 --check（安全）：只对照码表数据，不覆盖手改文件（生成物含手工功能增强，
  // 如本地化 formatErrorMessage，盲目覆盖会造成功能回退）。仅当显式传 --write 才覆盖。
  const write = process.argv.includes('--write');
  if (!write) {
    const drift = await checkDrift(entries);
    if (drift.length > 0) {
      console.error('错误码码表 drift（json 与生成文件不一致）：');
      for (const d of drift) console.error(`  - ${d}`);
      console.error('\n以 shared/error_codes.json 为真源，手工同步生成文件的码表数据后重跑；');
      console.error('确需由 json 覆盖重生成（会丢失手工功能增强）时显式传 --write。');
      process.exitCode = 1;
      return;
    }
    console.log('错误码码表一致：shared/error_codes.json ↔ 生成文件（--check 模式）。');
    return;
  }

  await Promise.all([
    ensureDirectory(dirname(TS_OUTPUT)),
    ensureDirectory(dirname(JAVA_OUTPUT)),
  ]);

  await Promise.all([
    fs.writeFile(TS_OUTPUT, renderTypeScript(entries), 'utf8'),
    fs.writeFile(JAVA_OUTPUT, renderJava(entries), 'utf8'),
  ]);

  console.log('生成错误码文件完成（--write 覆盖模式，请复核手工功能增强是否被抹除）:');
  console.log(`  - ${TS_OUTPUT}`);
  console.log(`  - ${JAVA_OUTPUT}`);
}

async function ensureDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * --check：对照 json 码表数据与生成文件的 name→code 映射，返回不一致清单。
 * 只校验「码表结构」（name/code），不比对 message/help 或功能层实现——那些由
 * parity 测试逐字段守门，且生成文件在数据之外含手工功能增强。
 */
async function checkDrift(
  entries: Array<{ name: string } & ErrorSpec>,
): Promise<string[]> {
  const expected = new Map(entries.map(e => [e.name, e.code]));
  const problems: string[] = [];

  const readPairs = (src: string, re: RegExp): Map<string, string> => {
    const m = new Map<string, string>();
    for (const g of src.matchAll(re)) m.set(g[1]!, g[2]!);
    return m;
  };

  // ts enum：NAME = "CODE",
  try {
    const tsSrc = await fs.readFile(TS_OUTPUT, 'utf8');
    const tsPairs = readPairs(tsSrc, /^\s{2}([A-Z_]+)\s*=\s*"([EW0-9]+)",/gm);
    diffPairs('ts', expected, tsPairs, problems);
  } catch {
    problems.push(`ts 生成文件不可读: ${TS_OUTPUT}`);
  }

  // Java enum：NAME("CODE", ...
  try {
    const javaSrc = await fs.readFile(JAVA_OUTPUT, 'utf8');
    const javaPairs = readPairs(javaSrc, /^\s{2}([A-Z_]+)\("([EW0-9]+)"/gm);
    diffPairs('java', expected, javaPairs, problems);
  } catch {
    problems.push(`Java 生成文件不可读: ${JAVA_OUTPUT}`);
  }

  return problems;
}

function diffPairs(
  label: string,
  expected: Map<string, string>,
  actual: Map<string, string>,
  problems: string[],
): void {
  for (const [name, code] of expected) {
    if (!actual.has(name)) {
      problems.push(`${label}: 缺少 ${name} (${code})`);
    } else if (actual.get(name) !== code) {
      problems.push(`${label}: ${name} code 不一致 json=${code} ${label}=${actual.get(name)}`);
    }
  }
  for (const name of actual.keys()) {
    if (!expected.has(name)) {
      problems.push(`${label}: 多出 ${name}（json 中无此码，请同步 json）`);
    }
  }
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
    '  /** 命名占位符 `{name}` —— 与 shared/error_codes.json 逐字一致。 */',
    '  private static final java.util.regex.Pattern PLACEHOLDER =',
    '      java.util.regex.Pattern.compile("\\\\{(\\\\w+)}");',
    '',
    '  /**',
    '   * 用**命名参数**渲染消息模板。',
    '   *',
    '   * <p>★这是全仓唯一的消息渲染实现（aster-lang-core#137）。此前存在两条互相矛盾的',
    '   * 路径：DiagnosticBuilder 走命名参数 `{name}`，而本类的 format(Object...) 走',
    '   * String.format 的 `%s`；生成器又把 json 的 `{name}` 一律改写成 `%s`，',
    '   * 于是走 DiagnosticBuilder 的 23 个码全部渲染出**字面的 `%s`**',
    '   * （实测 E101「Undefined variable: %s」连是哪个变量都不告诉用户）。',
    '   *',
    '   * <p>现在模板与 json 逐字一致，两个消费者共用本方法。',
    '   * 缺失的 key 保留原占位符（便于发现漏传，而不是渲染成 null）。',
    '   */',
    '  public String render(java.util.Map<String, Object> params) {',
    '    java.util.Map<String, Object> p = params == null ? java.util.Map.of() : params;',
    '    var matcher = PLACEHOLDER.matcher(messageTemplate);',
    '    var out = new StringBuilder();',
    '    while (matcher.find()) {',
    '      Object value = p.get(matcher.group(1));',
    '      String replacement;',
    '      if (value == null) {',
    '        replacement = "{" + matcher.group(1) + "}";',
    '      } else if (value instanceof java.util.List<?> list) {',
    '        replacement = String.join(", ", list.stream().map(String::valueOf).toList());',
    '      } else if (value instanceof Object[] array) {',
    '        replacement = String.join(", ", java.util.Arrays.stream(array).map(String::valueOf).toList());',
    '      } else {',
    '        replacement = String.valueOf(value);',
    '      }',
    '      matcher.appendReplacement(out, java.util.regex.Matcher.quoteReplacement(replacement));',
    '    }',
    '    matcher.appendTail(out);',
    '    return out.toString();',
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

/**
 * Java 侧消息模板 —— 与 json **逐字一致**，保留 `{name}` 命名占位符。
 *
 * ★此前这里把 `{...}` 全替换成 `%s`（aster-lang-core#137）。但 Java 侧的主渲染路径
 * `DiagnosticBuilder.formatMessage` 用的是命名参数正则 `\{(\w+)}`——它对 `%s`
 * 不做任何处理，于是参数被放进 `Diagnostic.data` 却从不进入 message，
 * 用户看到的是**字面的 `%s`**：
 *
 *     MSG[E003] = "Return type mismatch: expected %s, got %s"
 *     MSG[E101] = "Undefined variable: %s"        ← 连是哪个变量都不告诉用户
 *
 * 实测受影响 23 个已 emit 的码。保留 `{name}` 后两端与 json 逐字对齐，
 * ErrorCodeParityTest 的 message 比对也随之可以放开。
 */
function toJavaTemplate(message: string): string {
  return escapeForDoubleQuotes(message);
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
