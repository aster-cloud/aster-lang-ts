/**
 * LSP Workspace 符号查找器
 * 在工作区中查找符号的所有引用
 */

import { promises as fs } from 'node:fs';
import type { Location } from 'vscode-languageserver-types';
import { getAllModules } from './index-manager.js';

type NavigationHelpers = Pick<typeof import('../navigation.js'), 'findTokenPositionsSafe' | 'offsetToPos' | 'ensureUri' | 'uriToFsPath'>;
let navigationHelpersPromise: Promise<NavigationHelpers> | null = null;

/**
 * 延迟加载导航模块中的公共工具函数，避免循环依赖导致的初始化问题。
 */
async function loadNavigationHelpers(): Promise<NavigationHelpers> {
  if (!navigationHelpersPromise) {
    navigationHelpersPromise = import('../navigation.js').then(mod => ({
      findTokenPositionsSafe: mod.findTokenPositionsSafe,
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
export async function findSymbolReferences(symbol: string, excludeUri?: string): Promise<Location[]> {
  const { findTokenPositionsSafe, offsetToPos, ensureUri, uriToFsPath } = await loadNavigationHelpers();
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
          const fsPath = uriToFsPath(uri) ?? (uri.startsWith('file://') ? new URL(uri).pathname : uri);
          const content = await fs.readFile(fsPath, 'utf8');
          const positions = findTokenPositionsSafe(content, symbol);
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
