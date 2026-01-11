import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMRequest, LLMResponse } from '../llm-provider.js';
import { LLMError } from '../llm-provider.js';

export interface AnthropicConfig {
  apiKey?: string;              // API key（默認從 ANTHROPIC_API_KEY 環境變量讀取）
  model?: string;               // 模型名稱（默認 claude-3-5-sonnet-20241022）
}

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(config: AnthropicConfig = {}) {
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new LLMError('缺少 Anthropic API key，請設置 ANTHROPIC_API_KEY 環境變量', 'anthropic');
    }

    this.client = new Anthropic({ apiKey });
    this.model = config.model || 'claude-3-5-sonnet-20241022';
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    try {
      // 構建符合 Anthropic 格式的 prompt
      let prompt = '';
      if (request.systemPrompt) {
        prompt += `${request.systemPrompt}\n\n`;
      }
      prompt += `\n\nHuman: ${request.prompt}\n\nAssistant:`;

      const response = await this.client.completions.create({
        model: this.model,
        max_tokens_to_sample: request.maxTokens ?? 4000,
        temperature: request.temperature ?? 0.7,
        prompt,
      });

      if (!response.completion) {
        throw new LLMError('Anthropic 返回空內容', 'anthropic');
      }

      return {
        content: response.completion,
        model: response.model,
        usage: {
          // Anthropic completions API 不返回 usage 統計，使用估算值
          promptTokens: Math.ceil(prompt.length / 4),
          completionTokens: Math.ceil(response.completion.length / 4),
          totalTokens: Math.ceil((prompt.length + response.completion.length) / 4),
        },
      };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new LLMError(
          `Anthropic API 錯誤: ${error.message}`,
          'anthropic',
          error
        );
      }
      throw new LLMError(
        `Anthropic 調用失敗: ${error instanceof Error ? error.message : String(error)}`,
        'anthropic',
        error instanceof Error ? error : undefined
      );
    }
  }

  getName(): string {
    return 'anthropic';
  }

  getModel(): string {
    return this.model;
  }
}
