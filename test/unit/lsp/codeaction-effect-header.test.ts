/**
 * 效果声明快修（aster-lang-ts#310）：
 * - LSP 诊断的 code 是码表值（E200 / E205 / E303 …），快修按码表值匹配（此前比较 'EFF_MISSING_IO' 这类枚举名，永远不触发）；
 * - 插入规范小写的 `It performs io`：core 词法把大写 IO 当类型名，小写写法两引擎都接受；
 * - 规则头已有 `It performs` 但缺 io 时同样给出修复（改写效果名，或给效应变量加上 io）。
 * 修复后的规则头必须能被 ts 解析器接受（core 接受同一写法由 aster-lang-test tier1 样本覆盖）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { registerCodeActionHandlers } from '../../../src/lsp/codeaction.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';

(globalThis as any).require ??= createRequire(import.meta.url);

const URI = 'file:///effects.aster';

async function quickFixes(text: string, code: string, func = 'f'): Promise<Array<{ title: string; newText: string }>> {
  const handlers: Record<string, any> = {};
  const connection = { onCodeAction: (h: any) => { handlers.codeAction = h; } };
  const documents = { get: (uri: string) => (uri === URI ? { uri, getText: () => text } : undefined) };
  registerCodeActionHandlers(connection as any, documents as any, () => ({ text, tokens: [], ast: {} }), () => 'effects.aster');
  const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
  const actions = await handlers.codeAction({
    textDocument: { uri: URI },
    range,
    context: { diagnostics: [{ code, message: `Function '${func}' …`, range, data: { func } }] },
  });
  return actions
    .filter((a: any) => a.edit?.changes?.[URI])
    .map((a: any) => ({ title: a.title, newText: a.edit.changes[URI][0].newText }));
}

function parsesCleanly(source: string): void {
  const errors = parse(lex(canonicalize(source))).diagnostics.filter((d) => d.severity === 'error');
  assert.deepEqual(errors.map((d) => d.message), [], source);
}

const body = '\n  Return Http.get("https://example.com").\n';

describe('效果声明快修（#310）', () => {
  it('按码表值 E200 / E205 / E303 触发，插入小写 io', async () => {
    for (const code of [ErrorCode.EFF_MISSING_IO, ErrorCode.EFF_INFER_MISSING_IO, ErrorCode.CAPABILITY_INFER_MISSING_IO]) {
      const fixes = await quickFixes('Module m.\n\nRule f given x as Int, produce Text:' + body, code);
      assert.deepEqual(fixes, [{
        title: "Add It performs io to 'f'",
        newText: 'Rule f given x as Int, produce Text. It performs io:',
      }], code);
    }
    parsesCleanly('Module m.\n\nRule f given x as Int, produce Text. It performs io:' + body);
  });

  it('缺 cpu 插入小写 cpu', async () => {
    const fixes = await quickFixes('Module m.\n\nRule f given x as Int, produce Int:\n  Return x.\n', ErrorCode.EFF_MISSING_CPU);
    assert.deepEqual(fixes.map((f) => f.newText), ['Rule f given x as Int, produce Int. It performs cpu:']);
  });

  it('已有未知效果名时改写成 io，能力列表保留', async () => {
    const plain = await quickFixes('Module m.\n\nRule f given x as Int, produce Text. It performs teleport:' + body, ErrorCode.EFF_MISSING_IO);
    assert.deepEqual(plain, [{
      title: "Replace It performs teleport with io in 'f'",
      newText: 'Rule f given x as Int, produce Text. It performs io:',
    }]);
    const withCaps = await quickFixes('Module m.\n\nRule f given x as Int, produce Text. It performs teleport [Http]:' + body, ErrorCode.CAPABILITY_INFER_MISSING_IO);
    assert.deepEqual(withCaps.map((f) => f.newText), ['Rule f given x as Int, produce Text. It performs io [Http]:']);
    parsesCleanly('Module m.\n\nRule f given x as Int, produce Text. It performs io [Http]:' + body);
  });

  it('已有 cpu 而缺 io 时改成 io（io 涵盖 cpu）', async () => {
    const fixes = await quickFixes('Module m.\n\nRule f given x as Int, produce Text. It performs cpu:' + body, ErrorCode.EFF_MISSING_IO);
    assert.deepEqual(fixes.map((f) => f.newText), ['Rule f given x as Int, produce Text. It performs io:']);
  });

  it('已有效应变量时加上 io', async () => {
    const source = 'Module m.\n\nRule f <E> given x as Int, produce Text. It performs E:' + body;
    const fixes = await quickFixes(source, ErrorCode.EFF_MISSING_IO);
    assert.deepEqual(fixes.map((f) => f.newText), ['Rule f <E> given x as Int, produce Text. It performs io with E:']);
    parsesCleanly('Module m.\n\nRule f <E> given x as Int, produce Text. It performs io with E:' + body);
  });

  it('已声明 io（任意大小写）时不提供；缺 cpu 而已有 io 时也不提供', async () => {
    assert.deepEqual(await quickFixes('Module m.\n\nRule f, produce Text. It performs IO:' + body, ErrorCode.EFF_MISSING_IO), []);
    assert.deepEqual(await quickFixes('Module m.\n\nRule f, produce Int. It performs io:\n  Return 1.\n', ErrorCode.EFF_MISSING_CPU), []);
  });

  it('同一函数的多条同义诊断只提供一次修复', async () => {
    const handlers: Record<string, any> = {};
    const text = 'Module m.\n\nRule f, produce Text:' + body;
    registerCodeActionHandlers({ onCodeAction: (h: any) => { handlers.codeAction = h; } } as any,
      { get: () => ({ uri: URI, getText: () => text }) } as any, () => ({ text, tokens: [], ast: {} }), () => 'x');
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
    const diagnostics = [ErrorCode.EFF_MISSING_IO, ErrorCode.EFF_INFER_MISSING_IO, ErrorCode.CAPABILITY_INFER_MISSING_IO]
      .map((code) => ({ code, message: '', range, data: { func: 'f' } }));
    const actions = await handlers.codeAction({ textDocument: { uri: URI }, range, context: { diagnostics } });
    assert.equal(actions.filter((a: any) => a.title.startsWith('Add It performs io')).length, 1);
  });

  it('移除多余的 It performs io（大小写不敏感）；带能力列表时不提供', async () => {
    const fixes = await quickFixes('Module m.\n\nRule f, produce Int. It performs IO:\n  Return 1.\n', ErrorCode.EFF_SUPERFLUOUS_IO);
    assert.deepEqual(fixes, [{ title: "Remove It performs io from 'f'", newText: 'Rule f, produce Int:' }]);
    assert.deepEqual(await quickFixes('Module m.\n\nRule f, produce Int. It performs io [Http]:\n  Return 1.\n', ErrorCode.EFF_SUPERFLUOUS_IO), []);
  });
});
