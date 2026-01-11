/**
 * LLM Provider 抽象層
 *
 * 提供統一的接口用於調用不同的 LLM（OpenAI/Anthropic）
 */

// LLM 請求參數
export interface LLMRequest {
  prompt: string;               // 用戶輸入
  systemPrompt?: string;        // 系統提示（可選）
  temperature?: number;         // 溫度（默認 0.7）
  maxTokens?: number;          // 最大 token 數
}

// LLM 響應
export interface LLMResponse {
  content: string;              // 生成的文本
  model: string;                // 使用的模型
  usage: {                      // Token 使用量
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// LLM Provider 抽象接口
export interface LLMProvider {
  generate(request: LLMRequest): Promise<LLMResponse>;
  getName(): string;            // Provider 名稱（如 "openai"）
  getModel(): string;           // 當前使用的模型
}

// LLM 錯誤類型
export class LLMError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'LLMError';
  }
}
