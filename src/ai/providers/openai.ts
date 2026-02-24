import type { LLMProvider, LLMRequest, LLMResponse } from '../llm-provider.js';
import { LLMError } from '../llm-provider.js';

export interface OpenAIConfig {
  apiKey?: string;
  model?: string;
  organization?: string;
}

export class OpenAIProvider implements LLMProvider {
  private client: any;
  private model: string;
  private OpenAI: any;

  constructor(config: OpenAIConfig = {}) {
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new LLMError('缺少 OpenAI API key，请设置 OPENAI_API_KEY 环境变量', 'openai');
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.OpenAI = require('openai').default;
    } catch {
      throw new LLMError(
        '缺少 openai 包，请运行: npm install openai',
        'openai'
      );
    }

    this.client = new this.OpenAI({
      apiKey,
      organization: config.organization,
    });
    this.model = config.model || 'gpt-4-turbo';
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    try {
      const messages: Array<{ role: string; content: string }> = [];
      if (request.systemPrompt) {
        messages.push({ role: 'system', content: request.systemPrompt });
      }
      messages.push({ role: 'user', content: request.prompt });

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: request.temperature ?? 0.0,
        max_tokens: request.maxTokens ?? 4000,
      });

      const choice = response.choices[0];
      if (!choice?.message?.content) {
        throw new LLMError('OpenAI 返回空内容', 'openai');
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
      if (error instanceof LLMError) throw error;
      throw new LLMError(
        `OpenAI 调用失败: ${error instanceof Error ? error.message : String(error)}`,
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
