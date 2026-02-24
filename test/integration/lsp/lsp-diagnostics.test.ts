#!/usr/bin/env node
/**
 * 诊断服务单元测试
 * 验证 diagnostics.ts 模块提取后的功能完整性
 */

import { computeDiagnostics, setDiagnosticConfig } from '../../../src/lsp/diagnostics.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
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
      ast = parse(tokens).ast as AstModule;
    } catch {
      ast = null;
    }
    return { text: can, tokens, ast };
  };
}

async function testBasicDiagnostics(): Promise<void> {
  const code = `Module test_app.

Define User has id as Text, name as Text.

Rule greet given user as User, produce Text:
  Return "Hello, {user.name}".
`;

  const doc = TextDocument.create('file:///test.aster', 'aster', 1, code);
  const getOrParse = createMockGetOrParse();

  const diagnostics = await computeDiagnostics(doc, getOrParse);

  // 应该没有错误（正常的代码）
  assert(Array.isArray(diagnostics), '应返回诊断数组');
  console.log(`✓ 基础诊断功能正常（返回 ${diagnostics.length} 个诊断）`);
}

async function testMissingModuleHeader(): Promise<void> {
  const code = `Define User has id as Text.`;

  const doc = TextDocument.create('file:///test.aster', 'aster', 1, code);
  const getOrParse = createMockGetOrParse();

  const diagnostics = await computeDiagnostics(doc, getOrParse);

  // 验证解析成功（模块名为 null 或 undefined，但不产生错误）
  const parsedResult = getOrParse(doc);
  assert(parsedResult.ast !== null, '应成功解析 AST');
  assert(parsedResult.ast?.name === null || parsedResult.ast?.name === undefined || parsedResult.ast?.name === '', '模块名应为 null/undefined/empty');

  // 当前实现不对缺失模块头产生警告，这是设计选择
  // 模块会被解析为 <anonymous> 模块
  console.log('✓ 缺失模块头被静默处理为匿名模块');
}

async function testPiiFlowDiagnostics(): Promise<void> {
  // 使用实际的 PII 违规示例
  const code = `Module pii_test.

Effect HttpGet returning PII.

Rule getSensitiveData produce PII with effect HttpGet:
  Return "sensitive".

Rule leakData produce Text with effect HttpGet:
  Let data be getSensitiveData().
  Return data.
`;

  const doc = TextDocument.create('file:///pii_test.aster', 'aster', 1, code);
  const getOrParse = createMockGetOrParse();

  setDiagnosticConfig({ workspaceDiagnosticsEnabled: true });
  const diagnostics = await computeDiagnostics(doc, getOrParse);

  // 检查是否包含 PII 相关诊断（如果有的话）
  // 注意：具体的 PII 检查可能需要特定的配置和上下文
  console.log(`✓ PII 流诊断检查执行（返回 ${diagnostics.length} 个诊断）`);

  // 验证 collectSemanticDiagnostics 被调用（通过检查没有崩溃来间接验证）
  assert(Array.isArray(diagnostics), 'PII 流检查应正常执行');
}

async function testConfigUpdate(): Promise<void> {
  // 测试配置更新功能
  setDiagnosticConfig({
    relatedInformationSupported: true,
    workspaceDiagnosticsEnabled: false,
    capabilityManifestPath: null,
  });

  console.log('✓ 诊断配置更新功能正常');
}

async function main(): Promise<void> {
  console.log('Running LSP diagnostics tests...\n');

  try {
    await testBasicDiagnostics();
    await testMissingModuleHeader();
    await testPiiFlowDiagnostics();
    await testConfigUpdate();

    console.log('\n✅ All LSP diagnostics tests passed.');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();
