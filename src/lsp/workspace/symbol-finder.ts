/**
 * LSP Workspace 符号查找器
 * 在工作区中查找符号的所有引用
 */

import { promises as fs } from 'node:fs';
import type { Location } from 'vscode-languageserver-types';
import { getAllModules } from './index-manager.js';

type NavigationHelpers = Pick<typeof import('../navigation/shared.js'), 'exactIdentifierPositions' | 'lexInSourceCoordinates' | 'offsetToPos' | 'ensureUri' | 'uriToFsPath'>;
let navigationHelpersPromise: Promise<NavigationHelpers> | null = null;

/**
 * 延迟加载导航模块中的公共工具函数，避免循环依赖导致的初始化问题。
 */
async function loadNavigationHelpers(): Promise<NavigationHelpers> {
  if (!navigationHelpersPromise) {
    navigationHelpersPromise = import('../navigation/shared.js').then(mod => ({
      exactIdentifierPositions: mod.exactIdentifierPositions,
      lexInSourceCoordinates: mod.lexInSourceCoordinates,
      offsetToPos: mod.offsetToPos,
      ensureUri: mod.ensureUri,
      uriToFsPath: mod.uriToFsPath,
    }));
  }
  return navigationHelpersPromise;
}

/**
 * 根据符号名称查找其在工作区内的所有引用位置（包括定义和使用点）。
 * @param symbol 需要查找的符号名称。
 * @param excludeUri 可选的排除 URI，用于忽略当前文档。
 * @returns 匹配到的引用列表。
 */
/** 查找选项：打开中的文档以内存文本为准（未保存的编辑、inmemory:// 文档都不在磁盘上） */
export interface FindReferencesOptions {
  readonly readOpenText?: (uri: string) => string | undefined;
  readonly lexiconFor?: (uri: string) => import('../../config/lexicons/types.js').Lexicon | undefined;
  /** 打开中的文档：解析缓存里的 token（已对齐原文、含领域词汇翻译信息） */
  readonly tokensForOpen?: (uri: string) => readonly any[] | undefined;
}

export async function findSymbolReferences(
  symbol: string,
  excludeUri?: string,
  options: FindReferencesOptions = {},
): Promise<Location[]> {
  const { exactIdentifierPositions, lexInSourceCoordinates, offsetToPos, ensureUri, uriToFsPath } = await loadNavigationHelpers();
  const locations: Location[] = [];
  const BATCH_SIZE = 20;
  const modules = getAllModules();
  const normalizedExclude = excludeUri ? ensureUri(excludeUri) : undefined;

  // 分批扫描模块，逐个读取文件并查找符号出现位置
  for (let i = 0; i < modules.length; i += BATCH_SIZE) {
    const batch = modules.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (mod): Promise<Location[]> => {
        const uri = ensureUri(mod.uri);
        if (normalizedExclude && uri === normalizedExclude) {
          return [];
        }
        try {
          // ★打开中的文档用内存文本：inmemory:// 文档根本不在磁盘上，读盘恒失败 → 恒空结果
          const content = options.readOpenText?.(mod.uri) ?? await fs.readFile(
            uriToFsPath(uri) ?? (uri.startsWith('file://') ? new URL(uri).pathname : uri), 'utf8');
          // ★只取与原文逐字对齐的标识符 token 位置，不退回正则（正则会命中字符串字面量、冠词等）
          const tokens = options.tokensForOpen?.(mod.uri) ?? lexInSourceCoordinates(content, options.lexiconFor?.(mod.uri));
          const { positions } = exactIdentifierPositions(tokens, content, symbol);
          if (positions.length === 0) {
            return [];
          }
          return positions.map(pos => ({
            uri,
            range: {
              start: offsetToPos(content, pos.start),
              end: offsetToPos(content, pos.end),
            },
          }));
        } catch {
          return [];
        }
      })
    );

    for (const result of batchResults) {
      if (result.length > 0) {
        locations.push(...result);
      }
    }
  }

  return locations;
}
