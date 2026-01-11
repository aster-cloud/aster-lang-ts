import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Few-shot 示例結構
 */
export interface FewShotExample {
  id: string;
  english_description: string;
  cnl_code: string;
  category: string;
  tags: string[];
}

/**
 * Prompt Manager - 負責加載和管理 LLM prompt 模板
 *
 * 支持內存緩存，避免重複文件 I/O
 */
export class PromptManager {
  private systemPromptCache?: string;
  private examplesCache?: FewShotExample[];
  private promptsDir: string;

  constructor(promptsDir?: string) {
    // 默認使用項目根目錄的 prompts/
    this.promptsDir = promptsDir || join(process.cwd(), 'prompts');
  }

  /**
   * 獲取系統提示（system prompt）
   *
   * 首次調用時從文件讀取並緩存，後續調用直接返回緩存
   */
  async getSystemPrompt(): Promise<string> {
    if (this.systemPromptCache) {
      return this.systemPromptCache;
    }

    const path = join(this.promptsDir, 'system-prompt.txt');
    this.systemPromptCache = await readFile(path, 'utf-8');
    return this.systemPromptCache;
  }

  /**
   * 獲取 few-shot 示例
   *
   * @param count 可選參數，限制返回的示例數量
   * @returns Few-shot 示例數組
   */
  async getFewShotExamples(count?: number): Promise<FewShotExample[]> {
    if (!this.examplesCache) {
      const path = join(this.promptsDir, 'few-shot-examples.jsonl');
      const content = await readFile(path, 'utf-8');
      this.examplesCache = content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    }

    if (count !== undefined) {
      return this.examplesCache.slice(0, count);
    }
    return this.examplesCache;
  }

  /**
   * 格式化 few-shot 示例為 prompt 字符串
   *
   * @param examples Few-shot 示例數組
   * @returns 格式化的 prompt 字符串
   */
  formatFewShotPrompt(examples: FewShotExample[]): string {
    return examples
      .map(ex => `Example: ${ex.english_description}\n\n${ex.cnl_code}`)
      .join('\n\n---\n\n');
  }

  /**
   * 清除緩存
   *
   * 用於熱重載或強制刷新 prompt 模板
   */
  clearCache(): void {
    delete this.systemPromptCache;
    delete this.examplesCache;
  }
}
