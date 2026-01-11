import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PromptManager } from '../../src/ai/prompt-manager.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 創建臨時測試目錄
const testDir = join(tmpdir(), `prompt-manager-test-${Date.now()}`);
const testPromptsDir = join(testDir, 'prompts');

// 測試數據
const testSystemPrompt = 'This is a test system prompt.\nLine 2.';
const testExamples = [
  {
    id: 'test-1',
    english_description: 'Test example 1',
    cnl_code: 'Test code 1',
    category: 'test',
    tags: ['tag1', 'tag2'],
  },
  {
    id: 'test-2',
    english_description: 'Test example 2',
    cnl_code: 'Test code 2',
    category: 'test',
    tags: ['tag3'],
  },
  {
    id: 'test-3',
    english_description: 'Test example 3',
    cnl_code: 'Test code 3',
    category: 'test',
    tags: [],
  },
];

beforeEach(async () => {
  // 清理並重新創建測試目錄
  await rm(testDir, { recursive: true, force: true });
  await mkdir(testPromptsDir, { recursive: true });

  // 創建測試文件
  await writeFile(join(testPromptsDir, 'system-prompt.txt'), testSystemPrompt);
  await writeFile(
    join(testPromptsDir, 'few-shot-examples.jsonl'),
    testExamples.map(ex => JSON.stringify(ex)).join('\n')
  );
});

describe('Prompt Manager', () => {
  test('應該正確讀取系統提示', async () => {
    const manager = new PromptManager(testPromptsDir);
    const prompt = await manager.getSystemPrompt();
    assert.equal(prompt, testSystemPrompt);
  });

  test('應該緩存系統提示（第二次調用不讀取文件）', async () => {
    const manager = new PromptManager(testPromptsDir);

    // 第一次調用
    const prompt1 = await manager.getSystemPrompt();
    assert.equal(prompt1, testSystemPrompt);

    // 修改文件
    await writeFile(join(testPromptsDir, 'system-prompt.txt'), 'Modified content');

    // 第二次調用應該返回緩存
    const prompt2 = await manager.getSystemPrompt();
    assert.equal(prompt2, testSystemPrompt);
    assert.notEqual(prompt2, 'Modified content');
  });

  test('應該正確解析 JSONL 格式的 few-shot 示例', async () => {
    const manager = new PromptManager(testPromptsDir);
    const examples = await manager.getFewShotExamples();

    assert.equal(examples.length, 3);
    assert.ok(examples[0], 'First example should exist');
    assert.equal(examples[0].id, 'test-1');
    assert.equal(examples[0].english_description, 'Test example 1');
    assert.equal(examples[0].cnl_code, 'Test code 1');
    assert.equal(examples[0].category, 'test');
    assert.deepEqual(examples[0].tags, ['tag1', 'tag2']);
  });

  test('應該支持限制 few-shot 示例數量', async () => {
    const manager = new PromptManager(testPromptsDir);

    const examples1 = await manager.getFewShotExamples(1);
    assert.equal(examples1.length, 1);
    assert.ok(examples1[0]);
    assert.equal(examples1[0].id, 'test-1');

    const examples2 = await manager.getFewShotExamples(2);
    assert.equal(examples2.length, 2);
    assert.ok(examples2[1]);
    assert.equal(examples2[1].id, 'test-2');
  });

  test('應該緩存 few-shot 示例', async () => {
    const manager = new PromptManager(testPromptsDir);

    // 第一次調用
    const examples1 = await manager.getFewShotExamples();
    assert.equal(examples1.length, 3);

    // 修改文件
    await writeFile(
      join(testPromptsDir, 'few-shot-examples.jsonl'),
      JSON.stringify({ id: 'new', english_description: 'New', cnl_code: 'New', category: 'new', tags: [] })
    );

    // 第二次調用應該返回緩存
    const examples2 = await manager.getFewShotExamples();
    assert.equal(examples2.length, 3);
    assert.ok(examples2[0]);
    assert.equal(examples2[0].id, 'test-1');
  });

  test('應該正確格式化 few-shot prompt', async () => {
    const manager = new PromptManager(testPromptsDir);
    const examples = await manager.getFewShotExamples(2);
    const formatted = manager.formatFewShotPrompt(examples);

    assert.ok(formatted.includes('Example: Test example 1'));
    assert.ok(formatted.includes('Test code 1'));
    assert.ok(formatted.includes('---'));
    assert.ok(formatted.includes('Example: Test example 2'));
    assert.ok(formatted.includes('Test code 2'));
  });

  test('clearCache() 應該清除所有緩存', async () => {
    const manager = new PromptManager(testPromptsDir);

    // 讀取並緩存
    await manager.getSystemPrompt();
    await manager.getFewShotExamples();

    // 修改文件
    const newPrompt = 'New system prompt';
    await writeFile(join(testPromptsDir, 'system-prompt.txt'), newPrompt);
    await writeFile(
      join(testPromptsDir, 'few-shot-examples.jsonl'),
      JSON.stringify({ id: 'new', english_description: 'New', cnl_code: 'New', category: 'new', tags: [] })
    );

    // 清除緩存
    manager.clearCache();

    // 重新讀取應該得到新內容
    const prompt = await manager.getSystemPrompt();
    assert.equal(prompt, newPrompt);

    const examples = await manager.getFewShotExamples();
    assert.equal(examples.length, 1);
    assert.ok(examples[0]);
    assert.equal(examples[0].id, 'new');
  });

  test('應該處理空行（忽略）', async () => {
    await writeFile(
      join(testPromptsDir, 'few-shot-examples.jsonl'),
      `${JSON.stringify(testExamples[0])}\n\n${JSON.stringify(testExamples[1])}\n   \n${JSON.stringify(testExamples[2])}`
    );

    const manager = new PromptManager(testPromptsDir);
    const examples = await manager.getFewShotExamples();

    assert.equal(examples.length, 3);
  });

  test('應該使用默認 prompts 目錄（process.cwd()/prompts）', () => {
    const manager = new PromptManager();
    // 無法直接測試私有屬性，但可以驗證不拋出錯誤
    assert.ok(manager);
  });
});
