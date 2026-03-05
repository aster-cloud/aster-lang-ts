#!/usr/bin/env node
/**
 * 输出 .aster 文件的剪枝 Core IR JSON（供跨编译器黄金测试使用）
 *
 * 用法: node dist/scripts/core-ir-json.js <file.aster>
 *
 * 剪枝字段契约（与 CrossCompilerCoreIRTest.java PRUNE_FIELDS 保持同步）：
 * - 位置字段：origin, span, file, nameSpan, variantSpans
 * - 推断标记：typeInferred, retTypeInferred
 * - 类型推断差异：typeParams, ret, type
 * - Java 独有字段：piiLevel, piiCategories, annotations, effectCapsExplicit
 * - 空 constraints 数组
 */
import fs from 'node:fs';
import { canonicalize, lex, parse } from '../src/index.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('用法: core-ir-json <file.aster>');
  process.exit(1);
}

const src = fs.readFileSync(inputPath, 'utf8');
const can = canonicalize(src);
const toks = lex(can);
const { ast, diagnostics } = parse(toks);

// 仅在存在 error 级别诊断时失败（warning/info/hint 不阻塞）
if (diagnostics && diagnostics.length > 0) {
  const errors = diagnostics.filter(d => d.severity === 'error');
  for (const d of diagnostics) {
    const loc = d.span ? `${d.span.start.line}:${d.span.start.col}` : '?:?';
    console.error(`${d.severity}: ${d.message} (${loc})`);
  }
  if (errors.length > 0) {
    process.exit(2);
  }
}

const { lowerModule } = await import('../src/lower_to_core.js');
const core = lowerModule(ast);
const pruned = prune(core);

console.log(JSON.stringify(pruned, null, 2));

function prune(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(prune);
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      // 位置字段
      if (k === 'span' || k === 'file' || k === 'origin' || k === 'nameSpan' || k === 'variantSpans') continue;
      // 推断标记
      if (k === 'typeInferred' || k === 'retTypeInferred') continue;
      // 类型推断差异字段——TS 和 Java 推断策略不同
      if (k === 'typeParams') continue;
      if (k === 'ret' || k === 'type') continue;
      if (k === 'annotations') continue;
      if (k === 'piiLevel' || k === 'piiCategories') continue;
      if (k === 'effectCapsExplicit') continue;
      // 空 constraints 数组
      if (k === 'constraints' && Array.isArray(v) && v.length === 0) continue;
      out[k] = prune(v as unknown);
    }
    return out;
  }
  return obj;
}
