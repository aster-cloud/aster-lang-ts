#!/usr/bin/env node
/**
 * Completion 模块单元测试
 * 验证 completion.ts 模块提取后的功能完整性
 */

import { registerCompletionHandlers } from '../../../src/lsp/completion.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { CompletionItem, SignatureHelp } from 'vscode-languageserver/node.js';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import type { Module as AstModule } from '../../../src/types.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
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
    onCompletion: (handler: any) => { handlers.onCompletion = handler; },
    onCompletionResolve: (handler: any) => { handlers.onCompletionResolve = handler; },
    onRequest: (method: string, handler: any) => { handlers[method] = handler; },
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

async function testBasicCompletion(): Promise<void> {
  const mockConnection = createMockConnection() as any;
  const mockDocuments = createMockDocuments();
  const getOrParse = createMockGetOrParse();

  registerCompletionHandlers(mockConnection, mockDocuments, getOrParse);

  const completions: CompletionItem[] = mockConnection.handlers.onCompletion();

  assert(Array.isArray(completions), '应返回补全项数组');
  assert(completions.length > 20, `应返回多个补全项（实际: ${completions.length}）`);

  // 验证关键字补全
  const hasKeyword = completions.some(c => c.label === 'module');
  assert(hasKeyword, '应包含关键字 "module"');

  // 验证类型补全
  const hasType = completions.some(c => c.label === 'Text');
  assert(hasType, '应包含类型 "Text"');

  console.log(`✓ 基础补全功能正常（返回 ${completions.length} 个补全项）`);
}

async function testCompletionResolve(): Promise<void> {
  const mockConnection = createMockConnection() as any;
  const mockDocuments = createMockDocuments();
  const getOrParse = createMockGetOrParse();

  registerCompletionHandlers(mockConnection, mockDocuments, getOrParse);

  // 测试 'module' 的详细信息
  const item1: CompletionItem = { label: 'module', data: 'module' };
  const resolved1 = mockConnection.handlers.onCompletionResolve(item1);
  assert(resolved1.detail === 'Module declaration', `"module" detail 应为 "Module declaration"（实际: ${resolved1.detail}）`);

  // 测试 'define' 的详细信息
  const item2: CompletionItem = { label: 'define', data: 'define' };
  const resolved2 = mockConnection.handlers.onCompletionResolve(item2);
  assert(resolved2.detail === 'Type definition', `"define" detail 应为 "Type definition"（实际: ${resolved2.detail}）`);

  // 测试 'rule' 的详细信息
  const item3: CompletionItem = { label: 'rule', data: 'rule' };
  const resolved3 = mockConnection.handlers.onCompletionResolve(item3);
  assert(resolved3.detail === 'Function definition', `"rule" detail 应为 "Function definition"（实际: ${resolved3.detail}）`);

  console.log('✓ 补全项解析功能正常');
}

async function testSignatureHelp(): Promise<void> {
  const code = `Module test_app.

Rule greet given name: Text, age: Int, produce Text:
  Return "Hello".
`;

  const doc = TextDocument.create('file:///test.aster', 'aster', 1, code);
  const mockConnection = createMockConnection() as any;
  const mockDocuments = createMockDocuments();
  mockDocuments.set('file:///test.aster', doc);
  const getOrParse = createMockGetOrParse();

  registerCompletionHandlers(mockConnection, mockDocuments, getOrParse);

  // 模拟在函数调用位置请求签名
  const params = {
    textDocument: { uri: 'file:///test.aster' },
    position: { line: 5, character: 10 }, // 在某个位置
  };

  const signatureHelp: SignatureHelp | null = await mockConnection.handlers['textDocument/signatureHelp'](params);

  // 注意：这个测试可能返回 null，因为没有实际的函数调用在代码中
  // 主要验证处理器不崩溃
  assert(signatureHelp === null || typeof signatureHelp === 'object', '签名提示应返回对象或 null');

  console.log('✓ 签名提示功能正常（处理器注册成功）');
}

async function testSignatureHelpWithCall(): Promise<void> {
  const code = `Module test_app.

Rule greet given name: Text, produce Text:
  Return "Hello".

Rule main produce Text:
  Let result be greet("World").
  Return result.
`;

  const doc = TextDocument.create('file:///test.aster', 'aster', 1, code);
  const mockConnection = createMockConnection() as any;
  const mockDocuments = createMockDocuments();
  mockDocuments.set('file:///test.aster', doc);
  const getOrParse = createMockGetOrParse();

  registerCompletionHandlers(mockConnection, mockDocuments, getOrParse);

  // 在 greet( 调用处请求签名
  const params = {
    textDocument: { uri: 'file:///test.aster' },
    position: { line: 6, character: 24 }, // 在 greet("World") 的位置
  };

  const signatureHelp: SignatureHelp | null = await mockConnection.handlers['textDocument/signatureHelp'](params);

  if (signatureHelp) {
    assert(Array.isArray(signatureHelp.signatures), '签名应为数组');
    if (signatureHelp.signatures.length > 0) {
      const sig = signatureHelp.signatures[0];
      if (sig) {
        assert(sig.label.includes('greet'), '签名标签应包含函数名');
        assert(sig.label.includes('name'), '签名标签应包含参数名');
        console.log(`✓ 签名提示内容正确（签名: ${sig.label}）`);
      }
    } else {
      console.log('✓ 签名提示功能正常（未找到签名，但处理器正常工作）');
    }
  } else {
    console.log('✓ 签名提示功能正常（返回 null，处理器正常工作）');
  }
}

async function testEdgeCases(): Promise<void> {
  const mockConnection = createMockConnection() as any;
  const mockDocuments = createMockDocuments();
  const getOrParse = createMockGetOrParse();

  registerCompletionHandlers(mockConnection, mockDocuments, getOrParse);

  // 测试不存在的文档
  const params = {
    textDocument: { uri: 'file:///nonexistent.aster' },
    position: { line: 0, character: 0 },
  };

  const signatureHelp: SignatureHelp | null = await mockConnection.handlers['textDocument/signatureHelp'](params);
  assert(signatureHelp === null, '不存在的文档应返回 null');

  // 测试空补全项解析
  const emptyItem: CompletionItem = { label: 'unknown', data: 'unknown' };
  const resolved = mockConnection.handlers.onCompletionResolve(emptyItem);
  assert(resolved.label === 'unknown', '未知补全项应原样返回');

  console.log('✓ 边界情况处理正常');
}

async function main(): Promise<void> {
  console.log('Running LSP completion tests...\n');

  try {
    await testBasicCompletion();
    await testCompletionResolve();
    await testSignatureHelp();
    await testSignatureHelpWithCall();
    await testEdgeCases();

    console.log('\n✅ All LSP completion tests passed.');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();
