import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { locateSiblingSource } from './sibling-source.js';

/**
 * 包格式 v1 一致性夹具目录（aster-lang-test `conformance/package-v1/`，ADR 0059 P1 T1）。
 * 本地为兄弟目录，CI 为工作区子目录；CI 中缺失即失败（见 sibling-source.ts）。本地缺失返回 undefined，测试跳过。
 */
export const PACKAGE_V1 = locateSiblingSource(
  ['../aster-lang-test/conformance/package-v1', './aster-lang-test/conformance/package-v1'],
  'aster-lang-test（conformance/package-v1）',
);

/** 夹具用例（README「用例格式」）。 */
export interface ConformanceCase {
  readonly name: string;
  readonly args: readonly string[];
  readonly stdin?: string;
  readonly stdinB64?: string;
  readonly expectedStdout: string;
  readonly expectedExit: number;
  readonly code: string | null;
  readonly base?: string;
  readonly engines?: readonly string[];
}

/** 读取夹具目录下的 JSON 文件。 */
export function readFixtureJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(PACKAGE_V1!, rel), 'utf8')) as T;
}

/** 读取一个 cases.json 的用例列表。 */
export function readCases(rel: string): ConformanceCase[] {
  return readFixtureJson<{ cases: ConformanceCase[] }>(rel).cases;
}
