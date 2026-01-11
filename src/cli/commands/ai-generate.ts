import ora from 'ora';
import fs from 'node:fs';
import { AIGenerator } from '../../ai/generator.js';
import type { GenerateRequest } from '../../ai/generator.js';
import { OpenAIProvider } from '../../ai/providers/openai.js';
import { AnthropicProvider } from '../../ai/providers/anthropic.js';
import type { LLMProvider } from '../../ai/llm-provider.js';
import { LLMError } from '../../ai/llm-provider.js';
import * as logger from '../utils/logger.js';

/**
 * AI Generate 命令選項
 */
export interface AIGenerateOptions {
  /**
   * LLM Provider（openai 或 anthropic）
   */
  provider?: 'openai' | 'anthropic';

  /**
   * 模型名稱
   */
  model?: string;

  /**
   * 輸出文件路徑（如果不指定則輸出到控制台）
   */
  output?: string;

  /**
   * 溫度參數（0.0 - 1.0）
   */
  temperature?: number;

  /**
   * Few-shot 示例數量
   */
  fewShotCount?: number;

  /**
   * 是否使用緩存
   */
  useCache?: boolean;
}

/**
 * 創建 LLM Provider 實例
 */
function createProvider(providerName: 'openai' | 'anthropic', model?: string): LLMProvider {
  if (providerName === 'openai') {
    const config: { model?: string } = {};
    if (model !== undefined) {
      config.model = model;
    }
    return new OpenAIProvider(config);
  } else {
    const config: { model?: string } = {};
    if (model !== undefined) {
      config.model = model;
    }
    return new AnthropicProvider(config);
  }
}

/**
 * AI Generate 命令實現
 *
 * 從英文描述生成 Aster CNL 代碼
 *
 * @param description - 英文描述（用戶需求）
 * @param options - 命令選項
 */
export async function aiGenerateCommand(
  description: string,
  options: AIGenerateOptions
): Promise<void> {
  // 1. 驗證輸入
  if (!description || description.trim().length === 0) {
    logger.error('請提供描述內容');
    process.exit(1);
  }

  const providerName = options.provider || 'openai';
  const spinner = ora(`準備使用 ${providerName} 生成代碼...`).start();

  try {
    // 2. 創建 LLM Provider
    let provider: LLMProvider;
    try {
      provider = createProvider(providerName, options.model);
      spinner.text = `使用 ${providerName} 生成代碼...`;
    } catch (error) {
      spinner.fail('創建 LLM Provider 失敗');
      if (error instanceof LLMError) {
        logger.error(error.message);
        if (providerName === 'openai') {
          logger.info('請設置環境變量: export OPENAI_API_KEY=your-api-key');
        } else {
          logger.info('請設置環境變量: export ANTHROPIC_API_KEY=your-api-key');
        }
      } else {
        logger.error(error instanceof Error ? error.message : String(error));
      }
      process.exit(1);
    }

    // 3. 調用 Generator
    const generator = new AIGenerator();
    const generateRequest: GenerateRequest = {
      description: description.trim(),
      provider,
    };
    if (options.fewShotCount !== undefined) {
      generateRequest.fewShotCount = options.fewShotCount;
    }
    if (options.temperature !== undefined) {
      generateRequest.temperature = options.temperature;
    }
    if (typeof options.useCache === 'boolean') {
      generateRequest.useCache = options.useCache;
    }
    const result = await generator.generate(generateRequest);

    spinner.succeed('代碼生成完成');
    logger.info(`⚡ 緩存狀態: ${result.fromCache ? '命中（跳過 LLM 調用）' : '未命中（已調用 LLM）'}`);

    // 4. 顯示驗證結果
    if (result.validation.valid) {
      logger.success('✓ 代碼驗證通過');
    } else {
      logger.warn('⚠ 代碼驗證失敗');
      const errors = result.validation.diagnostics.filter(d => d.severity === 'error');
      const warnings = result.validation.diagnostics.filter(d => d.severity === 'warning');

      if (errors.length > 0) {
        logger.error(`發現 ${errors.length} 個錯誤:`);
        errors.forEach((err, i) => {
          console.log(`  ${i + 1}. ${err.message}`);
        });
      }

      if (warnings.length > 0) {
        logger.warn(`發現 ${warnings.length} 個警告:`);
        warnings.forEach((warn, i) => {
          console.log(`  ${i + 1}. ${warn.message}`);
        });
      }
    }

    // 5. 輸出代碼
    if (options.output) {
      // 寫入文件
      fs.writeFileSync(options.output, result.code, 'utf8');
      logger.success(`代碼已保存到: ${options.output}`);
    } else {
      // 輸出到控制台
      console.log('\n--- 生成的代碼 ---\n');
      console.log(result.code);
      console.log('\n--- 代碼結束 ---\n');
    }

    // 6. 顯示 Token 使用統計
    console.log('\n📊 Token 使用統計:');
    console.log(`  模型: ${result.metadata.model}`);
    console.log(`  Prompt Tokens: ${result.usage.promptTokens}`);
    console.log(`  Completion Tokens: ${result.usage.completionTokens}`);
    console.log(`  Total Tokens: ${result.usage.totalTokens}`);

    // 7. 顯示元數據
    console.log('\n📝 生成元數據:');
    console.log(`  Provider: ${result.metadata.provider}`);
    console.log(`  時間戳: ${result.metadata.timestamp}`);
    console.log(`  驗證狀態: ${result.metadata.validated ? '通過' : '失敗'}`);
  } catch (error) {
    spinner.fail('生成失敗');
    if (error instanceof LLMError) {
      logger.error(`${error.provider} 錯誤: ${error.message}`);
      if (error.cause) {
        console.error('詳細錯誤:', error.cause);
      }
    } else {
      logger.error(error instanceof Error ? error.message : String(error));
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
    }
    process.exit(1);
  }
}
