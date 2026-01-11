/**
 * LSP Rename 处理器
 * 提供符号重命名功能（包括准备阶段和执行阶段）
 */

import type {
  Connection,
  RenameParams,
  WorkspaceEdit,
  ProgressToken
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getAllModules, updateDocumentIndex } from '../index.js';
import { captureWordAt, findTokenPositionsSafe, offsetToPos, ensureUri, uriToFsPath, tokenNameAt } from './shared.js';
import { promises as fsPromises } from 'node:fs';

/**
 * LSP 参数类型扩展，包含 progress token 字段
 */
interface ParamsWithProgress {
  workDoneToken?: ProgressToken;
  partialResultToken?: ProgressToken;
}

const defaultSettings = { rename: { scope: 'workspace' }, streaming: { referencesChunk: 200, renameChunk: 200, logChunks: false } };

/**
 * 注册 Rename 相关处理器（onRenameRequest 和 onPrepareRename）
 * @param connection LSP 连接对象
 * @param documents 文档管理器
 * @param getOrParse 文档解析函数
 * @param getDocumentSettings 获取文档设置的函数
 */
export function registerRenameHandlers(
  connection: Connection,
  documents: { get(uri: string): TextDocument | undefined; keys(): string[] },
  getOrParse: (doc: TextDocument) => { text: string; tokens: readonly any[]; ast: any },
  getDocumentSettings: (uri: string) => Promise<any>
): void {
  const _beginProgress = (token: ProgressToken | undefined, title: string): void => {
    try {
      if (!token) return;
      (connection as any).sendProgress('$/progress', token, { kind: 'begin', title });
    } catch {
      // ignore
    }
  };

  const _reportProgress = (token: ProgressToken | undefined, message: string): void => {
    try {
      if (!token) return;
      (connection as any).sendProgress('$/progress', token, { kind: 'report', message });
    } catch {
      // ignore
    }
  };

  const _endProgress = (token: ProgressToken | undefined): void => {
    try {
      if (!token) return;
      (connection as any).sendProgress('$/progress', token, { kind: 'end' });
    } catch {
      // ignore
    }
  };

  // onRenameRequest: 重命名符号
  connection.onRenameRequest(async (params: RenameParams & ParamsWithProgress, token?: any): Promise<WorkspaceEdit | null> => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const text = doc.getText();
    const offset = doc.offsetAt(params.position);
    const word = captureWordAt(text, offset);
    if (!word) return null;
    const changes: Record<string, import('vscode-languageserver/node.js').TextEdit[]> = {};
    const settings = await getDocumentSettings(doc.uri).catch(() => defaultSettings);
    const scope = settings.rename?.scope ?? 'workspace';
    const openUris = new Set(documents.keys());
    let processed = 0;
    const modules = getAllModules();
    const total = modules.length;
    try { await updateDocumentIndex(doc.uri, doc.getText()); } catch {}
    _beginProgress(params.workDoneToken, 'Aster rename');
    const CHUNK = settings.streaming?.renameChunk ?? 200;
    const BATCH_SIZE = 20; // 批量并发读取文件数
    let editsInChunk = 0;

    // 批量异步处理模块
    for (let i = 0; i < modules.length; i += BATCH_SIZE) {
      if (token?.isCancellationRequested) break;

      const batch = modules.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (rec) => {
          if (scope === 'open' && !openUris.has(rec.uri)) return null;
          try {
            const uri = ensureUri(rec.uri);
            const fsPath = uriToFsPath(rec.uri) || rec.uri;
            const t = await fsPromises.readFile(fsPath, 'utf8');
            const positions = findTokenPositionsSafe(t, word);
            if (positions.length === 0) return null;
            const edits: import('vscode-languageserver/node.js').TextEdit[] = positions.map(p => ({
              range: { start: offsetToPos(t, p.start), end: offsetToPos(t, p.end) },
              newText: params.newName
            }));
            return { uri, edits };
          } catch {
            return null;
          }
        })
      );

      // 合并结果
      for (const result of batchResults) {
        if (!result) continue;
        changes[result.uri] = (changes[result.uri] || []).concat(result.edits);
        editsInChunk += result.edits.length;
        if (editsInChunk >= CHUNK) {
          _reportProgress(params.workDoneToken, `rename: +${editsInChunk}`);
          editsInChunk = 0;
        }
      }

      processed += batch.length;
      if (processed % 50 === 0 || processed === total) {
        _reportProgress(params.workDoneToken, `${processed}/${total}`);
      }
    }
    _endProgress(params.workDoneToken);
    return { changes };
  });

  // onPrepareRename: 预先校验是否可重命名并返回精确范围
  connection.onPrepareRename(params => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;

    const entry = getOrParse(doc);
    const { tokens: toks } = entry;
    const nameAt = tokenNameAt(toks, params.position);
    if (!nameAt) {
      // 光标未命中有效标识符，直接拒绝
      return null;
    }

    const text = doc.getText();
    const offset = doc.offsetAt(params.position);
    const precisePositions = findTokenPositionsSafe(text, nameAt);
    const precise = precisePositions.find(pos => offset >= pos.start && offset <= pos.end);
    if (precise) {
      return {
        range: {
          start: offsetToPos(text, precise.start),
          end: offsetToPos(text, precise.end),
        },
        placeholder: text.slice(precise.start, precise.end),
      };
    }

    // 词法精确匹配失败时回退到简单的词边界捕获
    const fallback = captureWordAt(text, offset);
    if (!fallback) return null;
    const isWord = (c: string): boolean => /[A-Za-z0-9_.]/.test(c);
    let start = offset;
    while (start > 0 && isWord(text[start - 1]!)) start--;
    let end = offset;
    while (end < text.length && isWord(text[end]!)) end++;

    return {
      range: {
        start: offsetToPos(text, start),
        end: offsetToPos(text, end),
      },
      placeholder: text.slice(start, end),
    };
  });
}
