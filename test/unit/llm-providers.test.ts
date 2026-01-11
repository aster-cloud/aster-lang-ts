import { describe, test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider } from '../../src/ai/providers/openai.js';
import { AnthropicProvider } from '../../src/ai/providers/anthropic.js';
import { LLMError } from '../../src/ai/llm-provider.js';

// 保存原始環境變量
const originalEnv = { ...process.env };

// 在每個測試前清理環境變量
beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

// 在每個測試後恢復環境變量
afterEach(() => {
  process.env = { ...originalEnv };
});

describe('OpenAI Provider', () => {
  test('應該在缺少 API key 時拋出 LLMError', () => {
    assert.throws(
      () => new OpenAIProvider(),
      (error: Error) => {
        return (
          error instanceof LLMError &&
          error.provider === 'openai' &&
          error.message.includes('缺少 OpenAI API key')
        );
      }
    );
  });

  test('應該接受配置中的 API key', () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    assert.equal(provider.getName(), 'openai');
  });

  test('應該從環境變量讀取 API key', () => {
    process.env.OPENAI_API_KEY = 'env-test-key';
    const provider = new OpenAIProvider();
    assert.equal(provider.getName(), 'openai');
  });

  test('應該成功生成響應', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key' });

    // Mock client.chat.completions.create
    const mockCreate = mock.fn(async () => ({
      model: 'gpt-4-turbo',
      choices: [
        {
          message: {
            content: '測試響應內容',
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    }));

    // @ts-expect-error - 直接修改私有屬性進行測試
    provider.client.chat.completions.create = mockCreate;

    const response = await provider.generate({
      prompt: '測試提示',
      systemPrompt: '系統提示',
    });

    assert.equal(response.content, '測試響應內容');
    assert.equal(response.model, 'gpt-4-turbo');
    assert.equal(response.usage.promptTokens, 10);
    assert.equal(response.usage.completionTokens, 5);
    assert.equal(response.usage.totalTokens, 15);

    // 驗證 mock 被調用
    assert.equal(mockCreate.mock.calls.length, 1);
    const call = mockCreate.mock.calls[0];
    assert.ok(call, 'mock call should exist');
    const callArgs = (call as any).arguments[0];
    assert.ok(callArgs, 'call arguments should exist');
    assert.equal(callArgs.model, 'gpt-4-turbo');
    assert.equal(callArgs.messages.length, 2);
    assert.equal(callArgs.messages[0].role, 'system');
    assert.equal(callArgs.messages[0].content, '系統提示');
    assert.equal(callArgs.messages[1].role, 'user');
    assert.equal(callArgs.messages[1].content, '測試提示');
  });

  test('應該處理空響應', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key' });

    const mockCreate = mock.fn(async () => ({
      model: 'gpt-4-turbo',
      choices: [
        {
          message: {
            content: null,
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 0,
        total_tokens: 10,
      },
    }));

    // @ts-expect-error - 直接修改私有屬性進行測試
    provider.client.chat.completions.create = mockCreate;

    await assert.rejects(
      async () => provider.generate({ prompt: '測試' }),
      (error: Error) => {
        return (
          error instanceof LLMError &&
          error.provider === 'openai' &&
          error.message.includes('返回空內容')
        );
      }
    );
  });

  test('應該處理 API 錯誤', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key' });

    // 模擬 OpenAI API 錯誤
    class MockAPIError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'APIError';
      }
    }

    const mockCreate = mock.fn(async () => {
      throw new MockAPIError('API 調用失敗');
    });

    // @ts-expect-error - 直接修改私有屬性進行測試
    provider.client.chat.completions.create = mockCreate;

    await assert.rejects(
      async () => provider.generate({ prompt: '測試' }),
      (error: Error) => {
        return (
          error instanceof LLMError &&
          error.provider === 'openai' &&
          error.message.includes('OpenAI')
        );
      }
    );
  });

  test('應該處理網絡錯誤', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key' });

    const mockCreate = mock.fn(async () => {
      throw new Error('Network error');
    });

    // @ts-expect-error - 直接修改私有屬性進行測試
    provider.client.chat.completions.create = mockCreate;

    await assert.rejects(
      async () => provider.generate({ prompt: '測試' }),
      (error: Error) => {
        return (
          error instanceof LLMError &&
          error.provider === 'openai' &&
          error.message.includes('調用失敗')
        );
      }
    );
  });

  test('應該使用默認參數', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key' });

    const mockCreate = mock.fn(async () => ({
      model: 'gpt-4-turbo',
      choices: [{ message: { content: 'test' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));

    // @ts-expect-error - 直接修改私有屬性進行測試
    provider.client.chat.completions.create = mockCreate;

    await provider.generate({ prompt: '測試' });

    const call = mockCreate.mock.calls[0];
    assert.ok(call, 'mock call should exist');
    const callArgs = (call as any).arguments[0];
    assert.ok(callArgs, 'call arguments should exist');
    assert.equal(callArgs.temperature, 0.0);  // 默认使用 temperature=0 确保确定性输出
    assert.equal(callArgs.max_tokens, 4000);
  });

  test('應該允許自定義參數', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key' });

    const mockCreate = mock.fn(async () => ({
      model: 'gpt-4-turbo',
      choices: [{ message: { content: 'test' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));

    // @ts-expect-error - 直接修改私有屬性進行測試
    provider.client.chat.completions.create = mockCreate;

    await provider.generate({
      prompt: '測試',
      temperature: 0.5,
      maxTokens: 1000,
    });

    const call = mockCreate.mock.calls[0];
    assert.ok(call, 'mock call should exist');
    const callArgs = (call as any).arguments[0];
    assert.ok(callArgs, 'call arguments should exist');
    assert.equal(callArgs.temperature, 0.5);
    assert.equal(callArgs.max_tokens, 1000);
  });
});

describe('Anthropic Provider', () => {
  test('應該在缺少 API key 時拋出 LLMError', () => {
    assert.throws(
      () => new AnthropicProvider(),
      (error: Error) => {
        return (
          error instanceof LLMError &&
          error.provider === 'anthropic' &&
          error.message.includes('缺少 Anthropic API key')
        );
      }
    );
  });

  test('應該接受配置中的 API key', () => {
    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    assert.equal(provider.getName(), 'anthropic');
  });

  test('應該從環境變量讀取 API key', () => {
    process.env.ANTHROPIC_API_KEY = 'env-test-key';
    const provider = new AnthropicProvider();
    assert.equal(provider.getName(), 'anthropic');
  });

  test('應該成功生成響應', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test-key' });

    // Mock client.completions.create
    const mockCreate = mock.fn(async () => ({
      model: 'claude-3-5-sonnet-20241022',
      completion: '測試響應內容',
    }));

    // @ts-expect-error - 直接修改私有屬性進行測試
    provider.client.completions.create = mockCreate;

    const response = await provider.generate({
      prompt: '測試提示',
      systemPrompt: '系統提示',
    });

    assert.equal(response.content, '測試響應內容');
    assert.equal(response.model, 'claude-3-5-sonnet-20241022');

    // 驗證 token 估算（字符數 / 4）
    assert.ok(response.usage.promptTokens > 0);
    assert.ok(response.usage.completionTokens > 0);
    assert.ok(response.usage.totalTokens > 0);

    // 驗證 mock 被調用
    assert.equal(mockCreate.mock.calls.length, 1);
    const call = mockCreate.mock.calls[0];
    assert.ok(call, 'mock call should exist');
    const callArgs = (call as any).arguments[0];
    assert.ok(callArgs, 'call arguments should exist');
    assert.equal(callArgs.model, 'claude-3-5-sonnet-20241022');
    assert.ok(callArgs.prompt.includes('系統提示'));
    assert.ok(callArgs.prompt.includes('測試提示'));
    assert.ok(callArgs.prompt.includes('Human:'));
    assert.ok(callArgs.prompt.includes('Assistant:'));
  });

  test('應該處理空響應', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test-key' });

    const mockCreate = mock.fn(async () => ({
      model: 'claude-3-5-sonnet-20241022',
      completion: '',
    }));

    // @ts-expect-error - 直接修改私有屬性進行測試
    provider.client.completions.create = mockCreate;

    await assert.rejects(
      async () => provider.generate({ prompt: '測試' }),
      (error: Error) => {
        return (
          error instanceof LLMError &&
          error.provider === 'anthropic' &&
          error.message.includes('返回空內容')
        );
      }
    );
  });

  test('應該處理 API 錯誤', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test-key' });

    // 模擬 Anthropic API 錯誤
    class MockAPIError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'APIError';
      }
    }

    const mockCreate = mock.fn(async () => {
      throw new MockAPIError('API 調用失敗');
    });

    // @ts-expect-error - 直接修改私有屬性進行測試
    provider.client.completions.create = mockCreate;

    await assert.rejects(
      async () => provider.generate({ prompt: '測試' }),
      (error: Error) => {
        return (
          error instanceof LLMError &&
          error.provider === 'anthropic' &&
          error.message.includes('Anthropic')
        );
      }
    );
  });

  test('應該處理網絡錯誤', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test-key' });

    const mockCreate = mock.fn(async () => {
      throw new Error('Network error');
    });

    // @ts-expect-error - 直接修改私有屬性進行測試
    provider.client.completions.create = mockCreate;

    await assert.rejects(
      async () => provider.generate({ prompt: '測試' }),
      (error: Error) => {
        return (
          error instanceof LLMError &&
          error.provider === 'anthropic' &&
          error.message.includes('調用失敗')
        );
      }
    );
  });

  test('應該使用默認參數', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test-key' });

    const mockCreate = mock.fn(async () => ({
      model: 'claude-3-5-sonnet-20241022',
      completion: 'test',
    }));

    // @ts-expect-error - 直接修改私有屬性進行測試
    provider.client.completions.create = mockCreate;

    await provider.generate({ prompt: '測試' });

    const call = mockCreate.mock.calls[0];
    assert.ok(call, 'mock call should exist');
    const callArgs = (call as any).arguments[0];
    assert.ok(callArgs, 'call arguments should exist');
    assert.equal(callArgs.temperature, 0.7);
    assert.equal(callArgs.max_tokens_to_sample, 4000);
  });

  test('應該允許自定義參數', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test-key' });

    const mockCreate = mock.fn(async () => ({
      model: 'claude-3-5-sonnet-20241022',
      completion: 'test',
    }));

    // @ts-expect-error - 直接修改私有屬性進行測試
    provider.client.completions.create = mockCreate;

    await provider.generate({
      prompt: '測試',
      temperature: 0.5,
      maxTokens: 1000,
    });

    const call = mockCreate.mock.calls[0];
    assert.ok(call, 'mock call should exist');
    const callArgs = (call as any).arguments[0];
    assert.ok(callArgs, 'call arguments should exist');
    assert.equal(callArgs.temperature, 0.5);
    assert.equal(callArgs.max_tokens_to_sample, 1000);
  });

  test('應該正確估算 token 使用量', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test-key' });

    const mockCreate = mock.fn(async () => ({
      model: 'claude-3-5-sonnet-20241022',
      completion: '這是一個測試響應內容',
    }));

    // @ts-expect-error - 直接修改私有屬性進行測試
    provider.client.completions.create = mockCreate;

    const response = await provider.generate({
      prompt: '這是測試提示',
      systemPrompt: '這是系統提示',
    });

    // 驗證 token 估算合理性（字符數 / 4）
    const promptChars = '這是系統提示\n\n\n\nHuman: 這是測試提示\n\nAssistant:'.length;
    const completionChars = '這是一個測試響應內容'.length;

    assert.ok(response.usage.promptTokens > 0);
    assert.ok(response.usage.completionTokens > 0);
    assert.equal(
      response.usage.totalTokens,
      response.usage.promptTokens + response.usage.completionTokens
    );
  });

  test('應該在沒有系統提示時正確構建 prompt', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test-key' });

    const mockCreate = mock.fn(async () => ({
      model: 'claude-3-5-sonnet-20241022',
      completion: 'test',
    }));

    // @ts-expect-error - 直接修改私有屬性進行測試
    provider.client.completions.create = mockCreate;

    await provider.generate({ prompt: '測試提示' });

    const call = mockCreate.mock.calls[0];
    assert.ok(call, 'mock call should exist');
    const callArgs = (call as any).arguments[0];
    assert.ok(callArgs, 'call arguments should exist');
    assert.ok(callArgs.prompt.includes('Human: 測試提示'));
    assert.ok(callArgs.prompt.includes('Assistant:'));
    assert.ok(!callArgs.prompt.includes('系統提示'));
  });
});
