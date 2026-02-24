#!/usr/bin/env node
/**
 * Policy Converter CLI
 *
 * 提供 CNL ↔ JSON 双向转换命令：
 * - compile-to-json: 将 Aster CNL 编译为 Core IR JSON
 * - json-to-cnl: 将 Core IR JSON 转换回 CNL
 */

import * as fs from 'fs';
import { parse } from '../parser.js';
import { lex } from '../frontend/lexer.js';
import { canonicalize } from '../frontend/canonicalizer.js';
import { lowerModule } from '../lower_to_core.js';
import { formatModule } from '../core/pretty_core.js';
import { serializeCoreIR, deserializeCoreIR } from '../core/core_ir_json.js';

/**
 * 读取输入内容（文件或 stdin）
 */
function readInput(inputPath: string): string {
  if (inputPath === '-') {
    // 从 stdin 读取
    return fs.readFileSync(0, 'utf8');
  }

  // 从文件读取
  if (!fs.existsSync(inputPath)) {
    console.error(`Error: File not found: ${inputPath}`);
    process.exit(1);
  }

  return fs.readFileSync(inputPath, 'utf8');
}

/**
 * compile-to-json 命令：CNL → Core IR → JSON
 *
 * 编译 Aster CNL 源码为 Core IR JSON 格式
 */
function compileToJson(inputPath: string, outputPath?: string): void {
  try {
    const source = readInput(inputPath);

    // 编译管线：CNL → Canonical → Tokens → AST → Core IR
    const canonical = canonicalize(source);
    const tokens = lex(canonical);
    const { ast } = parse(tokens);
    const coreIR = lowerModule(ast);

    // 序列化为 JSON
    const metadata = {
      generatedAt: new Date().toISOString(),
      source: inputPath === '-' ? 'stdin' : inputPath,
      compilerVersion: '0.2.0',
    };
    const json = serializeCoreIR(coreIR, metadata);

    // 输出到 stdout 或文件
    if (outputPath) {
      fs.writeFileSync(outputPath, json, 'utf8');
      console.error(`✓ Compiled to ${outputPath}`);
    } else {
      console.log(json);
    }
  } catch (error) {
    console.error('Error during compilation:');
    if (error instanceof Error) {
      console.error(error.message);
      if (error.stack) {
        console.error('\nStack trace:');
        console.error(error.stack);
      }
    } else {
      console.error(String(error));
    }
    process.exit(1);
  }
}

/**
 * json-to-cnl 命令：JSON → Core IR → CNL
 *
 * 将 Core IR JSON 转换回 Aster CNL 源码
 */
function jsonToCnl(inputPath: string, outputPath?: string): void {
  try {
    const json = readInput(inputPath);

    // 反序列化 JSON 为 Core IR
    const coreIR = deserializeCoreIR(json);

    // 使用 formatModule 生成 CNL
    const cnl = formatModule(coreIR);

    // 输出到 stdout 或文件
    if (outputPath) {
      fs.writeFileSync(outputPath, cnl, 'utf8');
      console.error(`✓ Converted to ${outputPath}`);
    } else {
      console.log(cnl);
    }
  } catch (error) {
    console.error('Error during conversion:');
    if (error instanceof Error) {
      console.error(error.message);
      if (error.stack) {
        console.error('\nStack trace:');
        console.error(error.stack);
      }
    } else {
      console.error(String(error));
    }
    process.exit(1);
  }
}

/**
 * 显示使用帮助
 */
function showHelp(): void {
  console.log(`
Policy Converter CLI - Aster CNL ↔ JSON 转换工具

用法:
  aster-convert <command> [options]

命令:
  compile-to-json <input> [-o <output>]
      将 Aster CNL 文件编译为 Core IR JSON
      input:  CNL 源文件路径（使用 '-' 表示 stdin）
      -o:     可选的输出文件路径（默认输出到 stdout）

  json-to-cnl <input> [-o <output>]
      将 Core IR JSON 转换回 Aster CNL
      input:  JSON 文件路径（使用 '-' 表示 stdin）
      -o:     可选的输出文件路径（默认输出到 stdout）

  help, --help, -h
      显示此帮助信息

示例:
  # 编译 CNL 文件为 JSON
  aster-convert compile-to-json policy.aster

  # 编译并保存到文件
  aster-convert compile-to-json policy.aster -o policy.json

  # 从 stdin 读取并输出到 stdout
  cat policy.aster | aster-convert compile-to-json -

  # 将 JSON 转换回 CNL
  aster-convert json-to-cnl policy.json

  # 管道组合使用
  aster-convert compile-to-json policy.aster | aster-convert json-to-cnl -
`);
}

/**
 * CLI 入口
 */
function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    process.exit(0);
  }

  const command = args[0];
  const inputPath = args[1];

  // 解析 -o 输出选项
  let outputPath: string | undefined;
  const outputIndex = args.indexOf('-o');
  if (outputIndex !== -1 && args[outputIndex + 1]) {
    outputPath = args[outputIndex + 1];
  }

  if (!inputPath) {
    console.error(`Error: Missing input file argument`);
    console.error(`Run 'aster-convert help' for usage information`);
    process.exit(1);
  }

  switch (command) {
    case 'compile-to-json':
      compileToJson(inputPath, outputPath);
      break;

    case 'json-to-cnl':
      jsonToCnl(inputPath, outputPath);
      break;

    default:
      console.error(`Error: Unknown command '${command}'`);
      console.error(`Run 'aster-convert help' for usage information`);
      process.exit(1);
  }
}

main();
