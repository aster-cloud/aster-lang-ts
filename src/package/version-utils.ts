/**
 * Aster包管理版本工具函数
 *
 * 封装npm semver库，提供版本解析、约束匹配和排序功能
 */

import semver from 'semver';

/**
 * 解析版本号字符串为SemVer对象
 *
 * @param version 版本号字符串（如 "1.0.0"、"2.3.4"）
 * @returns 解析后的SemVer对象，解析失败返回null
 *
 * @example
 * parseVersion("1.0.0")  // SemVer { major: 1, minor: 0, patch: 0 }
 * parseVersion("invalid") // null
 */
export function parseVersion(version: string): semver.SemVer | null {
  return semver.parse(version);
}

/**
 * 检查版本号是否满足指定约束
 *
 * @param version 版本号字符串（如 "2.1.0"）
 * @param constraint 版本约束（如 "^2.0.0"、"~1.5.3"、">=1.0.0 <3.0.0"）
 * @returns 如果版本满足约束返回true，否则返回false
 *
 * @example
 * satisfies("2.1.0", "^2.0.0")  // true
 * satisfies("1.9.0", "^2.0.0")  // false
 * satisfies("1.5.4", "~1.5.3")  // true
 */
export function satisfies(version: string, constraint: string): boolean {
  return semver.satisfies(version, constraint);
}

/**
 * 从版本列表中返回满足约束的最高版本
 *
 * @param versions 版本号字符串数组
 * @param constraint 版本约束（如 "^2.0.0"）
 * @returns 满足约束的最高版本号字符串，无匹配返回null
 *
 * @example
 * maxSatisfying(["1.0.0", "2.1.0", "2.3.5"], "^2.0.0")  // "2.3.5"
 * maxSatisfying(["1.0.0", "1.5.0"], "^2.0.0")           // null
 */
export function maxSatisfying(versions: string[], constraint: string): string | null {
  return semver.maxSatisfying(versions, constraint);
}

/**
 * 对版本号数组进行降序排序
 *
 * @param versions 版本号字符串数组
 * @returns 按降序排列的版本号数组（最新版本在前）
 *
 * @example
 * sortVersions(["1.0.0", "2.1.0", "1.5.0"])  // ["2.1.0", "1.5.0", "1.0.0"]
 */
export function sortVersions(versions: string[]): string[] {
  return versions.slice().sort(semver.rcompare);
}
