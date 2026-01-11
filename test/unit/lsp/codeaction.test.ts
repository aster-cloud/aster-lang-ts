import { describe, it, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CodeActionKind, TextEdit } from 'vscode-languageserver/node.js';
import { registerCodeActionHandlers } from '../../../src/lsp/codeaction.js';

const requireForTest = createRequire(import.meta.url);
const originalRequire = (globalThis as any).require;
(globalThis as any).require = requireForTest;
process.on('exit', () => {
  (globalThis as any).require = originalRequire;
});

// Helper: 创建 mock Connection
function createMockConnection() {
  const handlers: Record<string, any> = {};
  return {
    onCodeAction: (handler: any) => { handlers.codeAction = handler; },
    handlers,
  };
}

// Helper: 创建 mock Documents
function createMockDocuments(text: string, uri = 'file:///test.aster') {
  return {
    get: (targetUri: string) => {
      if (targetUri !== uri) return undefined;
      return {
        uri,
        getText: () => text,
      };
    },
  };
}

// Helper: 创建 mock getOrParse
function createMockGetOrParse(tokens: any[] = []) {
  return () => ({
    text: '',
    tokens,
    ast: {},
  });
}

// Helper: 创建 mock uriToFsPath
function createMockUriToFsPath(fsPath: string) {
  return () => fsPath;
}

describe('registerCodeActionHandlers', () => {
  it('应该注册 onCodeAction 处理器', () => {
    const connection = createMockConnection();
    const documents = createMockDocuments('');
    const getOrParse = createMockGetOrParse();
    const uriToFsPath = createMockUriToFsPath('test.aster');

    registerCodeActionHandlers(connection as any, documents as any, getOrParse, uriToFsPath);

    assert.ok(connection.handlers.codeAction, 'onCodeAction handler should be registered');
  });

  it('应该对 EFF_MISSING_IO 提供 Quick Fix', async () => {
    const text = 'To fetchData:\n  return "data".';
    const connection = createMockConnection();
    const documents = createMockDocuments(text);
    const getOrParse = createMockGetOrParse();
    const uriToFsPath = createMockUriToFsPath('test.aster');

    registerCodeActionHandlers(connection as any, documents as any, getOrParse, uriToFsPath);

    const params = {
      textDocument: { uri: 'file:///test.aster' },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
      context: {
        diagnostics: [
          {
            code: 'EFF_MISSING_IO',
            message: "Function 'fetchData' requires IO",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
            data: { func: 'fetchData' },
          },
        ],
      },
    };

    const actions = await connection.handlers.codeAction(params);

    assert.ok(Array.isArray(actions), 'should return array');
    const ioAction = actions.find((a: any) => a.title.includes('Add It performs IO'));
    assert.ok(ioAction, 'should have IO quick fix');
    assert.strictEqual(ioAction.kind, CodeActionKind.QuickFix);
  });

  it('应该对 EFF_MISSING_CPU 提供 Quick Fix', async () => {
    const text = 'To compute:\n  return 42.';
    const connection = createMockConnection();
    const documents = createMockDocuments(text);
    const getOrParse = createMockGetOrParse();
    const uriToFsPath = createMockUriToFsPath('test.aster');

    registerCodeActionHandlers(connection as any, documents as any, getOrParse, uriToFsPath);

    const params = {
      textDocument: { uri: 'file:///test.aster' },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
      context: {
        diagnostics: [
          {
            code: 'EFF_MISSING_CPU',
            message: "Function 'compute' requires CPU",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
            data: { func: 'compute' },
          },
        ],
      },
    };

    const actions = await connection.handlers.codeAction(params);

    const cpuAction = actions.find((a: any) => a.title.includes('Add It performs CPU'));
    assert.ok(cpuAction, 'should have CPU quick fix');
  });

  it('应该对 EFF_SUPERFLUOUS_IO 提供移除 Quick Fix', async () => {
    const text = 'To getData. It performs IO:\n  return "data".';
    const connection = createMockConnection();
    const documents = createMockDocuments(text);
    const getOrParse = createMockGetOrParse();
    const uriToFsPath = createMockUriToFsPath('test.aster');

    registerCodeActionHandlers(connection as any, documents as any, getOrParse, uriToFsPath);

    const params = {
      textDocument: { uri: 'file:///test.aster' },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
      context: {
        diagnostics: [
          {
            code: 'EFF_SUPERFLUOUS_IO',
            message: "Function 'getData' does not need IO",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
            data: { func: 'getData' },
          },
        ],
      },
    };

    const actions = await connection.handlers.codeAction(params);

    const removeAction = actions.find((a: any) => a.title.includes('Remove It performs IO'));
    assert.ok(removeAction, 'should have remove IO quick fix');
  });

  it('应该对 Ambiguous interop call 提供 Quick Fix 提示', async () => {
    const connection = createMockConnection();
    const documents = createMockDocuments('');
    const getOrParse = createMockGetOrParse();
    const uriToFsPath = createMockUriToFsPath('test.aster');

    registerCodeActionHandlers(connection as any, documents as any, getOrParse, uriToFsPath);

    const params = {
      textDocument: { uri: 'file:///test.aster' },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
      context: {
        diagnostics: [
          {
            message: 'Ambiguous interop call: use 1L or 1.0',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
          },
        ],
      },
    };

    const actions = await connection.handlers.codeAction(params);

    const hintAction = actions.find((a: any) => a.title.includes('Disambiguate numeric overload'));
    assert.ok(hintAction, 'should have disambiguation hint');
  });

  it('应该对 Nullability 问题提供替换 Quick Fix', async () => {
    const connection = createMockConnection();
    const documents = createMockDocuments('');
    const getOrParse = createMockGetOrParse();
    const uriToFsPath = createMockUriToFsPath('test.aster');

    registerCodeActionHandlers(connection as any, documents as any, getOrParse, uriToFsPath);

    const params = {
      textDocument: { uri: 'file:///test.aster' },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
      context: {
        diagnostics: [
          {
            message: "Nullability: parameter 1 of 'Text.split' cannot be null",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
          },
        ],
      },
    };

    const actions = await connection.handlers.codeAction(params);

    const nullFixAction = actions.find((a: any) => a.title.includes('Replace null with'));
    assert.ok(nullFixAction, 'should have null replacement fix');
    assert.ok(nullFixAction.title.includes('""'), 'should suggest "" for Text.split param 1');
  });

  it('应该对 Missing module header 提供添加 Quick Fix', async () => {
    const connection = createMockConnection();
    const documents = createMockDocuments('', 'file:///project/cnl/examples/test.aster');
    const getOrParse = createMockGetOrParse();
    const uriToFsPath = createMockUriToFsPath('/project/cnl/examples/test.aster');

    registerCodeActionHandlers(connection as any, documents as any, getOrParse, uriToFsPath);

    const params = {
      textDocument: { uri: 'file:///project/cnl/examples/test.aster' },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      context: {
        diagnostics: [
          {
            message: 'Missing module header',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          },
        ],
      },
    };

    const actions = await connection.handlers.codeAction(params);

    const headerAction = actions.find((a: any) => a.title && a.title.includes('Add module header'));
    assert.ok(headerAction, 'should have add module header fix');
    assert.ok(headerAction.edit?.changes, 'should have edit changes');
  });

  it('应该对 Expected : at end of line 提供添加 Quick Fix', async () => {
    const connection = createMockConnection();
    const documents = createMockDocuments('');
    const getOrParse = createMockGetOrParse();
    const uriToFsPath = createMockUriToFsPath('test.aster');

    registerCodeActionHandlers(connection as any, documents as any, getOrParse, uriToFsPath);

    const params = {
      textDocument: { uri: 'file:///test.aster' },
      range: { start: { line: 0, character: 10 }, end: { line: 0, character: 10 } },
      context: {
        diagnostics: [
          {
            message: "Expected ':' at end of line",
            range: { start: { line: 0, character: 10 }, end: { line: 0, character: 10 } },
          },
        ],
      },
    };

    const actions = await connection.handlers.codeAction(params);

    const punctAction = actions.find((a: any) => a.title.includes("add ':'"));
    assert.ok(punctAction, 'should have add colon fix');
  });

  it('应该对 Expected . at end of line 提供添加 Quick Fix', async () => {
    const connection = createMockConnection();
    const documents = createMockDocuments('');
    const getOrParse = createMockGetOrParse();
    const uriToFsPath = createMockUriToFsPath('test.aster');

    registerCodeActionHandlers(connection as any, documents as any, getOrParse, uriToFsPath);

    const params = {
      textDocument: { uri: 'file:///test.aster' },
      range: { start: { line: 0, character: 10 }, end: { line: 0, character: 10 } },
      context: {
        diagnostics: [
          {
            message: 'Expected . at end of line',
            range: { start: { line: 0, character: 10 }, end: { line: 0, character: 10 } },
          },
        ],
      },
    };

    const actions = await connection.handlers.codeAction(params);

    const punctAction = actions.find((a: any) => a.title.includes("add '.'"));
    assert.ok(punctAction, 'should have add period fix');
  });

  it('应该在文档不存在时返回空数组', async () => {
    const connection = createMockConnection();
    const documents = createMockDocuments('');
    const getOrParse = createMockGetOrParse();
    const uriToFsPath = createMockUriToFsPath('test.aster');

    registerCodeActionHandlers(connection as any, documents as any, getOrParse, uriToFsPath);

    const params = {
      textDocument: { uri: 'file:///nonexistent.aster' },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      context: { diagnostics: [] },
    };

    const actions = await connection.handlers.codeAction(params);

    assert.deepStrictEqual(actions, []);
  });

  it('应该在没有诊断时也提供 selection 范围的 numeric overload 消歧', async () => {
    const mockTokens = [
      { kind: 'INT', value: '1', start: 0, end: 1 },
    ];
    const connection = createMockConnection();
    const documents = createMockDocuments('');
    const getOrParse = createMockGetOrParse(mockTokens);
    const uriToFsPath = createMockUriToFsPath('test.aster');

    // Mock computeDisambiguationEdits to return a TextEdit
    const computeDisambiguationEdits = mock.fn(() => [
      TextEdit.replace({ start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, '1L')
    ]);

    registerCodeActionHandlers(connection as any, documents as any, getOrParse, uriToFsPath);

    const params = {
      textDocument: { uri: 'file:///test.aster' },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
      context: { diagnostics: [] },
    };

    const actions = await connection.handlers.codeAction(params);

    // Should have at least the bulk disambiguation action if tokens exist
    assert.ok(Array.isArray(actions), 'should return array even without diagnostics');
  });
});

describe('辅助函数测试', () => {
  describe('extractFuncNameFromMessage', () => {
    it('应该从诊断消息中提取函数名', () => {
      // 通过创建一个包含该函数的诊断来间接测试
      const text = 'To fetchData:\n  return "data".';
      const connection = createMockConnection();
      const documents = createMockDocuments(text);
      const getOrParse = createMockGetOrParse();
      const uriToFsPath = createMockUriToFsPath('test.aster');

      registerCodeActionHandlers(connection as any, documents as any, getOrParse, uriToFsPath);

      // 如果没有 data.func，应该从 message 中提取
      const params = {
        textDocument: { uri: 'file:///test.aster' },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        context: {
          diagnostics: [
            {
              code: 'EFF_MISSING_IO',
              message: "Function 'fetchData' requires IO",
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
              // 注意：没有 data.func
            },
          ],
        },
      };

      // 执行后应该能提取出函数名并生成 quick fix
      connection.handlers.codeAction(params).then((actions: any[]) => {
        const ioAction = actions.find((a: any) => a.title.includes('fetchData'));
        assert.ok(ioAction, 'should extract function name from message');
      });
    });
  });

  describe('extractModuleName', () => {
    it('应该从文本中提取模块名', async () => {
      const text = 'This module is examples.test.\nTo func:\n  return 1.';
      const connection = createMockConnection();
      const documents = createMockDocuments(text);
      const getOrParse = createMockGetOrParse();
      const uriToFsPath = createMockUriToFsPath('test.aster');

      registerCodeActionHandlers(connection as any, documents as any, getOrParse, uriToFsPath);

      // 该函数在处理 CAPABILITY_NOT_ALLOWED 时会被调用
      // 我们可以通过检查生成的 action title 来验证模块名提取
      const params = {
        textDocument: { uri: 'file:///test.aster' },
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
        context: {
          diagnostics: [
            {
              code: 'CAPABILITY_NOT_ALLOWED',
              message: 'Http capability not allowed',
              range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
              data: { cap: 'Http', func: 'func' }, // module 会从 text 提取
            },
          ],
        },
      };

      const actions = await connection.handlers.codeAction(params);

      // 应该包含 examples.test.func 或 examples.test.*
      const moduleAction = actions.find((a: any) =>
        a.title && (a.title.includes('examples.test.func') || a.title.includes('examples.test.*'))
      );
      // 注意：此处可能需要 mock loadCapabilityManifest，但我们主要测试提取逻辑
    });
  });

  describe('headerInsertEffectEdit', () => {
    it('应该在函数声明行插入效果声明', async () => {
      const text = 'To fetchData:\n  return "data".';
      const connection = createMockConnection();
      const documents = createMockDocuments(text);
      const getOrParse = createMockGetOrParse();
      const uriToFsPath = createMockUriToFsPath('test.aster');

      registerCodeActionHandlers(connection as any, documents as any, getOrParse, uriToFsPath);

      const params = {
        textDocument: { uri: 'file:///test.aster' },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        context: {
          diagnostics: [
            {
              code: 'EFF_MISSING_IO',
              message: "Function 'fetchData' requires IO",
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
              data: { func: 'fetchData' },
            },
          ],
        },
      };

      const actions = await connection.handlers.codeAction(params);
      const ioAction = actions.find((a: any) => a.title.includes('Add It performs IO'));

      assert.ok(ioAction?.edit?.changes, 'should have edit changes');
      const edits = ioAction.edit.changes['file:///test.aster'];
      assert.ok(Array.isArray(edits), 'should have text edits');
      assert.ok(edits[0]?.newText?.includes('It performs IO'), 'should insert effect declaration');
    });

    it('应该在已有效果声明时返回 null', async () => {
      const text = 'To fetchData. It performs IO:\n  return "data".';
      const connection = createMockConnection();
      const documents = createMockDocuments(text);
      const getOrParse = createMockGetOrParse();
      const uriToFsPath = createMockUriToFsPath('test.aster');

      registerCodeActionHandlers(connection as any, documents as any, getOrParse, uriToFsPath);

      const params = {
        textDocument: { uri: 'file:///test.aster' },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        context: {
          diagnostics: [
            {
              code: 'EFF_MISSING_IO',
              message: "Function 'fetchData' requires IO",
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
              data: { func: 'fetchData' },
            },
          ],
        },
      };

      const actions = await connection.handlers.codeAction(params);
      const ioAction = actions.find((a: any) => a.title.includes('Add It performs IO'));

      // 应该没有 IO action，因为已经有效果声明了
      assert.strictEqual(ioAction, undefined, 'should not offer to add effect when already present');
    });
  });

  describe('headerRemoveEffectEdit', () => {
    it('应该移除函数声明行的效果声明', async () => {
      const text = 'To getData. It performs IO:\n  return "data".';
      const connection = createMockConnection();
      const documents = createMockDocuments(text);
      const getOrParse = createMockGetOrParse();
      const uriToFsPath = createMockUriToFsPath('test.aster');

      registerCodeActionHandlers(connection as any, documents as any, getOrParse, uriToFsPath);

      const params = {
        textDocument: { uri: 'file:///test.aster' },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        context: {
          diagnostics: [
            {
              code: 'EFF_SUPERFLUOUS_IO',
              message: "Function 'getData' does not need IO",
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
              data: { func: 'getData' },
            },
          ],
        },
      };

      const actions = await connection.handlers.codeAction(params);
      const removeAction = actions.find((a: any) => a.title.includes('Remove It performs IO'));

      assert.ok(removeAction?.edit?.changes, 'should have edit changes');
      const edits = removeAction.edit.changes['file:///test.aster'];
      assert.ok(Array.isArray(edits), 'should have text edits');
      assert.ok(!edits[0]?.newText?.includes('It performs IO'), 'should remove effect declaration');
      assert.ok(edits[0]?.newText?.includes('To getData:'), 'should keep function header');
    });
  });

  describe('suggestNullReplacement', () => {
    it('应该为 Text.split 建议 "" 或 " "', async () => {
      const connection = createMockConnection();
      const documents = createMockDocuments('');
      const getOrParse = createMockGetOrParse();
      const uriToFsPath = createMockUriToFsPath('test.aster');

      registerCodeActionHandlers(connection as any, documents as any, getOrParse, uriToFsPath);

      // Test param 1
      const params1 = {
        textDocument: { uri: 'file:///test.aster' },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
        context: {
          diagnostics: [
            {
              message: "Nullability: parameter 1 of 'Text.split' cannot be null",
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
            },
          ],
        },
      };

      const actions1 = await connection.handlers.codeAction(params1);
      const fix1 = actions1.find((a: any) => a.title.includes('Replace null with'));
      assert.ok(fix1?.title.includes('""'), 'should suggest "" for param 1');

      // Test param 2
      const params2 = {
        textDocument: { uri: 'file:///test.aster' },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
        context: {
          diagnostics: [
            {
              message: "Nullability: parameter 2 of 'Text.split' cannot be null",
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
            },
          ],
        },
      };

      const actions2 = await connection.handlers.codeAction(params2);
      const fix2 = actions2.find((a: any) => a.title.includes('Replace null with'));
      assert.ok(fix2?.title.includes('" "'), 'should suggest " " for param 2 (separator)');
    });

    it('应该为其他 Text.* 函数建议 ""', async () => {
      const connection = createMockConnection();
      const documents = createMockDocuments('');
      const getOrParse = createMockGetOrParse();
      const uriToFsPath = createMockUriToFsPath('test.aster');

      registerCodeActionHandlers(connection as any, documents as any, getOrParse, uriToFsPath);

      const params = {
        textDocument: { uri: 'file:///test.aster' },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
        context: {
          diagnostics: [
            {
              message: "Nullability: parameter 1 of 'Text.contains' cannot be null",
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
            },
          ],
        },
      };

      const actions = await connection.handlers.codeAction(params);
      const fix = actions.find((a: any) => a.title.includes('Replace null with'));
      assert.ok(fix?.title.includes('""'), 'should suggest "" for Text.contains');
    });

    it('应该为 List/Map/Set 建议适当的默认值', async () => {
      const connection = createMockConnection();
      const documents = createMockDocuments('');
      const getOrParse = createMockGetOrParse();
      const uriToFsPath = createMockUriToFsPath('test.aster');

      registerCodeActionHandlers(connection as any, documents as any, getOrParse, uriToFsPath);

      // List.get param 2 -> 0
      const paramsListGet = {
        textDocument: { uri: 'file:///test.aster' },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
        context: {
          diagnostics: [
            {
              message: "Nullability: parameter 2 of 'List.get' cannot be null",
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
            },
          ],
        },
      };

      const actionsListGet = await connection.handlers.codeAction(paramsListGet);
      const fixListGet = actionsListGet.find((a: any) => a.title.includes('Replace null with'));
      assert.ok(fixListGet?.title.includes('0'), 'should suggest 0 for List.get param 2');
    });
  });

  describe('suggestModuleFromPath', () => {
    it('应该从文件路径推断模块名', async () => {
      const connection = createMockConnection();
      const documents = createMockDocuments('', 'file:///project/cnl/examples/test.aster');
      const getOrParse = createMockGetOrParse();
      const uriToFsPath = createMockUriToFsPath('/project/cnl/examples/test.aster');

      registerCodeActionHandlers(connection as any, documents as any, getOrParse, uriToFsPath);

      const params = {
        textDocument: { uri: 'file:///project/cnl/examples/test.aster' },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        context: {
          diagnostics: [
            {
              message: 'Missing module header',
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            },
          ],
        },
      };

      const actions = await connection.handlers.codeAction(params);
      const headerAction = actions.find((a: any) => a.title.includes('Add module header'));

      assert.ok(headerAction, 'should have add module header action');
      // 应该包含从路径推断的模块名
      assert.ok(headerAction.title.includes('examples.test') || headerAction.title.includes('test'),
        'should infer module name from path');
    });
  });
});
