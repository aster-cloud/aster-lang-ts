#!/usr/bin/env node
/**
 * 构建步骤：把 dist/src/policy-package/ts-version.js 中的占位版本替换为 package.json 的 version
 * （`./package-check` 的 TS_VERSION，ADR 0059 修订 3 P2-R7）。占位值缺失（文件已盖章或结构变了）即失败，
 * 避免发布出带错误版本的包。由 package.json 的 build 脚本在 tsc 之后调用。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLACEHOLDER = "'0.0.0-unstamped'";
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'dist', 'src', 'policy-package', 'ts-version.js');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const text = readFileSync(target, 'utf8');
if (!text.includes(PLACEHOLDER) && text.includes(`TS_VERSION = ${JSON.stringify(version)}`)) {
  console.log(`stamp-ts-version: 已是 ${version}`);
  process.exit(0);
}
if (text.split(PLACEHOLDER).length !== 2) {
  console.error(`stamp-ts-version: ${target} 中应恰有一处占位值 ${PLACEHOLDER}`);
  process.exit(1);
}
writeFileSync(target, text.replace(PLACEHOLDER, JSON.stringify(version)));
console.log(`stamp-ts-version: TS_VERSION = ${version}`);
