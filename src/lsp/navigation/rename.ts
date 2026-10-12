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
import { offsetToPos, ensureUri, uriToFsPath, identifierTokenAt, exactIdentifierPositions, lexInSourceCoordinates } from './shared.js';
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
  getDocumentSettings: (uri: string) => Promise<any>,
  getLexiconForDoc?: (uri: string) => import('../../config/lexicons/types.js').Lexicon | undefined,
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
    // ★只认光标处可编辑的标识符 token（与 prepareRename 同一判据），没有就拒绝——
    //   不退回字符级/正则取词（否则在冠词 the 上按 F2 会把全文每个 the 都改掉）
    const hit = identifierTokenAt(getOrParse(doc).tokens, text, offset, getLexiconForDoc?.(doc.uri));
    if (!hit) return null;
    const word = hit.name;
    /** 打开中的文档用解析缓存里的 token（含领域词汇翻译的对齐信息），其余读盘后词法分析 */
    const tokensFor = (uri: string, t: string): readonly any[] => {
      const open = documents.get(uri);
      return open ? getOrParse(open).tokens : lexInSourceCoordinates(t, getLexiconForDoc?.(uri));
    };
    let refused = false;
    const changes: Record<string, import('vscode-languageserver/node.js').TextEdit[]> = {};
    const settings = await getDocumentSettings(doc.uri).catch(() => defaultSettings);
    const scope = settings.rename?.scope ?? 'workspace';
    const openUris = new Set(documents.keys());
    let processed = 0;
    const modules = getAllModules();
    const total = modules.length;
    try { await updateDocumentIndex(doc.uri, doc.getText(), getLexiconForDoc?.(doc.uri)); } catch {}
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
            // ★打开中的文档用内存文本：inmemory:// 文档不在磁盘上，读盘恒失败 → 旧实现恒回空 changes
            const t = documents.get(rec.uri)?.getText()
              ?? await fsPromises.readFile(uriToFsPath(rec.uri) || rec.uri, 'utf8');
            const { positions, uncertain } = exactIdentifierPositions(tokensFor(rec.uri, t), t, word);
            // 存在位置不确定的同名 token（领域词汇翻译、推算位置）→ 整体拒绝，绝不基于推算位置编辑
            if (uncertain) { refused = true; return null; }
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
    if (refused) return null;
    return { changes };
  });

  // onPrepareRename: 预先校验是否可重命名并返回精确范围
  connection.onPrepareRename(params => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const text = doc.getText();
    const { tokens } = getOrParse(doc);
    // 与 onRenameRequest 同一判据：可编辑标识符 token，且同名 token 位置全部确定；否则不弹重命名框
    const hit = identifierTokenAt(tokens, text, doc.offsetAt(params.position), getLexiconForDoc?.(doc.uri));
    if (!hit || exactIdentifierPositions(tokens, text, hit.name).uncertain) return null;
    return {
      range: { start: offsetToPos(text, hit.start), end: offsetToPos(text, hit.end) },
      placeholder: text.slice(hit.start, hit.end),
    };
  });
}
