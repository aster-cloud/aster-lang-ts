import type { LLMProvider, LLMRequest, LLMResponse } from '../llm-provider.js';
import { LLMError } from '../llm-provider.js';

export interface AnthropicConfig {
  apiKey?: string;
  model?: string;
}

export class AnthropicProvider implements LLMProvider {
  private client: any;
  private model: string;
  private Anthropic: any;

  constructor(config: AnthropicConfig = {}) {
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new LLMError('缺少 Anthropic API key，请设置 ANTHROPIC_API_KEY 环境变量', 'anthropic');
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.Anthropic = require('@anthropic-ai/sdk').default;
    } catch {
      throw new LLMError(
        '缺少 @anthropic-ai/sdk，请运行: npm install @anthropic-ai/sdk',
        'anthropic'
      );
    }

    this.client = new this.Anthropic({ apiKey });
    this.model = config.model || 'claude-3-5-sonnet-20241022';
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    try {
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
        throw new LLMError('Anthropic 返回空内容', 'anthropic');
      }

      return {
        content: response.completion,
        model: response.model,
        usage: {
          promptTokens: Math.ceil(prompt.length / 4),
          completionTokens: Math.ceil(response.completion.length / 4),
          totalTokens: Math.ceil((prompt.length + response.completion.length) / 4),
        },
      };
    } catch (error) {
      if (error instanceof LLMError) throw error;
      throw new LLMError(
        `Anthropic 调用失败: ${error instanceof Error ? error.message : String(error)}`,
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
