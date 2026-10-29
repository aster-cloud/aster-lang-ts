/**
 * 诊断译文表生成脚本。
 *
 * 读取 aster-lang-core 导出的 lexicons.json，取出各语言包的 diagnosticMessages /
 * diagnosticHelp overlay，生成 src/config/lexicons/diagnostic-overlays.generated.ts。
 * 译文的唯一来源是语言包（aster-lang-locales 的 zh/de、aster-lang-hi 的 hi）的
 * overlays/diagnostic-*.json；本仓不手写任何语言的诊断译文。
 *
 * 用法（语言包发版后、core 导出最新 lexicons.json 后运行）：
 *   npx tsx scripts/generate-diagnostic-overlays.ts [path-to-lexicons.json]
 *
 * 默认读取：../aster-lang-core/build/generated/lexicons/lexicons.json
 * 生成物提交入库；verify-lexicon-sync 会比对生成物与 lexicons.json，发现漂移即失败。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 生成物相对仓库根的路径。 */
export const DIAGNOSTIC_OVERLAYS_OUTPUT = 'src/config/lexicons/diagnostic-overlays.generated.ts';

/** 只读取 lexicons.json 中与诊断译文相关的字段。 */
interface LexiconsJsonView {
  readonly lexicons: Readonly<Record<string, { readonly overlays?: Readonly<Record<string, unknown>> }>>;
}

/** overlay 键 → 其中承载译文的字段名。 */
const DIAGNOSTIC_KEYS = { diagnosticMessages: 'messages', diagnosticHelp: 'help' } as const;

type DiagnosticKey = keyof typeof DIAGNOSTIC_KEYS;

/** 校验并规范化一份诊断 overlay：译文必须是 错误码 → 非空字符串 的对象。 */
function readOverlay(id: string, key: DiagnosticKey, raw: unknown): { version: number } & Record<string, unknown> {
  const field = DIAGNOSTIC_KEYS[key];
  const overlay = raw as { version?: unknown } & Record<string, unknown>;
  const texts = overlay?.[field];
  if (texts === null || typeof texts !== 'object' || Array.isArray(texts)) {
    throw new Error(`${id} 的 ${key}.${field} 缺失或不是对象`);
  }
  for (const [code, text] of Object.entries(texts)) {
    if (typeof text !== 'string' || text.trim() === '') {
      throw new Error(`${id} 的 ${key}.${field}.${code} 不是非空字符串`);
    }
  }
  return { version: typeof overlay.version === 'number' ? overlay.version : 1, [field]: texts };
}

/**
 * 由 lexicons.json 渲染生成物内容。按语言 id 排序，只收带诊断 overlay 的语言，
 * 错误码保持 overlay 文件中的顺序；同一输入的输出逐字节相同。
 */
export function renderDiagnosticOverlays(json: LexiconsJsonView): string {
  const entries: string[] = [];
  for (const id of Object.keys(json.lexicons).sort()) {
    const overlays = json.lexicons[id]?.overlays ?? {};
    const picked: Record<string, unknown> = {};
    for (const key of Object.keys(DIAGNOSTIC_KEYS) as DiagnosticKey[]) {
      if (overlays[key] !== undefined) picked[key] = readOverlay(id, key, overlays[key]);
    }
    if (Object.keys(picked).length === 0) continue;
    const body = JSON.stringify(picked, null, 2).replace(/\n/g, '\n  ');
    entries.push(`  '${id}': ${body},`);
  }
  return `/**
 * 本文件由 scripts/generate-diagnostic-overlays.ts 生成，请勿手工修改。
 * 数据来源：aster-lang-core exportLexicons 导出的 lexicons.json 中各语言包的
 * diagnosticMessages / diagnosticHelp overlay（译文唯一来源为 aster-lang-locales 与 aster-lang-hi）。
 */

import type { OverlayData } from './overlay-loader.js';

/** 语言 id → 诊断译文 overlay（与语言包 overlays/diagnostic-*.json 原样一致）。 */
export const DIAGNOSTIC_OVERLAYS: Readonly<Record<string, Pick<OverlayData, 'diagnosticMessages' | 'diagnosticHelp'>>> = {
${entries.join('\n')}
};
`;
}

function main(): void {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const jsonPath = args[0] ?? resolve(__dirname, '../../aster-lang-core/build/generated/lexicons/lexicons.json');
  let json: LexiconsJsonView;
  try {
    json = JSON.parse(readFileSync(jsonPath, 'utf-8')) as LexiconsJsonView;
  } catch {
    console.error(`无法读取 lexicons.json: ${jsonPath}`);
    console.error('请先运行: cd ../aster-lang-core && ./gradlew exportLexicons');
    process.exit(1);
  }
  const output = resolve(__dirname, '..', DIAGNOSTIC_OVERLAYS_OUTPUT);
  writeFileSync(output, renderDiagnosticOverlays(json), 'utf-8');
  console.log(`已生成 ${DIAGNOSTIC_OVERLAYS_OUTPUT}`);
}

// 仅在直接运行时写文件；被测试或校验脚本导入时只提供渲染函数。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
