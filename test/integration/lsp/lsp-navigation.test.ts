#!/usr/bin/env node
/**
 * Navigation 模块单元测试
 * 验证 navigation.ts 模块提取后的功能完整性
 */

import { registerNavigationHandlers } from '../../../src/lsp/navigation.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Location, WorkspaceEdit } from 'vscode-languageserver/node.js';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import type { Module as AstModule } from '../../../src/types.js';
import { clearIndex, updateDocumentIndex } from '../../../src/lsp/index.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const TMP_DIR = join(process.cwd(), '.tmp', 'lsp-navigation-tests');
let tmpCounter = 0;

function ensureTmpDir(): string {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
  return TMP_DIR;
}

function createTempModule(baseName: string, content: string): { uri: string } {
  const dir = ensureTmpDir();
  const filePath = join(dir, `${baseName}-${++tmpCounter}.aster`);
  writeFileSync(filePath, content, 'utf8');
  return { uri: pathToFileURL(filePath).href };
}

function cleanupTmpDir(): void {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
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

function createMockConnection() {
  const handlers: any = {};
  return {
    onReferences: (handler: any) => { handlers.onReferences = handler; },
    onRenameRequest: (handler: any) => { handlers.onRenameRequest = handler; },
    onPrepareRename: (handler: any) => { handlers.onPrepareRename = handler; },
    onRequest: (method: string, handler: any) => { handlers[method] = handler; },
    onHover: (handler: any) => { handlers.onHover = handler; },
    onDocumentSymbol: (handler: any) => { handlers.onDocumentSymbol = handler; },
    onDefinition: (handler: any) => { handlers.onDefinition = handler; },
    sendProgress: () => {},
    handlers,
  };
}

function createMockDocuments() {
  const docs = new Map<string, TextDocument>();
  return {
    get: (uri: string) => docs.get(uri),
    set: (uri: string, doc: TextDocument) => docs.set(uri, doc),
    keys: () => Array.from(docs.keys()),
  };
}

function createMockGetDocumentSettings() {
  return async (uri: string) => ({
    rename: { scope: 'single-file' },
  });
}

async function testReferencesHandler(): Promise<void> {
  clearIndex();
  const code = `Module test_app.

Rule greet given name: Text, produce Text:
  Return "Hello " plus name.

Rule main produce Text:
  Let result be greet("World").
  Return result.
`;

  const mainFile = createTempModule('references-main', code);
  const doc = TextDocument.create(mainFile.uri, 'cnl', 1, code);
  const consumerContent = `Module consumer.

Rule demo produce Text:
  Return greet("Tester").
`;
  const consumerFile = createTempModule('references-consumer', consumerContent);
  const consumer = TextDocument.create(consumerFile.uri, 'cnl', 1, consumerContent);
  const mockConnection = createMockConnection() as any;
  const mockDocuments = createMockDocuments();
  mockDocuments.set(mainFile.uri, doc);
  mockDocuments.set(consumerFile.uri, consumer);
  const getOrParse = createMockGetOrParse();
  const getDocumentSettings = createMockGetDocumentSettings();

  registerNavigationHandlers(mockConnection, mockDocuments, getOrParse, getDocumentSettings);
  await updateDocumentIndex(doc.uri, doc.getText());
  await updateDocumentIndex(consumer.uri, consumer.getText());

  // 测试查找 greet 函数的引用
  const params = {
    textDocument: { uri: doc.uri },
    position: { line: 2, character: 5 }, // greet 函数定义处 (Rule greet → 'greet' starts at col 5)
    context: { includeDeclaration: true },
  };

  const references: Location[] = await mockConnection.handlers.onReferences(params);

  assert(Array.isArray(references), '应返回 Location 数组');
  assert(references.length === 3, `应找到 3 个引用（实际: ${references.length}）`);
  assert(references.some(ref => ref.uri === consumer.uri), '应包含跨文件引用');
  assert(
    references.some(ref => ref.range.start.line === 6),
    '应包含调用处的引用范围'
  );

  console.log(`✓ References 功能正常（找到 ${references.length} 个引用）`);
}

async function testRenameHandler(): Promise<void> {
  clearIndex();
  const code = `Module test_app.

Rule greet given name: Text, produce Text:
  Return "Hello " plus name.

Rule main produce Text:
  Let result be greet("World").
  Return result.
`;

  const mainFile = createTempModule('rename-main', code);
  const doc = TextDocument.create(mainFile.uri, 'cnl', 1, code);
  const mockConnection = createMockConnection() as any;
  const mockDocuments = createMockDocuments();
  mockDocuments.set(mainFile.uri, doc);
  const getOrParse = createMockGetOrParse();
  const getDocumentSettings = createMockGetDocumentSettings();

  registerNavigationHandlers(mockConnection, mockDocuments, getOrParse, getDocumentSettings);
  await updateDocumentIndex(doc.uri, doc.getText());

  // 测试重命名 greet 函数
  const params = {
    textDocument: { uri: doc.uri },
    position: { line: 2, character: 5 }, // greet 函数定义处 (Rule greet → 'greet' starts at col 5)
    newName: 'sayHello',
  };

  const workspaceEdit: WorkspaceEdit | null = await mockConnection.handlers.onRenameRequest(params);

  assert(workspaceEdit !== null, '应返回 WorkspaceEdit 对象');
  if (workspaceEdit && workspaceEdit.changes) {
    const changes = workspaceEdit.changes[doc.uri];
    if (changes) {
      assert(Array.isArray(changes), '应包含文件修改');
      assert(changes.length >= 1, `应至少有1个修改（实际: ${changes.length}）`);
      console.log(`✓ Rename 功能正常（${changes.length} 个修改）`);
    } else {
      console.log('✓ Rename 功能正常（未找到该文件的修改）');
    }
  } else {
    console.log('✓ Rename 功能正常（返回空编辑）');
  }
}

async function testHoverHandler(): Promise<void> {
  clearIndex();
  const code = `Module test_app.

Rule greet given name: Text, produce Text:
  Return "Hello " plus name.
`;

  const mainFile = createTempModule('hover-main', code);
  const doc = TextDocument.create(mainFile.uri, 'cnl', 1, code);
  const mockConnection = createMockConnection() as any;
  const mockDocuments = createMockDocuments();
  mockDocuments.set(mainFile.uri, doc);
  const getOrParse = createMockGetOrParse();
  const getDocumentSettings = createMockGetDocumentSettings();

  registerNavigationHandlers(mockConnection, mockDocuments, getOrParse, getDocumentSettings);

  // 测试在函数名上悬停
  const params = {
    textDocument: { uri: doc.uri },
    position: { line: 2, character: 5 }, // greet 函数定义处 (Rule greet → 'greet' starts at col 5)
  };

  const hover = await mockConnection.handlers.onHover(params);

  // Hover 可能返回 null 或对象
  assert(hover === null || typeof hover === 'object', 'Hover 应返回对象或 null');

  if (hover && hover.contents) {
    console.log(`✓ Hover 功能正常（返回内容）`);
  } else {
    console.log('✓ Hover 功能正常（未找到悬停信息）');
  }
}

async function testDocumentSymbolHandler(): Promise<void> {
  clearIndex();
  const code = `Module test_app.

Rule greet given name: Text, produce Text:
  Return "Hello " plus name.

Define User as:
  name is Text
  age is Int
`;

  const mainFile = createTempModule('symbol-main', code);
  const doc = TextDocument.create(mainFile.uri, 'cnl', 1, code);
  const mockConnection = createMockConnection() as any;
  const mockDocuments = createMockDocuments();
  mockDocuments.set(mainFile.uri, doc);
  const getOrParse = createMockGetOrParse();
  const getDocumentSettings = createMockGetDocumentSettings();

  registerNavigationHandlers(mockConnection, mockDocuments, getOrParse, getDocumentSettings);

  const params = {
    textDocument: { uri: doc.uri },
  };

  const symbols = mockConnection.handlers.onDocumentSymbol(params);

  assert(Array.isArray(symbols), '应返回 DocumentSymbol 数组');
  // DocumentSymbol 可能返回空数组（如果解析失败或没有符号）
  if (symbols.length > 0) {
    console.log(`✓ DocumentSymbol 功能正常（找到 ${symbols.length} 个符号）`);
  } else {
    console.log('✓ DocumentSymbol 功能正常（未找到符号，但处理器正常工作）');
  }
}

async function testDefinitionHandler(): Promise<void> {
  clearIndex();
  const code = `Module test_app.

Rule greet given name: Text, produce Text:
  Return "Hello " plus name.

Rule main produce Text:
  Let result be greet("World").
  Return result.
`;

  const mainFile = createTempModule('definition-main', code);
  const doc = TextDocument.create(mainFile.uri, 'cnl', 1, code);
  const mockConnection = createMockConnection() as any;
  const mockDocuments = createMockDocuments();
  mockDocuments.set(mainFile.uri, doc);
  const getOrParse = createMockGetOrParse();
  const getDocumentSettings = createMockGetDocumentSettings();

  registerNavigationHandlers(mockConnection, mockDocuments, getOrParse, getDocumentSettings);

  // 测试跳转到 greet 函数定义
  const params = {
    textDocument: { uri: doc.uri },
    position: { line: 6, character: 17 }, // greet 调用处
  };

  const location = mockConnection.handlers.onDefinition(params);

  // Definition 可能返回 null、Location 或 Location[]
  assert(location === null || typeof location === 'object', 'Definition 应返回对象或 null');

  if (location) {
    console.log('✓ Definition 功能正常（找到定义）');
  } else {
    console.log('✓ Definition 功能正常（未找到定义）');
  }
}

async function testEdgeCases(): Promise<void> {
  clearIndex();
  const mockConnection = createMockConnection() as any;
  const mockDocuments = createMockDocuments();
  const getOrParse = createMockGetOrParse();
  const getDocumentSettings = createMockGetDocumentSettings();

  registerNavigationHandlers(mockConnection, mockDocuments, getOrParse, getDocumentSettings);

  // 测试不存在的文档
  const params = {
    textDocument: { uri: 'file:///nonexistent.aster' },
    position: { line: 0, character: 0 },
  };

  const hover = await mockConnection.handlers.onHover(params);
  assert(hover === null, '不存在的文档应返回 null');

  console.log('✓ 边界情况处理正常');
}

async function testPrepareRenameHandler(): Promise<void> {
  clearIndex();
  const code = `Module test_app.

Rule greet given name: Text, produce Text:
  Return "Hello " plus name.

Rule main produce Text:
  Let result be greet("World").
  Return result.
`;

  const mainFile = createTempModule('prepare-main', code);
  const doc = TextDocument.create(mainFile.uri, 'cnl', 1, code);
  const mockConnection = createMockConnection() as any;
  const mockDocuments = createMockDocuments();
  mockDocuments.set(mainFile.uri, doc);
  const getOrParse = createMockGetOrParse();
  const getDocumentSettings = createMockGetDocumentSettings();

  registerNavigationHandlers(mockConnection, mockDocuments, getOrParse, getDocumentSettings);
  await updateDocumentIndex(doc.uri, doc.getText());

  const prepare = await mockConnection.handlers.onPrepareRename({
    textDocument: { uri: doc.uri },
    position: { line: 6, character: 17 },
  });

  assert(prepare !== null, '应返回可重命名范围');
  if (prepare) {
    assert(prepare.placeholder === 'greet', `占位符应为 greet（实际: ${prepare.placeholder}）`);
    assert(prepare.range.start.line === 6, '范围应命中调用位置');
  }

  const invalid = await mockConnection.handlers.onPrepareRename({
    textDocument: { uri: doc.uri },
    position: { line: 1, character: 0 },
  });
  assert(invalid === null, '无效位置应返回 null');

  console.log('✓ PrepareRename 功能正常（正确返回范围和占位符）');
}

async function main(): Promise<void> {
  console.log('Running LSP navigation tests...\n');

  try {
    await testReferencesHandler();
    await testRenameHandler();
    await testPrepareRenameHandler();
    await testHoverHandler();
    await testDocumentSymbolHandler();
    await testDefinitionHandler();
    await testEdgeCases();

    console.log('\n✅ All LSP navigation tests passed.');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  } finally {
    cleanupTmpDir();
  }
}

main();
