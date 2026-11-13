/**
 * CLI 的 Core IR 文件出入口（ADR 0055 §5）：写出一律用规范字节 `serializeCoreIr`，
 * 读入一律经 `readCoreIr` 严格校验（版本、schema、不变式），不合格即抛 CoreIrFormatError。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseSource, resolveAndLowerChecked } from '../../compile-pipeline.js';
import { readCoreIr } from '../../core/read-core-ir.js';
import { serializeCoreIr } from '../../core/serialize-core-ir.js';

/** 源码 → 规范 Core IR v2 字节（经名称解析 R1/R2，任一 E8xx 抛出 NameResolutionError）。 */
export function coreJsonOfSource(source: string): string {
  return serializeCoreIr(resolveAndLowerChecked(parseSource(source).ast).core);
}

/**
 * 准备交给 Truffle 的 Core IR 文件：`.aster` 输入编译后写入 `<buildDir>/<name>_core.json`；
 * 其它输入视为 Core IR JSON，先严格读入一遍，不合格就在这里报错，而不是交给 JVM 侧。返回待运行的文件路径。
 */
export function prepareTruffleCoreJson(input: string, buildDir = 'build'): string {
  if (input.endsWith('.aster')) {
    const json = coreJsonOfSource(fs.readFileSync(input, 'utf8'));
    fs.mkdirSync(buildDir, { recursive: true });
    const out = path.join(buildDir, `${path.basename(input, '.aster')}_core.json`);
    fs.writeFileSync(out, json);
    return out;
  }
  readCoreIr(fs.readFileSync(input, 'utf8'));
  return input;
}
