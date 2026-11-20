/**
 * LLM provider 按需加载（aster-lang-ts#364）：SDK 是 optionalDependencies，`npm i --omit=optional` 下缺包时
 * 给出可操作的错误，其他加载错误原样抛出。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMissingPackage, loadOptional, OptionalDependencyMissingError } from '../../src/ai/providers/load.js';
import { LLMError } from '../../src/ai/llm-provider.js';

/** 与 Node 对缺失裸包报的错误同形。 */
function missing(pkg: string): Error {
  return Object.assign(new Error(`Cannot find package '${pkg}' imported from /x/dist/src/ai/providers/openai.js`), {
    code: 'ERR_MODULE_NOT_FOUND',
  });
}

test('缺少该可选包：改抛 OptionalDependencyMissingError（也是 LLMError），提示安装命令', async () => {
  await assert.rejects(
    loadOptional('openai', 'openai', () => Promise.reject(missing('openai'))),
    (e: unknown) => {
      assert.ok(e instanceof OptionalDependencyMissingError);
      assert.ok(e instanceof LLMError);
      assert.equal(e.provider, 'openai');
      assert.equal(e.packageName, 'openai');
      assert.match(e.message, /npm i openai/);
      assert.match(e.message, /--omit=optional/);
      return true;
    },
  );
  await assert.rejects(
    loadOptional('anthropic', '@anthropic-ai/sdk', () => Promise.reject(missing('@anthropic-ai/sdk'))),
    (e: unknown) => e instanceof OptionalDependencyMissingError && /npm i @anthropic-ai\/sdk/.test(e.message),
  );
});

test('其他错误原样抛出：别的包缺失、非 ERR_MODULE_NOT_FOUND', async () => {
  const other = missing('openai-helpers');
  await assert.rejects(loadOptional('openai', 'openai', () => Promise.reject(other)), (e: unknown) => e === other);
  const boom = new Error('boom');
  await assert.rejects(loadOptional('openai', 'openai', () => Promise.reject(boom)), (e: unknown) => e === boom);
  assert.equal(isMissingPackage(new Error("Cannot find package 'openai'"), 'openai'), false);
  assert.equal(isMissingPackage('x', 'openai'), false);
});

test('加载成功时返回模块', async () => {
  assert.deepEqual(await loadOptional('openai', 'openai', () => Promise.resolve({ ok: 1 })), { ok: 1 });
});
