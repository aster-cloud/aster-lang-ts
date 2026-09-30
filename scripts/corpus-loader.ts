import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type CorpusModule = typeof import('@aster-cloud/aster-lang-test');

/** 指向 aster-lang-test checkout 根目录的环境变量（corpus-regression 工作流设置）。 */
export const CORPUS_PATH_ENV = 'ASTER_LANG_TEST_PATH';

/** checkout 内的 loader 产物位置（需先在 packages/js 执行 build）。 */
export function corpusLoaderPath(root: string): string {
  return path.resolve(root, 'packages', 'js', 'dist', 'loader.js');
}

/**
 * 加载共享语料。
 *
 * 未设置 ASTER_LANG_TEST_PATH 时用 npm 依赖 @aster-cloud/aster-lang-test；
 * 设置了就必须从该 checkout 加载，并断言 listSamples 的路径确实落在其中——
 * 「设了变量但仍跑固定 npm 版本」正是回归门禁失效的形态，宁可失败也不能静默。
 */
export async function loadCorpus(env: NodeJS.ProcessEnv = process.env): Promise<CorpusModule> {
  const override = env[CORPUS_PATH_ENV];
  if (!override) return import('@aster-cloud/aster-lang-test');

  const root = realpathOrResolve(override);
  const loader = corpusLoaderPath(root);
  let mod: CorpusModule;
  try {
    mod = (await import(pathToFileURL(loader).href)) as CorpusModule;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${CORPUS_PATH_ENV}=${override} 已设置，但无法加载 ${loader}` +
        `（需先在该 checkout 的 packages/js 执行 pnpm install && pnpm run build）：${reason}`
    );
  }
  assertCorpusFrom(mod, root);
  return mod;
}

/**
 * 规范化为真实路径。
 *
 * Node 的 ESM loader 对模块路径做 realpath，aster-lang-test 的 `listSamples()` 由
 * `import.meta.url` 推导，返回的因此是真实路径；比较双方必须同基准，否则
 * ASTER_LANG_TEST_PATH 只要经过一层符号链接（macOS `/tmp`→`/private/tmp`、pnpm 或
 * worktree 软链）就被误判「未生效」。尚不存在的路径没有真实路径可言，退回 resolve。
 */
function realpathOrResolve(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/** 断言语料模块返回的样本全部位于 root 之下（override 真正生效）。两侧均按真实路径比较。 */
export function assertCorpusFrom(mod: Pick<CorpusModule, 'listSamples'>, root: string): void {
  const prefix = realpathOrResolve(root) + path.sep;
  const samples = mod.listSamples();
  const stray = samples.find(s => !realpathOrResolve(s.absPath).startsWith(prefix));
  if (samples.length === 0 || stray) {
    throw new Error(
      `${CORPUS_PATH_ENV}=${root} 未生效：语料样本来自 ${stray?.absPath ?? '（空集）'}，而非该 checkout`
    );
  }
}
