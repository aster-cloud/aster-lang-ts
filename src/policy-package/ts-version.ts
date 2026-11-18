/**
 * 本包（`@aster-cloud/aster-lang-ts`）的版本，供 `./package-check` 的 `TS_VERSION`。
 *
 * Workers 里不能像 `cli-version.ts` 那样从磁盘读 package.json，所以构建时由 `scripts/stamp-ts-version.mjs`
 * 把 dist 中的占位值替换为 package.json 的 version（`pnpm run build` 的一步，发布 job 同样执行）。
 * 未盖章（直接从源码运行）时为占位值：cloud 把它与锁文件版本比较必然不等，按版本漂移拒绝导出（fail-closed）。
 */
export const TS_VERSION: string = '0.0.0-unstamped';
