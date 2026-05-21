import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMRequest, LLMResponse } from '../llm-provider.js';
import { LLMError } from '../llm-provider.js';

export interface AnthropicConfig {
  apiKey?: string;              // API key（默認從 ANTHROPIC_API_KEY 環境變量讀取）
  model?: string;               // 模型名稱（默認 claude-3-5-sonnet-20241022）
}

/**
 * Anthropic provider — uses the Messages API (the legacy `completions` API
 * is deprecated for Claude 3+ models and unsupported for Claude 4.x).
 *
 * <p>Prompt-injection mitigations:
 * <ul>
 *   <li>User input is delivered as a {@code user} message, not concatenated
 *       into a single text prompt — this is the structural defense the
 *       Messages API was built to provide.</li>
 *   <li>The system prompt (trusted) goes into the top-level {@code system}
 *       field; it cannot be impersonated by user content.</li>
 *   <li>Common injection markers ({@code Human:} / {@code Assistant:})
 *       inside user content are neutralized before sending so they can't
 *       impersonate a turn boundary if the model is configured with a
 *       custom prompt format downstream.</li>
 * </ul>
 */
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
      const sanitizedUser = neutralizeTurnMarkers(request.prompt);

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens ?? 4000,
        temperature: request.temperature ?? 0.7,
        ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
        messages: [{ role: 'user', content: sanitizedUser }],
      });

      const content = extractText(response);
      if (!content) {
        throw new LLMError('Anthropic 返回空內容', 'anthropic');
      }

      return {
        content,
        model: response.model,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
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

/**
 * Strip turn-boundary markers that could let user content impersonate
 * a Human/Assistant turn. We replace them with visually-similar but
 * non-functional variants. This is defense-in-depth on top of the
 * Messages API role boundary — a downstream consumer that re-serializes
 * the prompt for a different model shouldn't pick up forged turns.
 *
 * <p>Whitespace class enumerates evasion-prone Unicode spaces explicitly
 * (NBSP, narrow NBSP, ideographic space, en/em-quad spaces, zero-width
 * variants, BOM) so an attacker can't bypass the line-start detection
 * with " Human:" using U+00A0. /i lets us catch case-folded variants
 * the way some tokenizers do.
 */
const TURN_MARKER_WS = '[ \\t\\u00A0\\u202F\\u3000\\u2000-\\u200A\\u200B-\\u200D\\uFEFF]';
const TURN_MARKER_RE = new RegExp(
  `(^|\\n)(${TURN_MARKER_WS}*)(Human|Assistant)(${TURN_MARKER_WS}*):`,
  'gi',
);

function neutralizeTurnMarkers(input: string): string {
  return input.replace(TURN_MARKER_RE, '$1$2$3$4​:');
}

function extractText(response: Anthropic.Messages.Message): string {
  // The Messages API returns an array of content blocks; we only consume
  // text blocks. Tool-use / image blocks are not part of this provider's
  // contract — fall through cleanly so future block kinds don't crash.
  const parts: string[] = [];
  for (const block of response.content) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('');
}
