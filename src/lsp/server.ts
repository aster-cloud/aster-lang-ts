#!/usr/bin/env node

// Basic LSP server foundation for Aster CNL

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  DidChangeWatchedFilesNotification,
  TextDocumentSyncKind,
  InitializeResult,
  CodeActionKind,
} from 'vscode-languageserver/node.js';

import { performance } from 'node:perf_hooks';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { canonicalize } from '../frontend/canonicalizer.js';
import { lex } from '../frontend/lexer.js';
import { parse, parseWithLexicon } from '../parser.js';
import { needsKeywordTranslation } from '../frontend/keyword-translator.js';
import type {
  Module as AstModule,
  Span,
} from '../types.js';
import { LexiconRegistry, initializeDefaultLexicons } from '../config/lexicons/index.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { attachDiagnosticMessages } from '../config/lexicons/diagnostic-messages.js';
import { buildIdIndex, exprTypeText } from './utils.js';
import {
  getModuleIndex,
  getAllModules,
  updateDocumentIndex,
  invalidateDocument,
  loadIndex,
  saveIndex,
  setIndexConfig,
  rebuildWorkspaceIndex,
  configureFileWatcher,
  startFileWatcher,
  stopFileWatcher,
  handleNativeFileChanges,
  getWatcherStatus,
  configureTaskQueue,
  getQueueStats,
} from './index.js';
import {
  registerDiagnosticHandlers,
  setDiagnosticConfig,
  invalidateDiagnosticCache,
  invalidateTypecheckCache,
  computeWorkspaceDiagnostics,
  setModuleSearchRoots,
  pushDiagnostics,
} from './diagnostics.js';
import { registerCompletionHandlers, typeText } from './completion.js';
import {
  registerNavigationHandlers,
  uriToFsPath,
  ensureUri,
  offsetToPos,
  tokenNameAt,
  collectLetsWithSpan,
} from './navigation.js';
import { registerFormattingHandlers } from './formatting.js';
import { registerCodeActionHandlers } from './codeaction.js';
import { registerSymbolsHandlers } from './symbols.js';
import { registerTokensHandlers, SEM_LEGEND } from './tokens.js';
import { registerHealthHandlers, incrementRestartCount } from './health.js';
import { ConfigService } from '../config/config-service.js';
import { setWarmupPromise } from './shared-state.js';
import { config } from './config.js';
// import { lowerModule } from "../lower_to_core";

// Create a connection for the server, using Node's IPC as a transport.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

/**
 * 注入 LSP 配置到全局上下文
 *
 * 目的：
 * - 使 typecheck 模块能够访问 LSP 配置（如 --enforce-pii 参数）
 * - 避免 LSP 与 typecheck 模块之间的循环依赖
 * - 保持模块解耦，通过 globalThis 传递配置
 *
 * 注入时机：
 * - 必须在 onInitialize 之前完成
 * - 确保首次诊断请求时配置已就绪
 */
globalThis.lspConfig = {
  enforcePiiChecks: config.enforcePiiChecks,
};

type CachedDoc = {
  version: number;
  text: string;
  can: string;
  tokens: readonly any[];
  ast: AstModule | null;
  idIndex?: Map<string, Span[]>;
};
const docCache: Map<string, CachedDoc> = new Map();
const pendingValidate: Map<string, ReturnType<typeof setTimeout>> = new Map();
let currentIndexPath: string | null = null;
let indexPersistenceActive = true;
const workspaceFolders: string[] = [];

/** per-document lexicon 追踪 */
const documentLexicons = new Map<string, Lexicon>();

/** 当前全局 locale 对应的 lexicon（含诊断消息 overlay） */
let currentLexicon: Lexicon | undefined;

function getLexiconForDoc(uri: string): Lexicon | undefined {
  return documentLexicons.get(uri) ?? currentLexicon;
}

function getOrParse(doc: TextDocument): CachedDoc {
  const key = doc.uri;
  const prev = docCache.get(key);
  if (prev && prev.version === doc.version) return prev;
  const text = doc.getText();
  const lexicon = getLexiconForDoc(doc.uri);
  const can = canonicalize(text, lexicon);
  const tokens = lex(can);
  let ast: AstModule | null;
  try {
    ast = lexicon && needsKeywordTranslation(lexicon)
      ? parseWithLexicon(tokens, lexicon) as AstModule
      : parse(tokens, lexicon) as AstModule;
  } catch {
    ast = null;
  }
  const entry: CachedDoc = { version: doc.version, text, can, tokens, ast };
  // Build simple identifier index for performance (by token value)
  entry.idIndex = buildIdIndex(tokens);
  docCache.set(key, entry);
  return entry;
}

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;
let hasWatchedFilesCapability = false;
let watcherRegistered = false;

connection.onInitialize(async (params: InitializeParams) => {
  initializeDefaultLexicons();
  const capabilities = params.capabilities;

  // Does the client support the `workspace/configuration` request?
  hasConfigurationCapability = !!(capabilities.workspace && !!capabilities.workspace.configuration);
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );
  hasWatchedFilesCapability = !!(
    capabilities.workspace &&
    (capabilities.workspace as any).didChangeWatchedFiles &&
    (capabilities.workspace as any).didChangeWatchedFiles.dynamicRegistration
  );

  // Initialize diagnostics module configuration
  setDiagnosticConfig({
    relatedInformationSupported: hasDiagnosticRelatedInformationCapability,
    workspaceDiagnosticsEnabled: true,
    capabilityManifestPath: ConfigService.getInstance().capsManifestPath,
  });

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that this server supports code completion.
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: [' ', '.', ':'],
      },
      diagnosticProvider: {
        interFileDependencies: false,
        workspaceDiagnostics: true,
      },
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix],
      },
      hoverProvider: true,
      documentHighlightProvider: true,
      signatureHelpProvider: {
        triggerCharacters: ['(', ','],
        retriggerCharacters: [',', ')'],
      },
      documentSymbolProvider: true,
      semanticTokensProvider: {
        legend: SEM_LEGEND,
        range: false,
        full: true,
      },
      workspaceSymbolProvider: true,
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      inlayHintProvider: true,
      // Provider 能力声明（对应已实现的功能）
      definitionProvider: true,
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
      documentLinkProvider: { resolveProvider: false },
    },
  };
  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }
  try {
    const { join, relative } = await import('node:path');
    const candidateRoots: Array<string | null | undefined> = [];

    // Collect workspace folders for later index rebuild
    if (Array.isArray(params.workspaceFolders) && params.workspaceFolders.length > 0) {
      for (const folder of params.workspaceFolders) {
        const fsPath = uriToFsPath(folder.uri);
        if (fsPath) {
          workspaceFolders.push(fsPath);
          candidateRoots.push(fsPath);
        }
      }
    }
    if (params.rootUri) {
      const rootFsPath = uriToFsPath(params.rootUri);
      candidateRoots.push(rootFsPath);
    }
    candidateRoots.push(params.rootPath);
    candidateRoots.push(process.cwd());
    const root = candidateRoots.find(r => typeof r === 'string' && r.length > 0) as string | undefined;

    // Fallback: if no workspace folders collected, use root
    if (workspaceFolders.length === 0 && root) {
      workspaceFolders.push(root);
    }
    setModuleSearchRoots(workspaceFolders);
    currentIndexPath = root ? join(root, '.asteri', 'lsp-index.json') : null;
    setIndexConfig({ persistEnabled: true, indexPath: currentIndexPath ?? null, autoSaveDelay: 500 });
    indexPersistenceActive = true;
    if (currentIndexPath) {
      const loaded = await loadIndex(currentIndexPath);
      if (loaded) {
        connection.console.log(`Loaded persisted index from ${relative(root ?? process.cwd(), currentIndexPath)}`);
      }
    }
  } catch (error: any) {
    connection.console.warn(`Index initialization failed: ${error?.message ?? String(error)}`);
  }
  return result;
});

connection.onInitialized(() => {
  incrementRestartCount(); // 記錄進程重啟
  // 初始化任务队列
  configureTaskQueue({
    maxConcurrent: 2,
    taskTimeout: 60000, // 60 秒
    enabled: true,
  });

  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders(() => {
      connection.console.log('Workspace folder change event received.');
      setModuleSearchRoots(workspaceFolders);
    });
  }
  // Respond to external file changes if client supports it
  if (hasWatchedFilesCapability) {
    try {
      connection.client.register(DidChangeWatchedFilesNotification.type, {
        watchers: [{ globPattern: '**/*.aster' }],
      });
      watcherRegistered = true;
      // 配置为 native 模式（由客户端提供文件监控）
      configureFileWatcher({ mode: 'native', enabled: true });
    } catch {
      // ignore registration failure
    }
    connection.onDidChangeWatchedFiles(async ev => {
      try {
        await handleNativeFileChanges(ev.changes);
      } catch {
        // ignore
      }
    });
  } else {
    connection.console.warn(
      'Client does not advertise didChangeWatchedFiles; falling back to polling mode.'
    );
    // 降级到 polling 模式
    configureFileWatcher({
      mode: 'polling',
      enabled: true,
      pollingInterval: 3000, // 3 秒轮询一次
    });
    startFileWatcher(workspaceFolders);
  }

  // Background warmup: Rebuild workspace index and pre-compute diagnostics
  if (workspaceFolders.length > 0) {
    const warmupPromise = (async (): Promise<void> => {
      try {
        await rebuildWorkspaceIndex(workspaceFolders);
        connection.console.log(`Workspace index rebuilt: ${getAllModules().length} modules indexed`);

        // Pre-compute diagnostics for all indexed modules
        const warmupStart = performance.now();
        const modules = getAllModules();
        await computeWorkspaceDiagnostics(modules, documents, getOrParse);
        const warmupDuration = performance.now() - warmupStart;
        connection.console.log(`Diagnostics warmup completed in ${warmupDuration.toFixed(2)}ms`);
      } catch (error: any) {
        connection.console.warn(`Workspace index rebuild failed: ${error?.message ?? String(error)}`);
      }
    })();
    setWarmupPromise(warmupPromise);
  }

  // Register health handlers
  registerHealthHandlers(connection, hasWatchedFilesCapability, watcherRegistered, getAllModules, getWatcherStatus, getQueueStats);

  // Register diagnostic handlers
  registerDiagnosticHandlers(connection, documents, getOrParse, getLexiconForDoc);

  // Register completion handlers
  registerCompletionHandlers(connection, documents, getOrParse, getLexiconForDoc);

  // Register navigation handlers
  registerNavigationHandlers(connection, documents, getOrParse, getDocumentSettings, getLexiconForDoc);

  // Register formatting handlers
  registerFormattingHandlers(connection, documents, getDocumentSettings);

  // Register code action handlers
  registerCodeActionHandlers(connection, documents, getOrParse, uriToFsPath, getLexiconForDoc);

  // Register symbols handlers
  registerSymbolsHandlers(connection, documents, getAllModules, ensureUri, offsetToPos);

  // Register tokens handlers (semantic tokens, inlay hints, document highlight)
  registerTokensHandlers(connection, documents, getOrParse, typeText, exprTypeText, tokenNameAt, collectLetsWithSpan);
});

// The example settings
interface AsterSettings {
  maxNumberOfProblems: number;
  format?: { mode?: 'lossless' | 'normalize'; reflow?: boolean };
  index?: { persist?: boolean; path?: string };
  rename?: { scope?: 'open' | 'workspace' };
  diagnostics?: { workspace?: boolean };
  streaming?: { referencesChunk?: number; renameChunk?: number; logChunks?: boolean };
  locale?: string; // 'en-US' | 'zh-CN' | 'de-DE'
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
const defaultSettings: AsterSettings = { maxNumberOfProblems: 1000, format: { mode: 'lossless', reflow: true }, index: { persist: true }, rename: { scope: 'workspace' }, diagnostics: { workspace: true }, streaming: { referencesChunk: 200, renameChunk: 200, logChunks: false } };
let globalSettings: AsterSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Promise<AsterSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
  if (hasConfigurationCapability) {
    // Reset all cached document settings
    documentSettings.clear();
  } else {
    globalSettings = <AsterSettings>(change.settings.asterLanguageServer || defaultSettings);
  }

  // Revalidate caches for open documents (pull diagnostics will request when needed)
  documents.all().forEach(doc => { try { void getOrParse(doc); } catch {} });
  // Update diagnostics, index, and locale settings
  getDocumentSettings('').then(s => {
    setDiagnosticConfig({
      workspaceDiagnosticsEnabled: s.diagnostics?.workspace ?? true,
    });
    const persistEnabled = s.index?.persist ?? true;
    if (typeof s.index?.path === 'string' && s.index.path.length > 0) {
      currentIndexPath = s.index.path;
    }
    setIndexConfig({
      persistEnabled,
      indexPath: currentIndexPath ?? null,
    });
    indexPersistenceActive = persistEnabled;

    // 更新 locale 对应的 lexicon
    const locale = s.locale ?? 'en-US';
    if (locale === 'en-US') {
      currentLexicon = undefined;
      documentLexicons.clear();
    } else {
      const lex = LexiconRegistry.has(locale) ? LexiconRegistry.get(locale) : undefined;
      currentLexicon = lex ? attachDiagnosticMessages(lex) : undefined;
      // 清除 docCache 以触发重新解析
      docCache.clear();
    }
  }).catch(() => {
    setDiagnosticConfig({
      workspaceDiagnosticsEnabled: true,
    });
    setIndexConfig({
      persistEnabled: true,
      indexPath: currentIndexPath ?? null,
    });
    indexPersistenceActive = true;
  });
});

function getDocumentSettings(resource: string): Promise<AsterSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings);
  }
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: 'asterLanguageServer',
    });
    documentSettings.set(resource, result);
  }
  return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
  documentSettings.delete(e.document.uri);
});

// Push initial diagnostics when a document is opened
documents.onDidOpen(async (e) => {
  try {
    // Small delay to ensure document is fully initialized
    setTimeout(async () => {
      try { await pushDiagnostics(e.document.uri); } catch {}
    }, 100);
  } catch {}
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
  const uri = change.document.uri;
  const prev = pendingValidate.get(uri);
  if (prev) clearTimeout(prev);
  const handle = setTimeout(async () => {
    pendingValidate.delete(uri);
    // Parse to keep caches warm for fast responses
    try { void getOrParse(change.document); } catch {}
    // Push diagnostics to client (for clients that don't support pull-based diagnostics)
    try { await pushDiagnostics(uri); } catch {}
  }, 150);
  pendingValidate.set(uri, handle);
  // Clear diagnostic cache when document changes
  try {
    invalidateDiagnosticCache(uri);
  } catch {
    // ignore
  }
  // Clear typecheck cache and cascade to dependents
  try {
    invalidateTypecheckCache(uri);
  } catch {
    // ignore
  }
  // Update index for open document
  try {
    void updateDocumentIndex(change.document.uri, change.document.getText()).catch(() => {});
  } catch {
    // ignore
  }
});

documents.onDidSave(e => {
  try {
    void updateDocumentIndex(e.document.uri, e.document.getText()).catch(() => {});
  } catch {
    // ignore
  }
});

// Range formatting provider (lossless with minimal seam reflow)
// Formatting handlers (rangeFormatting, documentFormatting) moved to ./formatting.js
documents.onDidClose(e => {
  docCache.delete(e.document.uri);
  documentLexicons.delete(e.document.uri);
  try {
    const existing = getModuleIndex(e.document.uri);
    if (existing) invalidateDocument(e.document.uri);
  } catch {}
});

// Workspace symbols and document links handlers moved to ./symbols.js

// Navigation handlers (references, rename, hover, symbols, definition) moved to ./navigation.js
// Helper functions (captureWordAt, findTokenPositionsSafe, etc.) also moved to ./navigation.js

// Inlay hints handler moved to ./tokens.js

// CodeAction handlers (effect declarations, capability manifest, interop fixes, etc.) moved to ./codeaction.js

// toGuideUri helper function moved to ./symbols.js

// onHover handler moved to ./navigation.js


// Document highlight handler moved to ./tokens.js

// Navigation helper functions (spanOrDoc, funcDetail, within, findDeclAt, tokenNameAt, etc.) moved to ./navigation.js

// Semantic tokens handler and helper functions (SEM_LEGEND, tokenTypeIndexMap, tokenModIndexMap) moved to ./tokens.js

// Go to definition: functions/types/params/locals (single-file)
// AST query helpers (collectBlockSymbols, toLocation, collectLetsWithSpan, enumVariantSpanMap,
// dataFieldSpanMap, findConstructFieldAt, findLocalLetWithExpr, findPatternBindingDetail) moved to ./navigation.js

// Quick fixes / hints for ambiguous interop calls
// Second CodeAction handler (merged with first into ./codeaction.js)

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

connection.onExit(() => {
  stopFileWatcher();
  if (!currentIndexPath || !indexPersistenceActive) return;
  void saveIndex(currentIndexPath).catch(() => {});
});

// Listen on the connection
connection.listen();
