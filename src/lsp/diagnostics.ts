import type { Diagnostic, Connection, Range } from 'vscode-languageserver/node.js';
import {
  DiagnosticSeverity,
  DocumentDiagnosticRequest,
  type DocumentDiagnosticReport,
  DocumentDiagnosticReportKind,
  WorkspaceDiagnosticRequest,
  type WorkspaceDiagnosticReport,
  type WorkspaceDocumentDiagnosticReport,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { promises as fs, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getAllModules } from './index.js';
import {
  typecheckModule,
  typecheckModuleWithCapabilities,
  type TypecheckDiagnostic,
} from '../typecheck.js';
import { parse } from '../parser.js';
import { lowerModule } from '../lower_to_core.js';
import type { Lexicon } from '../config/lexicons/types.js';
import { getLspUiTexts } from '../config/lexicons/lsp-ui-texts.js';
import { DiagnosticError } from '../diagnostics/diagnostics.js';
import { collectSemanticDiagnostics } from './analysis.js';
import type { CapabilityManifest } from '../effects/capabilities.js';
import { ConfigService } from '../config/config-service.js';
import { invalidateModuleEffectsByUri } from './module_cache.js';

/**
 * 表示诊断模块的配置选项。
 */
export interface DiagnosticConfig {
  /**
   * 是否支持诊断关联信息功能。
   */
  relatedInformationSupported: boolean;
  /**
   * 是否启用工作区级诊断。
   */
  workspaceDiagnosticsEnabled: boolean;
  /**
   * 能力清单文件的绝对路径，可为空表示未配置。
   */
  capabilityManifestPath: string | null;
}

let diagnosticConfig: DiagnosticConfig = {
  relatedInformationSupported: false,
  workspaceDiagnosticsEnabled: true,
  capabilityManifestPath: ConfigService.getInstance().capsManifestPath,
};

let manifestCache: {
  path: string;
  data: CapabilityManifest | null;
} | null = null;

let moduleSearchRoots: string[] = [];

export function setModuleSearchRoots(roots: readonly string[]): void {
  moduleSearchRoots = roots.map(root => resolve(root));
}

/**
 * 诊断结果缓存，以 URI + 文档版本号为键。
 * 当文档未变更时，直接返回缓存的诊断结果，避免重复类型检查。
 */
type DiagnosticCacheEntry = {
  version: number;
  diagnostics: Diagnostic[];
  timestamp: number;
};
const diagnosticCache = new Map<string, DiagnosticCacheEntry>();

/**
 * 模块级类型检查结果缓存，用于增量类型检查优化。
 * 缓存每个模块的类型检查诊断结果和依赖关系。
 */
type TypecheckCacheEntry = {
  moduleName: string;          // 模块名称
  version: number;              // 文档版本号
  diagnostics: TypecheckDiagnostic[];  // 类型检查诊断结果
  imports: string[];            // 该模块导入的其他模块名称列表
  timestamp: number;            // 缓存时间戳
};
const typecheckCache = new Map<string, TypecheckCacheEntry>();

/**
 * 反向依赖图：记录哪些模块依赖于某个模块。
 * 键：被依赖的模块名称
 * 值：依赖该模块的模块 URI 列表
 */
const dependentsMap = new Map<string, Set<string>>();

/**
 * 从 Core.Module 中提取导入的模块名称列表。
 * @param coreModule Core IR 模块
 * @returns 导入的模块名称数组
 */
function extractImports(coreModule: any): string[] {
  const imports: string[] = [];
  if (!coreModule || !Array.isArray(coreModule.decls)) {
    return imports;
  }

  for (const decl of coreModule.decls) {
    if (decl && decl.kind === 'Import' && typeof decl.name === 'string') {
      imports.push(decl.name);
    }
  }

  return imports;
}

/**
 * 更新反向依赖图：记录 importerUri 依赖于 imports 中的模块。
 * @param importerUri 导入者的 URI
 * @param imports 被导入的模块名称列表
 */
function updateDependentsMap(importerUri: string, imports: string[]): void {
  for (const moduleName of imports) {
    if (!dependentsMap.has(moduleName)) {
      dependentsMap.set(moduleName, new Set());
    }
    dependentsMap.get(moduleName)!.add(importerUri);
  }
}

/**
 * 从反向依赖图中移除指定 URI 的所有依赖记录。
 * @param uri 要移除的 URI
 */
function removeFromDependentsMap(uri: string): void {
  for (const dependents of dependentsMap.values()) {
    dependents.delete(uri);
  }
}

/**
 * 获取依赖于指定模块的所有 URI（递归获取传递依赖）。
 * @param moduleName 模块名称
 * @param visited 已访问的模块集合（用于避免循环依赖）
 * @returns 所有依赖该模块的 URI 集合
 */
function getDependentUris(moduleName: string, visited = new Set<string>()): Set<string> {
  const result = new Set<string>();

  if (visited.has(moduleName)) {
    return result; // 避免循环依赖
  }
  visited.add(moduleName);

  const directDependents = dependentsMap.get(moduleName);
  if (!directDependents) {
    return result;
  }

  for (const uri of directDependents) {
    result.add(uri);

    // 递归获取该 URI 对应模块的依赖者
    const cached = typecheckCache.get(uri);
    if (cached) {
      const transitiveDependents = getDependentUris(cached.moduleName, visited);
      for (const dep of transitiveDependents) {
        result.add(dep);
      }
    }
  }

  return result;
}

/**
 * 清除指定 URI 的诊断缓存。
 * @param uri 文档 URI。
 */
export function invalidateDiagnosticCache(uri: string): void {
  diagnosticCache.delete(uri);
}

/**
 * 清除指定 URI 的类型检查缓存，并传递失效所有依赖者。
 * @param uri 文档 URI
 */
export function invalidateTypecheckCache(uri: string): void {
  invalidateModuleEffectsByUri(uri);
  const cached = typecheckCache.get(uri);
  if (!cached) {
    return; // 没有缓存，无需失效
  }

  // 获取所有依赖该模块的 URI
  const dependentUris = getDependentUris(cached.moduleName);

  // 失效该模块及其所有依赖者
  typecheckCache.delete(uri);
  removeFromDependentsMap(uri);

  for (const depUri of dependentUris) {
    typecheckCache.delete(depUri);
    removeFromDependentsMap(depUri);
  }
}

/**
 * 异步加载能力清单文件。
 * @returns 成功时返回清单数据，失败或未配置时返回 null。
 */
export async function loadCapabilityManifest(): Promise<CapabilityManifest | null> {
  const path = diagnosticConfig.capabilityManifestPath;
  if (!path) return null;

  if (manifestCache?.path === path) {
    return manifestCache.data;
  }

  try {
    const content = await fs.readFile(path, 'utf8');
    const data = JSON.parse(content) as CapabilityManifest;
    manifestCache = { path, data };
    return data;
  } catch (error) {
    // Use stderr to avoid corrupting the LSP protocol stream on stdout
    console.error('[Diagnostics] Failed to load capability manifest:', error);
    manifestCache = { path, data: null };
    return null;
  }
}

/**
 * 清空能力清单缓存，下次诊断时重新加载。
 */
export function invalidateManifestCache(): void {
  manifestCache = null;
}

/**
 * 更新诊断模块的运行配置。
 * @param config 新配置对象（部分更新）。
 */
export function setDiagnosticConfig(config: Partial<DiagnosticConfig>): void {
  diagnosticConfig = { ...diagnosticConfig, ...config };
  if (config.capabilityManifestPath !== undefined) {
    invalidateManifestCache();
  }
}

/**
 * 计算指定文档的诊断信息。
 * @param textDocument 目标文档。
 * @param getOrParse 获取缓存的解析结果函数。
 * @returns 诊断列表。
 */
export async function computeDiagnostics(
  textDocument: TextDocument,
  getOrParse: (doc: TextDocument) => { text: string; tokens: readonly any[]; ast: any },
  lexicon?: Lexicon,
): Promise<Diagnostic[]> {
  const startTime = Date.now();

  // 检查诊断缓存
  const uri = textDocument.uri;
  const version = textDocument.version;
  const cached = diagnosticCache.get(uri);
  if (cached && cached.version === version) {
    // 缓存命中，直接返回
    const duration = Date.now() - startTime;
    if (duration > 1) {
      // Use stderr to avoid corrupting the LSP protocol stream on stdout
      console.error(`[Diagnostics] Cache hit for ${uri} (${duration}ms)`);
    }
    return cached.diagnostics;
  }

  const { tokens, ast } = getOrParse(textDocument);

  const diagnostics: Diagnostic[] = [];

  try {
    const parsed = ast ?? parse(tokens);

    // 运行语义检查（包含互操作、空值和 PII 流检查）
    try {
      const core = lowerModule(parsed);
      diagnostics.push(...collectSemanticDiagnostics(tokens, core));

      // 类型检查（使用模块级缓存）
      const moduleName = (parsed as any).name || '';
      const imports = extractImports(core);

      // 检查类型检查缓存
      const tcCached = typecheckCache.get(uri);
      let tdiags: TypecheckDiagnostic[];

      if (tcCached && tcCached.version === version && tcCached.moduleName === moduleName) {
        // 缓存命中，直接使用缓存的类型检查结果
        tdiags = tcCached.diagnostics;
        // Use stderr to avoid corrupting the LSP protocol stream on stdout
        console.error(`[TypecheckCache] Cache hit for ${uri} (module: ${moduleName})`);
      } else {
        // 缓存未命中或版本不匹配，执行类型检查
        const typecheckStart = Date.now();
        const manifest = await loadCapabilityManifest();
        const moduleSearchPaths = buildModuleSearchPaths(uri);
        const typecheckOptions = { uri, moduleSearchPaths, lexicon };
        tdiags = manifest
          ? typecheckModuleWithCapabilities(core, manifest, typecheckOptions)
          : typecheckModule(core, typecheckOptions);
        const typecheckTime = Date.now() - typecheckStart;

        // 更新类型检查缓存
        typecheckCache.set(uri, {
          moduleName,
          version,
          diagnostics: tdiags,
          imports,
          timestamp: Date.now(),
        });

        // 更新反向依赖图
        removeFromDependentsMap(uri); // 先清除旧的依赖关系
        updateDependentsMap(uri, imports);

        // Use stderr to avoid corrupting the LSP protocol stream on stdout
        console.error(`[TypecheckCache] Cached ${uri} (module: ${moduleName}, typecheck: ${typecheckTime}ms, imports: ${imports.length})`);
      }

      // 转换为 LSP Diagnostic 格式
      for (const td of tdiags) {
        // 优先使用 span，回退到 origin，最后使用文件起点
        let range: Range;
        if (td.span) {
          range = {
            start: { line: td.span.start.line - 1, character: td.span.start.col - 1 },
            end: { line: td.span.end.line - 1, character: td.span.end.col - 1 },
          };
        } else if (td.origin) {
          range = {
            start: { line: td.origin.start.line - 1, character: td.origin.start.col - 1 },
            end: { line: td.origin.end.line - 1, character: td.origin.end.col - 1 },
          };
        } else {
          range = {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          };
        }

        const d: Diagnostic = {
          severity:
            td.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
          range,
          message: td.message,
          source: td.source ?? 'aster-typecheck', // P1-3 Task 6: 透传诊断来源标识
        };
        if (td.code !== null && td.code !== undefined) (d as any).code = td.code as string;
        if (td.data !== null && td.data !== undefined) (d as any).data = td.data as any;
        diagnostics.push(d);
      }
    } catch {
      // 忽略类型检查失败；解析错误在下方处理
    }
  } catch (error) {
    if (error instanceof DiagnosticError) {
      const diag = error.diagnostic;
      const diagnostic: Diagnostic = {
        severity:
          diag.severity === 'error'
            ? DiagnosticSeverity.Error
            : diag.severity === 'warning'
              ? DiagnosticSeverity.Warning
              : diag.severity === 'info'
                ? DiagnosticSeverity.Information
                : DiagnosticSeverity.Hint,
        range: {
          start: { line: diag.span.start.line - 1, character: diag.span.start.col - 1 },
          end: { line: diag.span.end.line - 1, character: diag.span.end.col - 1 },
        },
        message: diag.message,
        source: 'aster',
        code: diag.code,
      };

      if (diag.relatedInformation && diagnosticConfig.relatedInformationSupported) {
        diagnostic.relatedInformation = diag.relatedInformation.map(info => ({
          location: {
            uri: textDocument.uri,
            range: {
              start: { line: info.span.start.line - 1, character: info.span.start.col - 1 },
              end: { line: info.span.end.line - 1, character: info.span.end.col - 1 },
            },
          },
          message: info.message,
        }));
      }

      diagnostics.push(diagnostic);
    } else {
      // 通用错误的后备处理
      const diagnostic: Diagnostic = {
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        message: error instanceof Error ? error.message : String(error),
        source: 'aster',
      };
      diagnostics.push(diagnostic);
    }
  }

  try {
    // 如果缺少模块头，添加温和的警告
    const a = ast ?? parse(tokens);
    if (!a || !(a as any).name) {
      const ui = getLspUiTexts(lexicon);
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        message: ui.missingModuleHeader,
        source: 'aster',
      });
    }
  } catch {
    // 忽略
  }

  // 更新诊断缓存
  diagnosticCache.set(uri, {
    version,
    diagnostics,
    timestamp: Date.now(),
  });

  return diagnostics;
}

const BATCH_SIZE = 5;

function buildModuleSearchPaths(uri: string): string[] {
  const candidates = new Set<string>();
  const fsPath = uriToFsPath(uri);
  if (fsPath) {
    const dir = dirname(fsPath);
    const resolvedDir = resolve(dir);
    candidates.add(resolvedDir);
    candidates.add(join(resolvedDir, '.aster', 'packages'));
  }
  for (const root of moduleSearchRoots) {
    candidates.add(root);
    candidates.add(join(root, '.aster', 'packages'));
  }
  return [...candidates];
}

/**
 * 将 URI 转换为文件系统路径。
 * @param uri 文档 URI。
 * @returns 成功时返回路径，失败时返回 null。
 */
function uriToFsPath(uri: string): string | null {
  try {
    if (uri.startsWith('file://')) return new URL(uri).pathname;
  } catch {}
  return null;
}

/**
 * 批次并行计算工作区内所有文档的诊断。
 * @param modules 模块列表。
 * @param documents 文档管理器。
 * @param getOrParse 获取缓存解析结果的函数。
 * @returns 工作区诊断报告列表。
 */
export async function computeWorkspaceDiagnostics(
  modules: Array<{ uri: string }>,
  documents: { get(uri: string): TextDocument | undefined },
  getOrParse: (doc: TextDocument) => { text: string; tokens: readonly any[]; ast: any }
): Promise<WorkspaceDocumentDiagnosticReport[]> {
  if (!diagnosticConfig.workspaceDiagnosticsEnabled) {
    return [];
  }

  const results: WorkspaceDocumentDiagnosticReport[] = [];

  for (let i = 0; i < modules.length; i += BATCH_SIZE) {
    const batch = modules.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (rec) => {
        try {
          let doc = documents.get(rec.uri);
          if (!doc) {
            const fsPath = uriToFsPath(rec.uri);
            if (!fsPath || !existsSync(fsPath)) return null;
            const text = await fs.readFile(fsPath, 'utf8');
            // 使用 version=1 以匹配 LSP didOpen 时的版本号，确保预热缓存能被命中
            doc = TextDocument.create(rec.uri, 'cnl', 1, text);
          }
          const items = await computeDiagnostics(doc, getOrParse);
          return {
            uri: rec.uri,
            version: documents.get(rec.uri)?.version || null,
            kind: DocumentDiagnosticReportKind.Full,
            items,
          };
        } catch {
          return null;
        }
      })
    );
    results.push(...(batchResults.filter(r => r !== null) as WorkspaceDocumentDiagnosticReport[]));
  }

  return results;
}

// 保存 connection 引用用于推送诊断
let connectionRef: Connection | null = null;
let documentsRef: { get(uri: string): TextDocument | undefined } | null = null;
let getOrParseRef: ((doc: TextDocument) => { text: string; tokens: readonly any[]; ast: any }) | null = null;
let getLexiconForDocRef: ((uri: string) => Lexicon | undefined) | null = null;

/**
 * 推送诊断到客户端（push-based diagnostics）。
 * 用于在文档变更后主动向客户端发送诊断信息。
 * @param uri 文档 URI
 */
export async function pushDiagnostics(uri: string): Promise<void> {
  if (!connectionRef || !documentsRef || !getOrParseRef) {
    return;
  }

  const doc = documentsRef.get(uri);
  if (!doc) {
    return;
  }

  try {
    const lexicon = getLexiconForDocRef?.(uri);
    const diagnostics = await computeDiagnostics(doc, getOrParseRef, lexicon);
    connectionRef.sendDiagnostics({
      uri,
      version: doc.version,
      diagnostics,
    });
  } catch (error) {
    // 发送诊断失败时不阻塞，仅记录错误
    console.error(`[Diagnostics] Failed to push diagnostics for ${uri}:`, error);
  }
}

/**
 * 注册诊断相关的 LSP 请求处理器。
 * @param connection LSP 连接对象。
 * @param documents 文档管理器。
 * @param getOrParse 获取缓存解析结果的函数。
 */
export function registerDiagnosticHandlers(
  connection: Connection,
  documents: { get(uri: string): TextDocument | undefined },
  getOrParse: (doc: TextDocument) => { text: string; tokens: readonly any[]; ast: any },
  getLexiconForDoc?: (uri: string) => Lexicon | undefined,
): void {
  // 保存引用用于推送诊断
  connectionRef = connection;
  documentsRef = documents;
  getOrParseRef = getOrParse;
  getLexiconForDocRef = getLexiconForDoc ?? null;
  // LSP 3.17+ pull diagnostics handler
  connection.onRequest(
    DocumentDiagnosticRequest.type,
    async (params): Promise<DocumentDiagnosticReport> => {
      try {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) {
          return { kind: DocumentDiagnosticReportKind.Full, items: [] };
        }
        const lexicon = getLexiconForDoc?.(params.textDocument.uri);
        const items = await computeDiagnostics(doc, getOrParse, lexicon);
        return { kind: DocumentDiagnosticReportKind.Full, items };
      } catch (error) {
        console.error(error);
        return { kind: DocumentDiagnosticReportKind.Full, items: [] };
      }
    }
  );

  // Workspace diagnostics (pull): 返回已缓存的诊断结果
  connection.onRequest(
    WorkspaceDiagnosticRequest.type,
    async (): Promise<WorkspaceDiagnosticReport> => {
      try {
        if (!diagnosticConfig.workspaceDiagnosticsEnabled) {
          return { items: [] };
        }

        // 仅返回已打开文档或已缓存的诊断结果，不触发完整工作区扫描
        // 完整工作区诊断由后台预热(warmup)异步完成
        const modules = getAllModules();
        const items: WorkspaceDocumentDiagnosticReport[] = [];

        for (const rec of modules) {
          // 只处理已打开的文档或已有缓存的文档
          const doc = documents.get(rec.uri);
          const cached = diagnosticCache.get(rec.uri);

          if (doc || cached) {
            try {
              let diagnostics: Diagnostic[];
              if (doc) {
                const docLexicon = getLexiconForDoc?.(rec.uri);
                diagnostics = await computeDiagnostics(doc, getOrParse, docLexicon);
              } else if (cached) {
                diagnostics = cached.diagnostics;
              } else {
                continue;
              }

              items.push({
                uri: rec.uri,
                version: doc?.version || null,
                kind: DocumentDiagnosticReportKind.Full,
                items: diagnostics,
              });
            } catch {
              // 忽略单个文档的错误
            }
          }
        }

        return { items };
      } catch {
        return { items: [] };
      }
    }
  );
}
