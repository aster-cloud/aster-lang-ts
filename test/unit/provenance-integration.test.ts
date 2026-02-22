import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ProvenanceTracker, type ProvenanceMetadata } from '../../src/ai/provenance.js';
import { PolicyValidator } from '../../src/ai/validator.js';

/**
 * 集成測試：驗證帶 provenance 頭的 CNL 代碼能被 policy-converter 正確解析
 */
describe('Provenance Integration Tests', () => {
  test('帶 provenance 頭的簡單 CNL 代碼應該能通過驗證', async () => {
    const tracker = new ProvenanceTracker();
    const validator = new PolicyValidator();

    const cnlCode = `Module ai.generated.simple.

Rule add given x as Int, y as Int, produce Int:
  Return x plus y.
`;

    const metadata: ProvenanceMetadata = {
      model: 'gpt-4',
      provider: 'openai',
      prompt: 'Create a function that adds two integers',
      timestamp: new Date().toISOString(),
      validated: true,
    };

    const annotated = tracker.addProvenanceToCode(cnlCode, metadata);
    const result = await validator.validate(annotated);

    assert.equal(result.valid, true, 'Code with provenance should be valid');
    assert.equal(result.diagnostics.length, 0, 'Should have no diagnostics');
    assert.ok(result.coreIR, 'Should have Core IR');
  });

  test('帶 provenance 頭的複雜 CNL 代碼應該能通過驗證', async () => {
    const tracker = new ProvenanceTracker();
    const validator = new PolicyValidator();

    const cnlCode = `Module ai.generated.complex.

Rule greet given name as Text, produce Text:
  Return "Hello".

Rule double given n as Int, produce Int:
  Return n times 2.

Rule calculate given x as Int, y as Int, produce Int:
  Let sum be x plus y.
  Return sum times 2.
`;

    const metadata: ProvenanceMetadata = {
      model: 'claude-3-5-sonnet-20241022',
      provider: 'anthropic',
      prompt: 'Create functions for greeting and mathematical operations',
      timestamp: new Date().toISOString(),
      validated: false,
    };

    const annotated = tracker.addProvenanceToCode(cnlCode, metadata);
    const result = await validator.validate(annotated);

    assert.equal(result.valid, true, 'Complex code with provenance should be valid');
    assert.ok(result.coreIR, 'Should have Core IR');
  });

  test('帶 provenance 頭且包含長 prompt 的代碼應該能通過驗證', async () => {
    const tracker = new ProvenanceTracker();
    const validator = new PolicyValidator();

    const cnlCode = `Module ai.generated.longprompt.

Rule identity given x as Int, produce Int:
  Return x.
`;

    const longPrompt = 'a'.repeat(300); // 超過 200 字符的 prompt
    const metadata: ProvenanceMetadata = {
      model: 'gpt-4',
      provider: 'openai',
      prompt: longPrompt,
      timestamp: new Date().toISOString(),
      validated: true,
    };

    const annotated = tracker.addProvenanceToCode(cnlCode, metadata);
    const result = await validator.validate(annotated);

    assert.equal(result.valid, true, 'Code with long prompt should be valid');
    assert.ok(result.coreIR, 'Should have Core IR');
  });

  test('帶 provenance 頭且 prompt 包含換行符的代碼應該能通過驗證', async () => {
    const tracker = new ProvenanceTracker();
    const validator = new PolicyValidator();

    const cnlCode = `Module ai.generated.multiline.

Rule multiply given x as Int, y as Int, produce Int:
  Return x times y.
`;

    const metadata: ProvenanceMetadata = {
      model: 'gpt-4',
      provider: 'openai',
      prompt: 'Create a function that:\n1. Takes two integers\n2. Returns the product',
      timestamp: new Date().toISOString(),
      validated: true,
    };

    const annotated = tracker.addProvenanceToCode(cnlCode, metadata);
    const result = await validator.validate(annotated);

    assert.equal(result.valid, true, 'Code with multiline prompt should be valid');
    assert.ok(result.coreIR, 'Should have Core IR');
  });

  test('provenance 頭不應該影響編譯錯誤檢測', async () => {
    const tracker = new ProvenanceTracker();
    const validator = new PolicyValidator();

    // 這段代碼有類型錯誤：返回 Text 而非 Int
    const cnlCode = `Module ai.generated.invalid.

Rule bad, produce Int:
  Return "not an int".
`;

    const metadata: ProvenanceMetadata = {
      model: 'gpt-4',
      provider: 'openai',
      prompt: 'Create a buggy function',
      timestamp: new Date().toISOString(),
      validated: false,
    };

    const annotated = tracker.addProvenanceToCode(cnlCode, metadata);
    const result = await validator.validate(annotated);

    assert.equal(result.valid, false, 'Invalid code should fail validation');
    assert.ok(result.diagnostics.length > 0, 'Should have diagnostics');

    const errors = validator.getErrors(result.diagnostics);
    assert.ok(errors.length > 0, 'Should have errors');
  });

  test('能從驗證後的代碼中提取 provenance 並保持一致性', async () => {
    const tracker = new ProvenanceTracker();
    const validator = new PolicyValidator();

    const cnlCode = `Module ai.generated.extract.

Rule test, produce Int:
  Return 42.
`;

    const metadata: ProvenanceMetadata = {
      model: 'gpt-4',
      provider: 'openai',
      prompt: 'Test provenance extraction',
      timestamp: '2025-11-25T00:00:00.000Z',
      validated: true,
    };

    const annotated = tracker.addProvenanceToCode(cnlCode, metadata);

    // 先驗證代碼
    const validationResult = await validator.validate(annotated);
    assert.equal(validationResult.valid, true, 'Code should be valid');

    // 再提取 provenance
    const extracted = tracker.extractProvenance(annotated);

    assert.ok(extracted, 'Should extract provenance');
    assert.equal(extracted.model, metadata.model);
    assert.equal(extracted.provider, metadata.provider);
    assert.equal(extracted.prompt, metadata.prompt);
    assert.equal(extracted.timestamp, metadata.timestamp);
    assert.equal(extracted.validated, metadata.validated);
  });

  test('多個 provenance 頭（嵌套生成）應該只提取第一個', async () => {
    const tracker = new ProvenanceTracker();

    const cnlCode = `Module ai.test.

Rule test, produce Int:
  Return 1.
`;

    const metadata1: ProvenanceMetadata = {
      model: 'gpt-4',
      provider: 'openai',
      prompt: 'First generation',
      timestamp: '2025-11-25T00:00:00.000Z',
      validated: true,
    };

    const metadata2: ProvenanceMetadata = {
      model: 'claude-3',
      provider: 'anthropic',
      prompt: 'Second generation',
      timestamp: '2025-11-25T01:00:00.000Z',
      validated: false,
    };

    // 添加第一個 provenance 頭
    const annotated1 = tracker.addProvenanceToCode(cnlCode, metadata1);

    // 再添加第二個 provenance 頭（模擬代碼被重新生成的情況）
    const annotated2 = tracker.addProvenanceToCode(annotated1, metadata2);

    // 提取應該返回第一個（最外層）provenance
    const extracted = tracker.extractProvenance(annotated2);

    assert.ok(extracted);
    assert.equal(extracted.model, metadata2.model, 'Should extract first (outer) provenance');
    assert.equal(extracted.provider, metadata2.provider);
  });
});
