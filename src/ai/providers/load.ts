/**
 * 按需加载 LLM provider 模块。
 *
 * `openai` 与 `@anthropic-ai/sdk` 是 optionalDependencies：`npm i --omit=optional`（精简 CI 镜像、`npm ci --omit=optional`）
 * 不会安装它们。provider 模块静态 import 各自的 SDK，所以 CLI 只在真正用到某个 provider 时才动态 import 它，
 * 其余命令不受影响（aster-lang-ts#364）；缺包时给出可操作的提示，而不是 ERR_MODULE_NOT_FOUND 堆栈。
 */
import { LLMError } from '../llm-provider.js';

/** 所需的可选依赖未安装。 */
export class OptionalDependencyMissingError extends LLMError {
  constructor(
    provider: string,
    readonly packageName: string,
    cause?: Error,
  ) {
    super(`未安装可选依赖 ${packageName}（npm i --omit=optional 不会安装它）；使用 ${provider} 前请先安装：npm i ${packageName}`, provider, cause);
    this.name = 'OptionalDependencyMissingError';
  }
}

/** 错误是否表示包 packageName 本身找不到（而不是它内部或别的模块缺失）。 */
export function isMissingPackage(error: unknown, packageName: string): boolean {
  if (!(error instanceof Error) || (error as { code?: unknown }).code !== 'ERR_MODULE_NOT_FOUND') return false;
  return error.message.includes(`Cannot find package '${packageName}'`);
}

/** 执行 load；它因 packageName 未安装而失败时改抛 {@link OptionalDependencyMissingError}，其余错误原样抛出。 */
export async function loadOptional<T>(provider: string, packageName: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (isMissingPackage(error, packageName)) throw new OptionalDependencyMissingError(provider, packageName, error as Error);
    throw error;
  }
}
