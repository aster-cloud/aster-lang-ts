#!/usr/bin/env node
/**
 * 解析行为基线对比（ADR 0051 §16 R56 的「编译结果不变」证据，可复跑）。
 *
 * 对同一批输入分别用基线构建与当前构建跑 parse 与 compile()，比较：
 *   - 解析成功时的 AST（JSON）与 compile() 的 success / Core IR；
 *   - 每条解析诊断的英文 message 与位置（span）。
 * 输入 = aster-lang-test 语料下全部 .aster 文件 + 由它们按固定种子生成的变异源码
 * （删除 / 插入 / 替换一个记号），清单完全由语料内容与种子决定，输出里带清单的 sha256。
 *
 * 用法：
 *   git worktree add /tmp/ts-base origin/main && (cd /tmp/ts-base && pnpm install --frozen-lockfile && npx tsc)
 *   npx tsc
 *   node scripts/compare-parse-baseline.mjs --base /tmp/ts-base/dist --head dist \
 *     --corpus ../aster-lang-test/corpus [--out compare-report.json]
 *
 * 退出码：AST / Core / message 有任何差异时为 1；只有位置差异时为 0（位置差异逐条列出，需人工核对）。
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const BASE = resolve(args.base ?? '');
const HEAD = resolve(args.head ?? 'dist');
const CORPUS = resolve(args.corpus ?? '../aster-lang-test/corpus');
const SEED = Number(args.seed ?? 56);
const PER_FILE = Number(args.mutations ?? 12);
if (!args.base) {
  console.error('缺少 --base <基线 dist 目录>');
  process.exit(2);
}

/** 固定种子的 PRNG（mulberry32），保证变异清单可复现。 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function walk(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.aster') ? [p] : [];
    });
}

const TOKEN = /"[^"\n]*"|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|\S/g;
const INSERTS = ['.', ',', ':', ')', '(', 'Return', 'Let', '§', '"', 'be', 'to', 'then', '[', 'Otherwise', 'When', 'as',
  'has', '99999999999', '  ', '\n', 'Module x.', 'Use a.b as C.', 'is <', 'with', 'Define'];

function buildInputs() {
  const files = walk(CORPUS);
  const random = rng(SEED);
  const pick = (xs) => xs[Math.floor(random() * xs.length)];
  const inputs = [];
  for (const file of files) {
    const name = relative(CORPUS, file);
    const source = readFileSync(file, 'utf8');
    inputs.push({ name, source });
    // 变异只取英文、≤40 行的源码，避开模块头
    if (!source.startsWith('Module ') || source.split('\n').length > 41 || !/^[\x00-\x7f]*$/.test(source)) continue;
    const headerEnd = source.indexOf('\n');
    const tokens = [...source.matchAll(TOKEN)].filter((m) => m.index > headerEnd).map((m) => [m.index, m.index + m[0].length]);
    if (tokens.length === 0) continue;
    for (let k = 0; k < PER_FILE; k++) {
      const [a, b] = pick(tokens);
      const op = random();
      const mutated = op < 0.45 ? source.slice(0, a) + source.slice(b)
        : op < 0.85 ? source.slice(0, a) + pick(INSERTS) + ' ' + source.slice(a)
          : source.slice(0, a) + pick(INSERTS) + source.slice(b);
      inputs.push({ name: `${name}#${k}`, source: mutated });
    }
  }
  return inputs;
}

async function load(dist) {
  const imp = (p) => import(pathToFileURL(join(dist, p)).href);
  return {
    canonicalize: (await imp('src/frontend/canonicalizer.js')).canonicalize,
    lex: (await imp('src/frontend/lexer.js')).lex,
    parse: (await imp('src/parser.js')).parseWithLexicon,
    compile: (await imp('src/browser.js')).compile,
    EN: (await imp('src/config/lexicons/en-US.js')).EN_US,
  };
}

function run(engine, source) {
  let parse;
  try {
    const r = engine.parse(engine.lex(engine.canonicalize(source, engine.EN), engine.EN), engine.EN);
    const errors = r.diagnostics.length;
    parse = {
      ast: errors === 0 ? JSON.stringify(r.ast) : undefined,
      diags: r.diagnostics.map((d) => ({ severity: d.severity, message: d.message, span: d.span })),
    };
  } catch (e) {
    const d = e.diagnostic;
    parse = { diags: [d ? { severity: d.severity, message: d.message, span: d.span, thrown: true } : { message: String(e), thrown: true }] };
  }
  const c = engine.compile(source);
  return { parse, compile: JSON.stringify({ success: c.success, core: c.core }) };
}

const inputs = buildInputs();
const manifest = createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
const [A, B] = [await load(BASE), await load(HEAD)];
const report = { inputs: inputs.length, manifestSha256: manifest, seed: SEED, astDiff: [], compileDiff: [], messageDiff: [], spanDiff: [] };
const fmt = (s) => (s ? `${s.start.line}:${s.start.col}` : '-');
for (const { name, source } of inputs) {
  const a = run(A, source);
  const b = run(B, source);
  if (a.parse.ast !== b.parse.ast) report.astDiff.push(name);
  if (a.compile !== b.compile) report.compileDiff.push(name);
  const ma = a.parse.diags.map((d) => `${d.severity}|${d.message}`);
  const mb = b.parse.diags.map((d) => `${d.severity}|${d.message}`);
  if (JSON.stringify(ma) !== JSON.stringify(mb)) {
    report.messageDiff.push({ name, base: ma, head: mb });
    continue;
  }
  a.parse.diags.forEach((d, i) => {
    const e = b.parse.diags[i];
    if (JSON.stringify(d.span) !== JSON.stringify(e.span)) {
      report.spanDiff.push({ name, message: d.message, base: fmt(d.span), head: fmt(e.span) });
    }
  });
}
if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({
  inputs: report.inputs, manifestSha256: manifest,
  astDiff: report.astDiff.length, compileDiff: report.compileDiff.length,
  messageDiff: report.messageDiff.length, spanDiff: report.spanDiff.length,
}));
for (const s of report.spanDiff) console.log(`SPAN ${s.name}  ${s.base} → ${s.head}  ${s.message}`);
for (const n of report.compileDiff) console.log(`COMPILE ${n}`);
for (const m of report.messageDiff) console.log(`MESSAGE ${m.name}`);
process.exit(report.astDiff.length + report.compileDiff.length + report.messageDiff.length > 0 ? 1 : 0);
