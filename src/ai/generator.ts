import type { LLMProvider, LLMRequest } from './llm-provider.js';
import { PromptManager } from './prompt-manager.js';
import { PolicyValidator } from './validator.js';
import { ProvenanceTracker } from './provenance.js';
import type { ValidationResult } from './validator.js';
import type { ProvenanceMetadata } from './provenance.js';
import { GenerationCache } from './generation-cache.js';

/**
 * 代碼生成請求參數
 */
export interface GenerateRequest {
  /**
   * 英文描述（用戶輸入的需求）
   */
  description: string;

  /**
   * LLM Provider 實例
   */
  provider: LLMProvider;

  /**
   * few-shot 示例數量（默認 5）
   */
  fewShotCount?: number;

  /**
   * 溫度參數（默認 0.7）
   */
  temperature?: number;

  /**
   * 最大 token 數（默認由 provider 決定）
   */
  maxTokens?: number;

  /**
   * 是否使用緩存（默認 true）
   */
  useCache?: boolean;
}

/**
 * 代碼生成結果
 */
export interface GenerateResult {
  /**
   * 生成的 CNL 代碼（帶 provenance 頭）
   */
  code: string;

  /**
   * 不帶 provenance 的原始代碼
   */
  rawCode: string;

  /**
   * 驗證結果
   */
  validation: ValidationResult;

  /**
   * Provenance 元數據
   */
  metadata: ProvenanceMetadata;

  /**
   * Token 使用量統計
   */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };

  /**
   * 是否來自緩存
   */
  fromCache: boolean;
}

/**
 * AI 代碼生成器
 *
 * 協調 LLM Provider、Prompt Manager、Validator 和 Provenance Tracker
 * 完成完整的代碼生成流程
 */
export class AIGenerator {
  private promptManager: PromptManager;
  private validator: PolicyValidator;
  private provenance: ProvenanceTracker;
  private cache: GenerationCache;

  /**
   * 構造函數
   *
   * @param promptManager - Prompt Manager 實例（可選，用於測試時依賴注入）
   * @param validator - Policy Validator 實例（可選，用於測試時依賴注入）
   * @param provenance - Provenance Tracker 實例（可選，用於測試時依賴注入）
   */
  constructor(
    promptManager?: PromptManager,
    validator?: PolicyValidator,
    provenance?: ProvenanceTracker,
    cache?: GenerationCache
  ) {
    this.promptManager = promptManager ?? new PromptManager();
    this.validator = validator ?? new PolicyValidator();
    this.provenance = provenance ?? new ProvenanceTracker();
    this.cache = cache ?? new GenerationCache();
  }

  /**
   * 生成 Aster CNL 代碼
   *
   * 完整流程：
   * 1. 加載 prompt 模板
   * 2. 構建完整 prompt
   * 3. 調用 LLM 生成代碼
   * 4. 驗證生成的代碼
   * 5. 添加 provenance 元數據
   *
   * @param request - 生成請求參數
   * @returns 生成結果（包含代碼、驗證結果和元數據）
   */
  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const fewShotCount = request.fewShotCount ?? 5;
    const useCache = request.useCache !== false;
    const cacheKey = this.buildCacheKey(request, fewShotCount);

    if (useCache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return { ...cached, fromCache: true };
      }
    }

    // 1. 加載 prompt 模板
    const systemPrompt = await this.promptManager.getSystemPrompt();
    const examples = await this.promptManager.getFewShotExamples(fewShotCount);
    const fewShotPrompt = this.promptManager.formatFewShotPrompt(examples);

    // 2. 構建完整 prompt
    const fullPrompt = `${fewShotPrompt}\n\n---\n\nNow generate CNL code for:\n${request.description}`;

    // 3. 調用 LLM
    const llmRequest: LLMRequest = {
      prompt: fullPrompt,
      systemPrompt,
    };

    if (request.temperature !== undefined) {
      llmRequest.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      llmRequest.maxTokens = request.maxTokens;
    }

    const llmResponse = await request.provider.generate(llmRequest);

    const rawCode = llmResponse.content.trim();

    // 4. 驗證生成的代碼
    const validation = await this.validator.validate(rawCode);

    // 5. 添加 provenance 元數據
    const metadata: ProvenanceMetadata = {
      model: llmResponse.model,
      provider: request.provider.getName(),
      prompt: request.description,
      timestamp: new Date().toISOString(),
      validated: validation.valid,
    };

    const codeWithProvenance = this.provenance.addProvenanceToCode(
      rawCode,
      metadata
    );

    const result: GenerateResult = {
      code: codeWithProvenance,
      rawCode,
      validation,
      metadata,
      usage: llmResponse.usage,
      fromCache: false,
    };

    if (useCache) {
      await this.cache.set(cacheKey, result);
    }

    return result;
  }

  private buildCacheKey(
    request: GenerateRequest,
    fewShotCount: number
  ): string {
    const providerName = request.provider.getName();
    const model = request.provider.getModel();
    const temp =
      request.temperature !== undefined ? request.temperature : 'default';
    const descriptionHash = GenerationCache.hashDescription(
      request.description
    );

    return `${providerName}-${model}-temp${temp}-fs${fewShotCount}-${descriptionHash}`;
  }
}
