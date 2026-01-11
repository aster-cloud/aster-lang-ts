import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SymbolKind } from 'vscode-languageserver/node.js';
import { registerSymbolsHandlers, toGuideUri } from '../../../src/lsp/symbols.js';

const requireForTest = createRequire(import.meta.url);
const originalRequire = (globalThis as any).require;
(globalThis as any).require = requireForTest;
process.on('exit', () => {
  (globalThis as any).require = originalRequire;
});
const fs: typeof import('node:fs') = requireForTest('node:fs');

function createMockConnection() {
  const handlers: Record<string, any> = {};
  return {
    onWorkspaceSymbol: (handler: any) => { handlers.workspaceSymbol = handler; },
    onDocumentLinks: (handler: any) => { handlers.documentLinks = handler; },
    handlers,
  };
}

function createMockDocuments(getText: () => string, uri = 'file:///current.doc') {
  return {
    get: (targetUri: string) => {
      if (targetUri !== uri) return undefined;
      return {
        uri,
        getText,
      };
    },
  };
}

function offsetToPos(text: string, offset: number) {
  const upto = text.slice(0, offset);
  const lines = upto.split(/\n/);
  const line = lines.length - 1;
  const character = lines[lines.length - 1]?.length ?? 0;
  return { line, character };
}

describe('registerSymbolsHandlers', () => {
  it('应该注册 workspaceSymbol 和 documentLinks 处理器', () => {
    const connection = createMockConnection();
    const documents = createMockDocuments(() => '');
    const getAllModules = () => [] as any[];

    registerSymbolsHandlers(connection as any, documents as any, getAllModules, uri => uri, () => ({ line: 0, character: 0 }));

    assert.strictEqual(typeof connection.handlers.workspaceSymbol, 'function');
    assert.strictEqual(typeof connection.handlers.documentLinks, 'function');
  });

  it('应该过滤 workspaceSymbol 查询并处理 selectionRange 回退', () => {
    const connection = createMockConnection();
    const documents = createMockDocuments(() => '');
    const modules = [
      {
        uri: 'file:///module.aster',
        moduleName: 'demo',
        symbols: [
          {
            name: 'Hit',
            kind: 'function',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
            selectionRange: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } },
          },
          {
            name: 'Miss',
            kind: 'struct',
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
          },
        ],
      },
    ];
    const getAllModules = () => modules;

    registerSymbolsHandlers(
      connection as any,
      documents as any,
      getAllModules,
      uri => uri,
      (text, offset) => offsetToPos(text, offset),
    );

    const handler = connection.handlers.workspaceSymbol as (params: { query: string }) => any[];
    const allResults = handler({ query: '' });
    const filteredResults = handler({ query: 'hit' });

    assert.strictEqual(allResults.length, 2);
    assert.strictEqual(filteredResults.length, 1);
    assert.strictEqual(filteredResults[0]?.name, 'demo.Hit');
    assert.deepStrictEqual(filteredResults[0]?.location.range, { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } });

    const miss = allResults.find(item => item.name === 'demo.Miss');
    assert.ok(miss);
    assert.deepStrictEqual(miss.location.range, { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } });
    assert.strictEqual(miss.kind, SymbolKind.Struct);
  });

  it('应该生成文档链接并区分跨文件与自身 URI', () => {
    const connection = createMockConnection();
    let currentText = [
      'This module is other.mod.',
      '',
      'Text.print("示例")',
      'other.mod.helper 调用 self.mod.reuse',
    ].join('\n');
    const documents = createMockDocuments(() => currentText);
    const docUri = 'file:///current.doc';
    let modules = [
      { uri: docUri, moduleName: 'self.mod', symbols: [] },
      { uri: 'file:///other.aster', moduleName: 'other.mod', symbols: [] },
    ];
    const getAllModules = () => modules;
    const ensureUri = (uri: string) => uri;

    const existsMock = mock.method(fs, 'existsSync', (target: import('node:fs').PathLike) =>
      String(target).includes('interop-overloads.md'),
    );
    try {
      registerSymbolsHandlers(
        connection as any,
        documents as any,
        getAllModules,
        ensureUri,
        (text, offset) => offsetToPos(text, offset),
      );
      const handler = connection.handlers.documentLinks as (params: { textDocument: { uri: string } }) => any[];

      const links = handler({ textDocument: { uri: docUri } });

      const headerLink = links.find(link => link.range.start.line === 0);
      assert.ok(headerLink);
      assert.strictEqual(headerLink.target, 'file:///other.aster');

      const dottedLink = links.find(link => link.range.start.line === 3 && link.target === 'file:///other.aster');
      assert.ok(dottedLink);

      const textLink = links.find(link => link.target?.endsWith('interop-overloads.md'));
      assert.ok(textLink);
      assert.strictEqual(textLink.range.start.line, 2);

      currentText = 'This module is self.mod.';
      modules = [{ uri: docUri, moduleName: 'self.mod', symbols: [] }];
      const selfLinks = handler({ textDocument: { uri: docUri } });
      assert.strictEqual(selfLinks.length, 0);
    } finally {
      existsMock.mock.restore();
    }
  });
});

describe('toGuideUri', () => {
  it('应该为存在的相对路径生成 file URI', () => {
    const existsMock = mock.method(fs, 'existsSync', (target: import('node:fs').PathLike) =>
      String(target).endsWith('docs/guide/interop-overloads.md'),
    );
    try {
      const uri = toGuideUri('docs/guide/interop-overloads.md');
      assert.ok(uri);
      assert.ok(uri.startsWith('file://'));
    } finally {
      existsMock.mock.restore();
    }
  });

  it('应该在文件不存在时返回 null', () => {
    const existsMock = mock.method(fs, 'existsSync', () => false);
    try {
      const uri = toGuideUri('docs/guide/missing.md');
      assert.strictEqual(uri, null);
    } finally {
      existsMock.mock.restore();
    }
  });

  it('应该处理绝对路径输入', () => {
    const absPath = path.join(process.cwd(), 'docs/guide/examples.md');
    const existsMock = mock.method(fs, 'existsSync', (target: import('node:fs').PathLike) => String(target) === absPath);
    try {
      const uri = toGuideUri(absPath);
      assert.ok(uri);
      assert.ok(uri.startsWith('file://'));
    } finally {
      existsMock.mock.restore();
    }
  });
});
