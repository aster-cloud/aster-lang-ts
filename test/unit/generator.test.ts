import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { AIGenerator } from '../../src/ai/generator.js';
import type { LLMProvider } from '../../src/ai/llm-provider.js';
import type { FewShotExample } from '../../src/ai/prompt-manager.js';

describe('AI Generator', () => {
  test('應該成功生成代碼並完成完整流程', async () => {
    // Mock PromptManager
    const mockPromptManager = {
      getSystemPrompt: mock.fn(async () => 'System prompt for Aster CNL generation'),
      getFewShotExamples: mock.fn(async (count?: number) => {
        const examples: FewShotExample[] = [
          {
            id: 'ex1',
            english_description: 'Example 1',
            cnl_code: 'Code 1',
            category: 'test',
            tags: [],
          },
        ];
        return examples.slice(0, count ?? 5);
      }),
      formatFewShotPrompt: mock.fn((examples: FewShotExample[]) => {
        return examples.map(ex => `Example: ${ex.english_description}\n\n${ex.cnl_code}`).join('\n\n---\n\n');
      }),
      clearCache: () => {},
    };

    // Mock PolicyValidator
    const mockValidator = {
      validate: mock.fn(async (code: string) => ({
        valid: true,
        diagnostics: [],
        coreIR: { name: 'test.module', functions: [] } as any,
      })),
      isValid: async () => true,
      formatDiagnostics: () => '',
      getErrors: () => [],
      getWarnings: () => [],
    };

    // Mock ProvenanceTracker
    const mockProvenance = {
      generateHeader: mock.fn(() => '// Generated header'),
      addProvenanceToCode: mock.fn((code: string, metadata: any) => {
        return `// Generated header\n${code}`;
      }),
      extractProvenance: () => null,
    };

    // Mock LLMProvider
    const mockGenerate = mock.fn(async (request) => ({
      content: 'Module ai.generated.\n\nRule test, produce Int:\n  Return 42.',
      model: 'gpt-4',
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
    }));

    const mockProvider: LLMProvider = {
      generate: mockGenerate,
      getName: () => 'openai',
      getModel: () => 'gpt-4',
    };

    // Mock cache to ensure no cache hit, forcing full generation flow
    const mockCache = {
      get: mock.fn(async () => null),
      set: mock.fn(async () => {}),
    };

    const generator = new AIGenerator(
      mockPromptManager as any,
      mockValidator as any,
      mockProvenance as any,
      mockCache as any
    );

    const result = await generator.generate({
      description: 'Create a simple test function',
      provider: mockProvider,
    });

    // 驗證調用順序和參數
    assert.equal(mockPromptManager.getSystemPrompt.mock.calls.length, 1);
    assert.equal(mockPromptManager.getFewShotExamples.mock.calls.length, 1);
    const fewShotCall = mockPromptManager.getFewShotExamples.mock.calls[0];
    assert.ok(fewShotCall);
    assert.deepEqual(fewShotCall.arguments, [5]); // 默認值

    assert.equal(mockGenerate.mock.calls.length, 1);
    const generateCall = mockGenerate.mock.calls[0];
    assert.ok(generateCall);
    const llmRequest = generateCall.arguments[0];
    assert.ok(llmRequest.prompt.includes('Create a simple test function'));
    assert.equal(llmRequest.systemPrompt, 'System prompt for Aster CNL generation');

    assert.equal(mockValidator.validate.mock.calls.length, 1);
    const validateCall = mockValidator.validate.mock.calls[0];
    assert.ok(validateCall);
    assert.equal(validateCall.arguments[0], 'Module ai.generated.\n\nRule test, produce Int:\n  Return 42.');

    assert.equal(mockProvenance.addProvenanceToCode.mock.calls.length, 1);

    // 驗證返回結果
    assert.ok(result.code.includes('// Generated header'));
    assert.equal(result.rawCode, 'Module ai.generated.\n\nRule test, produce Int:\n  Return 42.');
    assert.equal(result.validation.valid, true);
    assert.equal(result.metadata.model, 'gpt-4');
    assert.equal(result.metadata.provider, 'openai');
    assert.equal(result.metadata.prompt, 'Create a simple test function');
    assert.equal(result.metadata.validated, true);
    assert.equal(result.usage.promptTokens, 100);
    assert.equal(result.usage.completionTokens, 50);
    assert.equal(result.usage.totalTokens, 150);
  });

  test('應該支持自定義 few-shot 數量', async () => {
    const mockPromptManager = {
      getSystemPrompt: async () => 'System prompt',
      getFewShotExamples: mock.fn(async (count?: number) => []),
      formatFewShotPrompt: () => '',
      clearCache: () => {},
    };

    const mockValidator = {
      validate: async () => ({ valid: true, diagnostics: [] }),
      isValid: async () => true,
      formatDiagnostics: () => '',
      getErrors: () => [],
      getWarnings: () => [],
    };

    const mockProvenance = {
      generateHeader: () => '',
      addProvenanceToCode: (code: string) => code,
      extractProvenance: () => null,
    };

    const mockProvider: LLMProvider = {
      generate: async () => ({
        content: 'Code',
        model: 'gpt-4',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }),
      getName: () => 'openai',
      getModel: () => 'gpt-4',
    };

    const mockCache = {
      get: mock.fn(async () => null),
      set: mock.fn(async () => {}),
    };

    const generator = new AIGenerator(
      mockPromptManager as any,
      mockValidator as any,
      mockProvenance as any,
      mockCache as any
    );

    await generator.generate({
      description: 'Test',
      provider: mockProvider,
      fewShotCount: 10,
    });

    assert.equal(mockPromptManager.getFewShotExamples.mock.calls.length, 1);
    const fewShotCall2 = mockPromptManager.getFewShotExamples.mock.calls[0];
    assert.ok(fewShotCall2);
    assert.deepEqual(fewShotCall2.arguments, [10]);
  });

  test('應該傳遞 temperature 和 maxTokens 參數', async () => {
    const mockPromptManager = {
      getSystemPrompt: async () => 'System prompt',
      getFewShotExamples: async () => [],
      formatFewShotPrompt: () => '',
      clearCache: () => {},
    };

    const mockValidator = {
      validate: async () => ({ valid: true, diagnostics: [] }),
      isValid: async () => true,
      formatDiagnostics: () => '',
      getErrors: () => [],
      getWarnings: () => [],
    };

    const mockProvenance = {
      generateHeader: () => '',
      addProvenanceToCode: (code: string) => code,
      extractProvenance: () => null,
    };

    const mockGenerate3 = mock.fn(async () => ({
      content: 'Code',
      model: 'gpt-4',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    }));

    const mockProvider: LLMProvider = {
      generate: mockGenerate3,
      getName: () => 'openai',
      getModel: () => 'gpt-4',
    };

    const mockCache = {
      get: mock.fn(async () => null),
      set: mock.fn(async () => {}),
    };

    const generator = new AIGenerator(
      mockPromptManager as any,
      mockValidator as any,
      mockProvenance as any,
      mockCache as any
    );

    await generator.generate({
      description: 'Test',
      provider: mockProvider,
      temperature: 0.5,
      maxTokens: 2000,
    });

    assert.equal(mockGenerate3.mock.calls.length, 1);
    const generateCall3 = mockGenerate3.mock.calls[0] as any;
    assert.ok(generateCall3);
    const llmRequest = generateCall3.arguments[0];
    assert.ok(llmRequest);
    assert.equal(llmRequest.temperature, 0.5);
    assert.equal(llmRequest.maxTokens, 2000);
  });

  test('應該在驗證失敗時將 validated 設為 false', async () => {
    const mockPromptManager = {
      getSystemPrompt: async () => 'System prompt',
      getFewShotExamples: async () => [],
      formatFewShotPrompt: () => '',
      clearCache: () => {},
    };

    const mockValidator = {
      validate: async () => ({
        valid: false,
        diagnostics: [{ severity: 'error' as const, code: 'E001' as any, message: 'Type error' }],
      }),
      isValid: async () => false,
      formatDiagnostics: () => '',
      getErrors: () => [],
      getWarnings: () => [],
    };

    const mockProvenance = {
      generateHeader: () => '',
      addProvenanceToCode: (code: string, metadata: any) => code,
      extractProvenance: () => null,
    };

    const mockProvider: LLMProvider = {
      generate: async () => ({
        content: 'Invalid code',
        model: 'gpt-4',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }),
      getName: () => 'openai',
      getModel: () => 'gpt-4',
    };

    const mockCache = {
      get: mock.fn(async () => null),
      set: mock.fn(async () => {}),
    };

    const generator = new AIGenerator(
      mockPromptManager as any,
      mockValidator as any,
      mockProvenance as any,
      mockCache as any
    );

    const result = await generator.generate({
      description: 'Test',
      provider: mockProvider,
    });

    assert.equal(result.validation.valid, false);
    assert.equal(result.metadata.validated, false);
    assert.ok(result.validation.diagnostics.length > 0);
  });

  test('應該正確修剪 LLM 返回的代碼（去除前後空格）', async () => {
    const mockPromptManager = {
      getSystemPrompt: async () => 'System prompt',
      getFewShotExamples: async () => [],
      formatFewShotPrompt: () => '',
      clearCache: () => {},
    };

    const mockValidator = {
      validate: mock.fn(async () => ({ valid: true, diagnostics: [] })),
      isValid: async () => true,
      formatDiagnostics: () => '',
      getErrors: () => [],
      getWarnings: () => [],
    };

    const mockProvenance = {
      generateHeader: () => '',
      addProvenanceToCode: (code: string) => code,
      extractProvenance: () => null,
    };

    const mockProvider: LLMProvider = {
      generate: async () => ({
        content: '\n\n  Code with whitespace  \n\n',
        model: 'gpt-4',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }),
      getName: () => 'openai',
      getModel: () => 'gpt-4',
    };

    const mockCache = {
      get: mock.fn(async () => null),
      set: mock.fn(async () => {}),
    };

    const generator = new AIGenerator(
      mockPromptManager as any,
      mockValidator as any,
      mockProvenance as any,
      mockCache as any
    );

    const result = await generator.generate({
      description: 'Test',
      provider: mockProvider,
    });

    assert.equal(result.rawCode, 'Code with whitespace');
    const validateCall4 = mockValidator.validate.mock.calls[0] as any;
    assert.ok(validateCall4);
    assert.equal(validateCall4.arguments[0], 'Code with whitespace');
  });

  test('應該在沒有依賴注入時使用默認實例', () => {
    const generator = new AIGenerator();
    assert.ok(generator, 'Generator should be created with default dependencies');
  });

  test('LLM 錯誤應該被傳播', async () => {
    const mockPromptManager = {
      getSystemPrompt: async () => 'System prompt',
      getFewShotExamples: async () => [],
      formatFewShotPrompt: () => '',
      clearCache: () => {},
    };

    const mockValidator = {
      validate: async () => ({ valid: true, diagnostics: [] }),
      isValid: async () => true,
      formatDiagnostics: () => '',
      getErrors: () => [],
      getWarnings: () => [],
    };

    const mockProvenance = {
      generateHeader: () => '',
      addProvenanceToCode: (code: string) => code,
      extractProvenance: () => null,
    };

    const mockProvider: LLMProvider = {
      generate: async () => {
        throw new Error('LLM API Error');
      },
      getName: () => 'openai',
      getModel: () => 'gpt-4',
    };

    const mockCache = {
      get: mock.fn(async () => null),
      set: mock.fn(async () => {}),
    };

    const generator = new AIGenerator(
      mockPromptManager as any,
      mockValidator as any,
      mockProvenance as any,
      mockCache as any
    );

    await assert.rejects(
      async () => {
        await generator.generate({
          description: 'Test',
          provider: mockProvider,
        });
      },
      {
        message: 'LLM API Error',
      }
    );
  });
});
