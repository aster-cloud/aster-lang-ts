import OpenAI from 'openai';
import type { LLMProvider, LLMRequest, LLMResponse } from '../llm-provider.js';
import { LLMError } from '../llm-provider.js';

export interface OpenAIConfig {
  apiKey?: string;              // API key（默認從 OPENAI_API_KEY 環境變量讀取）
  model?: string;               // 模型名稱（默認 gpt-4-turbo）
  organization?: string;        // 組織 ID（可選）
}

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(config: OpenAIConfig = {}) {
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new LLMError('缺少 OpenAI API key，請設置 OPENAI_API_KEY 環境變量', 'openai');
    }

    this.client = new OpenAI({
      apiKey,
      organization: config.organization,
    });
    this.model = config.model || 'gpt-4-turbo';
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    try {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
      if (request.systemPrompt) {
        messages.push({ role: 'system', content: request.systemPrompt });
      }
      messages.push({ role: 'user', content: request.prompt });

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: request.temperature ?? 0.0,  // 使用 temperature=0 确保确定性输出
        max_tokens: request.maxTokens ?? 4000,
      });

      const choice = response.choices[0];
      if (!choice?.message?.content) {
        throw new LLMError('OpenAI 返回空內容', 'openai');
      }

      return {
        content: choice.message.content,
        model: response.model,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
      };
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        throw new LLMError(
          `OpenAI API 錯誤: ${error.message}`,
          'openai',
          error
        );
      }
      throw new LLMError(
        `OpenAI 調用失敗: ${error instanceof Error ? error.message : String(error)}`,
        'openai',
        error instanceof Error ? error : undefined
      );
    }
  }

  getName(): string {
    return 'openai';
  }

  getModel(): string {
    return this.model;
  }
}
