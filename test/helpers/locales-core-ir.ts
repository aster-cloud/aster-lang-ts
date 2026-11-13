import { join } from 'node:path';
import { locateSiblingSource } from './sibling-source.js';

/**
 * 定位 aster-lang-locales 的 core-ir 目录（Core IR v2 schema 真相源与共享夹具，ADR 0055 §3）。
 * 候选依次为本地兄弟目录 ../aster-lang-locales 与 CI 工作区子目录 ./aster-lang-locales；
 * CI 中缺失即失败，本地缺失返回 undefined 由调用方跳过。
 */
export function locateLocalesCoreIr(file: string): string | undefined {
  const cwd = process.cwd();
  return locateSiblingSource(
    [
      join(cwd, '..', 'aster-lang-locales', 'core-ir', file),
      join(cwd, 'aster-lang-locales', 'core-ir', file),
    ],
    `aster-lang-locales 以读取 core-ir/${file}`,
  );
}
