#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import { canonicalize } from '../src/frontend/canonicalizer.js';
import { lex } from '../src/frontend/lexer.js';
import { parse } from '../src/parser.js';
import { lowerModule } from '../src/lower_to_core.js';
import { typecheckModule, typecheckModuleWithCapabilities } from '../src/typecheck.js';
import type { CapabilityManifest } from '../src/effects/capabilities.js';
import type { TypecheckDiagnostic } from '../src/types.js';

interface CliOptions {
  file?: string;
  helpRequested: boolean;
  filterCodes?: Set<string>;
}

function printUsage(): void {
  console.log(`用法: node dist/scripts/typecheck-cli.js <file.aster>

选项:
  --help, -h             显示本帮助并退出
  --filter-codes=E1,E2   仅输出指定错误码（逗号分隔）

输出:
  默认打印 JSON，结构为 { "source": "...", "diagnostics": [...] }

环境变量:
  ASTER_CAPS       指向 capability manifest（JSON），启用后按照 manifest 过滤能力`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { helpRequested: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      options.helpRequested = true;
      return options;
    }
    if (arg.startsWith('--filter-codes=')) {
      const raw = arg.split('=', 2)[1] ?? '';
      const codes = raw
        .split(',')
        .map(code => code.trim())
        .filter(code => code.length > 0)
        .map(code => code.toUpperCase());
      if (codes.length > 0) {
        options.filterCodes = new Set(codes);
      }
      continue;
    }
    if (!options.file && !arg.startsWith('-')) {
      options.file = arg;
    }
  }
  return options;
}

function readManifest(): CapabilityManifest | null {
  const manifestPath = process.env.ASTER_CAPS || '';
  if (!manifestPath) return null;
  try {
    const s = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(s) as CapabilityManifest;
  } catch (error) {
    console.error(`无法读取 ASTER_CAPS 指定的 manifest: ${(error as Error).message}`);
    process.exit(1);
  }
}

function buildPayload(file: string, diagnostics: readonly TypecheckDiagnostic[], filter?: Set<string>): unknown {
  const filtered = filter
    ? diagnostics.filter(diag => filter.has(diag.code.toUpperCase()))
    : diagnostics;

  const severities = filtered.reduce(
    (acc, diag) => {
      acc.total += 1;
      acc[diag.severity] += 1;
      return acc;
    },
    { total: 0, error: 0, warning: 0, info: 0 },
  );
  return {
    source: file,
    diagnostics: filtered,
    summary: severities,
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.helpRequested) {
    printUsage();
    return;
  }

  const file = args.file;
  if (!file) {
    printUsage();
    process.exit(2);
  }

  let input: string;
  try {
    input = fs.readFileSync(file, 'utf8');
  } catch (error) {
    console.error(`无法读取输入文件 ${file}: ${(error as Error).message}`);
    process.exit(1);
  }

  const canonical = canonicalize(input);
  const tokens = lex(canonical);
  const { ast } = parse(tokens);
  const core = lowerModule(ast);
  const manifest = readManifest();
  const diagnostics = manifest ? typecheckModuleWithCapabilities(core, manifest) : typecheckModule(core);

  const payload = buildPayload(file, diagnostics, args.filterCodes);
  console.log(JSON.stringify(payload, null, 2));
}

main();
