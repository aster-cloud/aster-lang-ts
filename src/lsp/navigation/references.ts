/**
 * LSP References 处理器
 * 查找符号的所有引用位置
 */

import type {
  Connection,
  ReferenceParams,
  Location,
  ProgressToken
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { findSymbolReferences, updateDocumentIndex } from '../index.js';
import { captureWordAt } from './shared.js';

/**
 * LSP 参数类型扩展，包含 progress token 字段
 */
interface ParamsWithProgress {
  workDoneToken?: ProgressToken;
  partialResultToken?: ProgressToken;
}

const defaultSettings = { rename: { scope: 'workspace' }, streaming: { referencesChunk: 200, renameChunk: 200, logChunks: false } };

/**
 * 注册 References 处理器
 * @param connection LSP 连接对象
 * @param documents 文档管理器
 * @param getDocumentSettings 获取文档设置的函数
 */
export function registerReferencesHandler(
  connection: Connection,
  documents: { get(uri: string): TextDocument | undefined; keys(): string[] },
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

  connection.onReferences(async (params: ReferenceParams & ParamsWithProgress, token?: any) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const text = doc.getText();
    const pos = params.position;
    const offset = doc.offsetAt(pos);
    // naive token capture: expand to nearest word boundaries
    const word = captureWordAt(text, offset);
    if (!word) return [];
    const out: Location[] = [];
    const settings = await getDocumentSettings(doc.uri).catch(() => defaultSettings);
    const scope = settings.rename?.scope ?? 'workspace';
    const openUris = new Set(documents.keys());
    try { await updateDocumentIndex(doc.uri, doc.getText()); } catch {}
    const refs = await findSymbolReferences(word, undefined);
    const filtered = scope === 'open' ? refs.filter(loc => openUris.has(loc.uri)) : refs;
    _beginProgress(params.workDoneToken, 'Aster references');
    const CHUNK = settings.streaming?.referencesChunk ?? 200;
    let batch: Location[] = [];
    for (const loc of filtered) {
      if (token?.isCancellationRequested) break;
      out.push(loc);
      batch.push(loc);
      if (batch.length >= CHUNK) {
        try { (connection as any).sendProgress('$/progress', params.partialResultToken, { kind: 'report', message: `references: +${batch.length}`, items: batch }); } catch {}
        _reportProgress(params.workDoneToken, `references: +${batch.length}`);
        try { if (settings.streaming?.logChunks) connection.console.log(`references chunk: +${batch.length}`); } catch {}
        batch = [];
      }
    }
    if (batch.length > 0) {
      try { (connection as any).sendProgress('$/progress', params.partialResultToken, { kind: 'report', message: `references: +${batch.length}`, items: batch }); } catch {}
      _reportProgress(params.workDoneToken, `references: +${batch.length}`);
      try { if (settings.streaming?.logChunks) connection.console.log(`references chunk: +${batch.length}`); } catch {}
    }
    _endProgress(params.workDoneToken);
    return out;
  });
}
