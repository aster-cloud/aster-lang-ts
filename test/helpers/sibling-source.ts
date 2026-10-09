import { existsSync } from 'node:fs';

/**
 * 跨仓门禁的兄弟仓文件定位：按序返回首个存在的候选路径。
 * 本地开发为兄弟目录 ../<repo>；CI 只能 checkout 到工作区子目录 ./<repo>。
 * CI 中全部缺失即失败——跳过与通过不可区分的门禁不是门禁；仅本地允许返回 undefined 以跳过。
 * 参照 test/unit/diagnostics/error-codes-parity.test.ts 的 2026-08-17 审计结论。
 */
export function locateSiblingSource(
  candidates: readonly string[],
  what: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const found = candidates.find((c) => existsSync(c));
  if (found !== undefined || !isCi(env)) return found;
  throw new Error(
    `CI 中必须 checkout ${what}，但以下路径均不存在：\n` +
      candidates.map((c) => `  - ${c}`).join('\n') +
      '\n请检查 .github/workflows/ci.yml 的 checkout 步骤。',
  );
}

/** CI 判定：CI 非空（GitHub Actions 置为 true）或 GITHUB_ACTIONS=true。 */
export function isCi(env: NodeJS.ProcessEnv): boolean {
  return (env.CI ?? '').trim() !== '' || env.GITHUB_ACTIONS === 'true';
}
