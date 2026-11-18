import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '../../../src/browser.js';
import { canonicalJson } from '../../../src/core/canonical-json.js';
import { evaluate } from '../../../src/core/interpreter.js';
import type { Core } from '../../../src/types.js';
import { EXPORT_BUILTINS } from '../../../src/policy-package/package-check.js';
import { computeExportBuiltins, EXPORT_BUILTINS_PATH, renderExportBuiltins, type ExportBuiltins } from '../../../scripts/generate-export-builtins.js';
import { locateSiblingSource } from '../../helpers/sibling-source.js';

// ts 导出 builtin 白名单（ADR 0059 P2 T22，修订 3 P2-R7）：与引擎源码表同步、引擎确实分派、与 truffle 白名单同形且差集锁定。
const readRepo = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

test('白名单文件等于从引擎源码表计算的结果（规范 JSON + 换行）', () => {
  assert.equal(readRepo(EXPORT_BUILTINS_PATH), renderExportBuiltins(), '重新运行 node dist/scripts/generate-export-builtins.js 并提交');
  assert.deepEqual(EXPORT_BUILTINS, JSON.parse(renderExportBuiltins()), '随包发布的模块与文件一致');
});

test('names 升序、无重复、不含 await 与 IO.*，aliases 指向 names', () => {
  const { names, aliases, engine } = computeExportBuiltins();
  assert.equal(engine, 'aster-lang-ts-interpreter');
  assert.ok(names.length > 80, `白名单过小：${names.length}`);
  for (let i = 1; i < names.length; i++) assert.ok(names[i - 1]! < names[i]!, `未严格升序：${names[i]}`);
  assert.ok(!names.includes('await'));
  assert.ok(names.every((n) => !n.startsWith('IO.')));
  for (const k of ['+', '!=', 'add', 'not', 'Text.concat', 'Verdict.require_approval']) assert.ok(names.includes(k), k);
  for (const [alias, target] of Object.entries(aliases)) {
    assert.equal(alias, alias.toLowerCase(), `别名须小写：${alias}`);
    assert.ok(names.includes(target), `${alias} → ${target} 不在 names 中`);
  }
});

/** 一个只含 `f` 的模块，`f` 的函数体为 `Return <name>()`（以 0 个实参调用）。 */
function moduleCalling(name: string): Core.Module {
  const c = compile('Module m.\n\nRule f, produce Int:\n  Return 1.');
  assert.ok(c.success && c.core, JSON.stringify(c));
  const core = JSON.parse(JSON.stringify(c.core)) as { decls: { body: { statements: { expr: unknown }[] } }[] };
  const ret = core.decls[0]!.body.statements[0]!;
  ret.expr = { kind: 'Call', target: { kind: 'Name', name }, args: [] };
  return core as unknown as Core.Module;
}

test('每个名字都由引擎分派：以错误个数实参调用时错误不是 Undefined function', () => {
  for (const name of computeExportBuiltins().names) {
    const r = evaluate(moduleCalling(name), 'f', {});
    if (!r.success) assert.doesNotMatch(r.error ?? '', /Undefined function/, name);
  }
  // 反例：不在白名单里的名字确实报 Undefined function，证明上面的断言有判别力
  const r = evaluate(moduleCalling('Text.nosuch'), 'f', {});
  assert.equal(r.success, false);
  assert.match(r.error ?? '', /Undefined function/);
});

/** aster-lang-truffle 的同形白名单（P1 T10）。本地为兄弟目录，CI 为工作区子目录；CI 中缺失即失败。 */
const TRUFFLE_FILE = locateSiblingSource(
  ['../aster-lang-truffle/src/main/resources/aster/truffle/export-builtins.json', './aster-lang-truffle/src/main/resources/aster/truffle/export-builtins.json'],
  'aster-lang-truffle（src/main/resources/aster/truffle/export-builtins.json）',
);

/**
 * 只有 JVM 引擎实现的 builtin：ts 解释器的 BUILTIN_ARITY 注释写明 `PII.unwrap`、`Text.redact` 仅 JVM 侧有，
 * `await` 两边都不算可导出（ts 口径排除 await；E731 另行拦截）。差集变化说明某个引擎增删了 builtin，须同步评估。
 */
const JVM_ONLY = ['PII.unwrap', 'Text.redact', 'await'];

test('与 truffle 白名单同形，ts 名字经 truffle 别名归一后是其子集，差集锁定', { skip: TRUFFLE_FILE === undefined ? '本地未检出 aster-lang-truffle' : false }, () => {
  const text = readFileSync(TRUFFLE_FILE!, 'utf8');
  const truffle = JSON.parse(text) as ExportBuiltins;
  assert.equal(text, `${canonicalJson(truffle)}\n`, 'truffle 文件同为规范 JSON + 换行');
  assert.deepEqual(Object.keys(truffle), ['aliases', 'engine', 'names']);
  assert.equal(truffle.engine, 'aster-lang-truffle');
  const ts = computeExportBuiltins();
  for (const [alias, target] of Object.entries(ts.aliases)) assert.equal(truffle.aliases[alias], target, `别名 ${alias} 两引擎归一不同`);
  // ts 的运算符名（+、>= …）在 truffle 里是 aliases 的键；具名 builtin 原样
  const normalized = new Set(ts.names.map((n) => truffle.aliases[n] ?? n));
  for (const n of normalized) assert.ok(truffle.names.includes(n), `ts 可导出的 ${n} 不在 truffle 白名单中`);
  assert.deepEqual(truffle.names.filter((n) => !normalized.has(n)), JVM_ONLY);
});
