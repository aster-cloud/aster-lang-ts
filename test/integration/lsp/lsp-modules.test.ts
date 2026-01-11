#!/usr/bin/env node
/**
 * LSP 模块化测试
 * 验证新提取的 Formatting、CodeAction、Symbols、Tokens、Health 模块功能完整性
 */

import { registerFormattingHandlers } from '../../../src/lsp/formatting.js';
import { registerCodeActionHandlers } from '../../../src/lsp/codeaction.js';
import { registerSymbolsHandlers } from '../../../src/lsp/symbols.js';
import { registerTokensHandlers, SEM_LEGEND } from '../../../src/lsp/tokens.js';
import { registerHealthHandlers } from '../../../src/lsp/health.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import type { Module as AstModule } from '../../../src/types.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function createMockConnection() {
  const handlers: any = {};
  return {
    onRequest: (method: string, handler: any) => { handlers[method] = handler; },
    onDocumentFormatting: (handler: any) => { handlers.onDocumentFormatting = handler; },
    onDocumentRangeFormatting: (handler: any) => { handlers.onDocumentRangeFormatting = handler; },
    onCodeAction: (handler: any) => { handlers.onCodeAction = handler; },
    onWorkspaceSymbol: (handler: any) => { handlers.onWorkspaceSymbol = handler; },
    onDocumentLinks: (handler: any) => { handlers.onDocumentLinks = handler; },
    onDocumentHighlight: (handler: any) => { handlers.onDocumentHighlight = handler; },
    languages: {
      semanticTokens: {
        on: (handler: any) => { handlers.semanticTokens = handler; },
      },
    },
    handlers,
  };
}

function createMockDocuments() {
  const docs = new Map<string, TextDocument>();
  return {
    get: (uri: string) => docs.get(uri),
    set: (uri: string, doc: TextDocument) => docs.set(uri, doc),
  };
}

function createMockGetOrParse() {
  return (doc: TextDocument) => {
    const text = doc.getText();
    const can = canonicalize(text);
    const tokens = lex(can);
    let ast: AstModule | null = null;
    try {
      ast = parse(tokens) as AstModule;
    } catch {
      ast = null;
    }
    return { text: can, tokens, ast };
  };
}

async function testFormattingModule(): Promise<void> {
  const code = `This module is test_app.

To greet with name: Text, produce Text:
  Return "Hello " + name.`;

  const doc = TextDocument.create('file:///test.aster', 'aster', 1, code);
  const mockConnection = createMockConnection() as any;
  const mockDocuments = createMockDocuments();
  mockDocuments.set('file:///test.aster', doc);

  const getDocumentSettings = async () => ({ format: { mode: 'lossless', reflow: false } });

  registerFormattingHandlers(mockConnection, mockDocuments, getDocumentSettings);

  // Test full document formatting
  const formatResult = await mockConnection.handlers.onDocumentFormatting({
    textDocument: { uri: 'file:///test.aster' },
    options: { tabSize: 2, insertSpaces: true },
  });

  assert(Array.isArray(formatResult), 'Formatting 应返回 TextEdit 数组');
  console.log(`✓ Formatting 模块测试通过`);
}

async function testCodeActionModule(): Promise<void> {
  const code = `This module is test_app.

To greet with name: Text, produce Text:
  Return "Hello " + name.`;

  const doc = TextDocument.create('file:///test.aster', 'aster', 1, code);
  const mockConnection = createMockConnection() as any;
  const mockDocuments = createMockDocuments();
  mockDocuments.set('file:///test.aster', doc);
  const getOrParse = createMockGetOrParse();
  const uriToFsPath = (uri: string) => uri.replace('file://', '');

  registerCodeActionHandlers(mockConnection, mockDocuments, getOrParse, uriToFsPath);

  // Test with no diagnostics
  const actions = await mockConnection.handlers.onCodeAction({
    textDocument: { uri: 'file:///test.aster' },
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
    context: { diagnostics: [] },
  });

  assert(Array.isArray(actions), 'CodeAction 应返回数组');
  console.log(`✓ CodeAction 模块测试通过`);
}

async function testSymbolsModule(): Promise<void> {
  const mockConnection = createMockConnection() as any;
  const mockDocuments = createMockDocuments();

  const getAllModules = () => [
    {
      uri: 'file:///test.aster',
      moduleName: 'test_app',
      symbols: [
        { name: 'greet', kind: 'function', range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } } },
      ],
    },
  ];
  const ensureUri = (uri: string) => uri;
  const offsetToPos = (text: string, offset: number) => ({ line: 0, character: offset });

  registerSymbolsHandlers(mockConnection, mockDocuments, getAllModules, ensureUri, offsetToPos);

  // Test workspace symbol search
  const symbols = mockConnection.handlers.onWorkspaceSymbol({ query: 'greet' });

  assert(Array.isArray(symbols), 'WorkspaceSymbol 应返回数组');
  assert(symbols.length >= 1, `应找到至少 1 个符号（实际: ${symbols.length}）`);
  console.log(`✓ Symbols 模块测试通过（找到 ${symbols.length} 个符号）`);
}

async function testTokensModule(): Promise<void> {
  const code = `This module is test_app.

To greet with name: Text, produce Text:
  Return "Hello " + name.`;

  const doc = TextDocument.create('file:///test.aster', 'aster', 1, code);
  const mockConnection = createMockConnection() as any;
  const mockDocuments = createMockDocuments();
  mockDocuments.set('file:///test.aster', doc);
  const getOrParse = createMockGetOrParse();

  const typeText = (ty: any) => 'Text';
  const exprTypeText = (expr: any) => 'Text';
  const tokenNameAt = (tokens: any[], position: any) => 'greet';
  const collectLetsWithSpan = (block: any) => new Map();

  registerTokensHandlers(mockConnection, mockDocuments, getOrParse, typeText, exprTypeText, tokenNameAt, collectLetsWithSpan);

  // Test semantic tokens
  const semanticTokens = mockConnection.handlers.semanticTokens({
    textDocument: { uri: 'file:///test.aster' },
  });

  assert(semanticTokens && typeof semanticTokens === 'object', 'SemanticTokens 应返回对象');
  assert(Array.isArray(semanticTokens.data), 'SemanticTokens.data 应为数组');

  // Test SEM_LEGEND
  assert(SEM_LEGEND.tokenTypes.includes('function'), 'SEM_LEGEND 应包含 function 类型');
  assert(SEM_LEGEND.tokenModifiers.includes('declaration'), 'SEM_LEGEND 应包含 declaration 修饰符');

  console.log(`✓ Tokens 模块测试通过`);
}

async function testHealthModule(): Promise<void> {
  const mockConnection = createMockConnection() as any;
  const getAllModules = () => [
    { moduleName: 'test_app' },
    { moduleName: 'utils' },
    { moduleName: null },
  ];

  registerHealthHandlers(mockConnection, true, true, getAllModules);

  // Test health request
  const health = mockConnection.handlers['aster/health']();

  assert(health && typeof health === 'object', 'Health 应返回对象');
  assert(typeof health.watchers === 'object', 'Health 应包含 watchers');
  assert(typeof health.index === 'object', 'Health 应包含 index');
  assert(health.index.files === 3, `文件数应为 3（实际: ${health.index.files}）`);
  assert(health.index.modules === 2, `模块数应为 2（实际: ${health.index.modules}）`);

  console.log(`✓ Health 模块测试通过（${health.index.files} 文件，${health.index.modules} 模块）`);
}

async function testEdgeCases(): Promise<void> {
  const mockConnection = createMockConnection() as any;
  const mockDocuments = createMockDocuments();
  const getDocumentSettings = async () => ({});

  registerFormattingHandlers(mockConnection, mockDocuments, getDocumentSettings);

  // Test formatting with non-existent document
  const result = await mockConnection.handlers.onDocumentFormatting({
    textDocument: { uri: 'file:///nonexistent.aster' },
    options: { tabSize: 2, insertSpaces: true },
  });

  assert(Array.isArray(result) && result.length === 0, '不存在的文档应返回空数组');
  console.log('✓ 边界情况处理正常');
}

async function main(): Promise<void> {
  console.log('Running LSP modules tests...\n');

  try {
    await testFormattingModule();
    await testCodeActionModule();
    await testSymbolsModule();
    await testTokensModule();
    await testHealthModule();
    await testEdgeCases();

    console.log('\n✅ All LSP modules tests passed.');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();
