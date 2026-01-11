/**
 * LSP Workspace 扫描器
 * 递归扫描工作区目录并建立索引
 */

import { promises as fs } from 'node:fs';
import { join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { updateDocumentIndex } from './document-indexer.js';
import { submitTask, TaskPriority } from '../task-queue.js';

/**
 * 递归扫描目录下所有 .aster 文件。
 * @param dir 目录路径。
 * @returns 所有 .aster 文件的绝对路径列表。
 */
async function scanCnlFiles(dir: string): Promise<string[]> {
  const debugLog: string[] = [];
  debugLog.push(`[scanCnlFiles] Starting scan of directory: ${dir}`);

  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    debugLog.push(`[scanCnlFiles] Found ${entries.length} entries in ${dir}`);

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // 跳过常见的排除目录
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
          debugLog.push(`[scanCnlFiles] Skipping excluded directory: ${entry.name}`);
          continue;
        }
        debugLog.push(`[scanCnlFiles] Recursing into subdirectory: ${entry.name}`);
        const subFiles = await scanCnlFiles(fullPath);
        debugLog.push(`[scanCnlFiles] Found ${subFiles.length} .aster files in ${entry.name}`);
        results.push(...subFiles);
      } else if (entry.isFile() && extname(entry.name) === '.aster') {
        debugLog.push(`[scanCnlFiles] Found .aster file: ${entry.name}`);
        results.push(fullPath);
      }
    }
  } catch (error: any) {
    debugLog.push(`[scanCnlFiles] Error reading directory ${dir}: ${error?.message ?? String(error)}`);
  }

  debugLog.push(`[scanCnlFiles] Scan complete: ${results.length} .aster files found`);
  await fs.writeFile('/tmp/lsp-scan-debug.log', debugLog.join('\n') + '\n', { flag: 'a' }).catch(() => {});

  return results;
}

/**
 * 重新构建工作区内给定文件夹的索引信息（内部实现）。
 * @param folders 工作区根文件夹路径列表。
 */
async function rebuildWorkspaceIndexImpl(folders: string[]): Promise<void> {
  const debugLog: string[] = [];
  debugLog.push(`[rebuildWorkspaceIndex] Started at ${new Date().toISOString()}`);
  debugLog.push(`[rebuildWorkspaceIndex] Folders: ${JSON.stringify(folders)}`);

  // 1. 扫描所有 .aster 文件
  const allFiles: string[] = [];
  for (const folder of folders) {
    debugLog.push(`[scanCnlFiles] Scanning folder: ${folder}`);
    try {
      const files = await scanCnlFiles(folder);
      debugLog.push(`[scanCnlFiles] Found ${files.length} files in ${folder}`);
      if (files.length > 0) {
        debugLog.push(`[scanCnlFiles] First 5 files: ${files.slice(0, 5).join(', ')}`);
      }
      allFiles.push(...files);
    } catch (error: any) {
      debugLog.push(`[scanCnlFiles] Error scanning ${folder}: ${error?.message ?? String(error)}`);
    }
  }

  debugLog.push(`[rebuildWorkspaceIndex] Total files found: ${allFiles.length}`);

  if (allFiles.length === 0) {
    debugLog.push(`[rebuildWorkspaceIndex] No files found, exiting early`);
    await fs.writeFile('/tmp/lsp-index-debug.log', debugLog.join('\n'), 'utf8').catch(() => {});
    return; // 没有找到任何文件
  }

  // 2. 批量异步索引（避免一次性加载过多文件）
  const BATCH_SIZE = 20;
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
    const batch = allFiles.slice(i, i + BATCH_SIZE);
    debugLog.push(`[rebuildWorkspaceIndex] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}, files ${i}-${i + batch.length}`);

    await Promise.all(
      batch.map(async (filePath) => {
        try {
          const content = await fs.readFile(filePath, 'utf8');
          const uri = pathToFileURL(filePath).href;
          await updateDocumentIndex(uri, content);
          successCount++;
        } catch (error: any) {
          failureCount++;
          debugLog.push(`[updateDocumentIndex] Failed for ${filePath}: ${error?.message ?? String(error)}`);
        }
      })
    );
  }

  debugLog.push(`[rebuildWorkspaceIndex] Completed: ${successCount} succeeded, ${failureCount} failed`);
  debugLog.push(`[rebuildWorkspaceIndex] Final index size: ${successCount} modules`);

  // Write debug log to temp file
  await fs.writeFile('/tmp/lsp-index-debug.log', debugLog.join('\n'), 'utf8').catch(() => {});
}

/**
 * 重新构建工作区内给定文件夹的索引信息（公共接口，使用任务队列）。
 * @param folders 工作区根文件夹路径列表。
 * @param useQueue 是否使用任务队列（默认 true）
 */
export async function rebuildWorkspaceIndex(folders: string[], useQueue: boolean = true): Promise<void> {
  if (!useQueue) {
    return rebuildWorkspaceIndexImpl(folders);
  }

  // 使用低优先级任务队列，避免阻塞用户交互
  return submitTask(
    'Rebuild Workspace Index',
    TaskPriority.LOW,
    () => rebuildWorkspaceIndexImpl(folders)
  );
}
