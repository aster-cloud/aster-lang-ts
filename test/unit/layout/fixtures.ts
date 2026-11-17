/**
 * layout 测试共用夹具：《静夜思》《斑点带子案》的 LayoutMap 直接取自 examples（单一来源），
 * 方言词法表与示例脚本一致。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { SemanticTokenKind as K } from '../../../src/config/token-kind.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import type { PolicyLayout } from '../../../src/layout/index.js';

/** dist/test/unit/layout → 仓库根 */
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

async function loadLayout(rel: string, name: string): Promise<PolicyLayout> {
  const mod = (await import(pathToFileURL(join(repoRoot, rel)).href)) as Record<string, PolicyLayout>;
  const layout = mod[name];
  if (!layout) throw new Error(`${rel} 未导出 ${name}`);
  return layout;
}

export const JINGYESI_LAYOUT = await loadLayout('examples/jingyesi/jingyesi.layout.mjs', 'JINGYESI_LAYOUT');
export const SHERLOCK_LAYOUT = await loadLayout('examples/sherlock/sherlock.layout.mjs', 'SHERLOCK_LAYOUT');

/** .aster 文件内容（去掉尾随换行，与 layout 的 canonical 对齐） */
export function asterSource(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8').replace(/\n+$/, '');
}

export const JINGYESI_ALIASES: Record<string, string[]> = {
  [K.MODULE_DECL]: ['床前'],
  [K.FUNC_TO]: ['疑是'],
  [K.FUNC_PRODUCE]: ['举头'],
  [K.RETURN]: ['低头'],
};

export const SHERLOCK_ALIASES: Record<string, string[]> = {
  [K.MODULE_DECL]: ['探案笔记'],
  [K.FUNC_TO]: ['推断'],
  [K.FUNC_GIVEN]: ['已知'],
  [K.IF]: ['若'],
  [K.RETURN]: ['凶手即'],
  [K.AND]: ['且'],
};

export const JINGYESI_LEX: Lexicon = { ...ZH_CN, id: 'jingyesi', name: '静夜思', aliases: JINGYESI_ALIASES };
export const SHERLOCK_LEX: Lexicon = { ...ZH_CN, id: 'sherlock', name: '福尔摩斯', aliases: SHERLOCK_ALIASES };
