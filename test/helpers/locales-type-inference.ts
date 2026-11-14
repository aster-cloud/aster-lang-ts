import { join } from 'node:path';
import { locateSiblingSource } from './sibling-source.js';

/**
 * 定位 aster-lang-locales 中 type-inference/ 下的真相源文件（ADR 0056 §3.2）：本地兄弟目录或 CI 子目录。
 * CI 中都不存在即失败；本地未并列 checkout 时返回 undefined 以便跳过。
 */
export function locateLocalesTypeInference(file: string): string | undefined {
  const cwd = process.cwd();
  return locateSiblingSource(
    [
      join(cwd, '..', 'aster-lang-locales', 'type-inference', file),
      join(cwd, 'aster-lang-locales', 'type-inference', file),
    ],
    `aster-lang-locales 以读取 type-inference/${file}`,
  );
}
