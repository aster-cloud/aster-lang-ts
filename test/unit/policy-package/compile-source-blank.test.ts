/**
 * 只含空白类字符的源码（core#288，aster-lang-ts#348）：`compileSource`（`aster compile`、包检查）与 core
 * `InProcessCnlParser` 同一判定。共享夹具 shared/blank_source_parity.json 与 aster-lang-core
 * src/test/resources/diagnostics/blank_source_parity.json 逐字节相同，期望值由 core 生成。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CompileFailure, compileSource, EMPTY_SOURCE_MESSAGE } from '../../../src/policy-package/compile-source.js';

interface BlankCase {
  readonly locale: string;
  readonly source: string;
  readonly expect: { readonly empty?: boolean; readonly code?: string; readonly line?: number };
}

const FIXTURE = resolve(process.cwd(), 'shared', 'blank_source_parity.json');
const CASES = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: BlankCase[] }).cases;

const escape = (s: string): string =>
  s === '' ? '<empty>' : [...s].map((c) => (c < ' ' || c > '~' ? `\\u${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}` : c)).join('');

function failureOf(source: string, locale: string): CompileFailure {
  try {
    compileSource(source, { locale });
  } catch (e) {
    if (e instanceof CompileFailure) return e;
    throw e;
  }
  assert.fail('只含空白类字符的源码不应编译成功');
}

/** 失败里的带码解析诊断（CompileFailure.diagnostics 为 ParseError 的 JSON）。 */
function codedDiagnostics(f: CompileFailure): { code: string; line: number }[] {
  const out: { code: string; line: number }[] = [];
  for (const d of f.diagnostics) {
    if (!d.startsWith('{')) continue;
    const p = JSON.parse(d) as { code?: string; span?: { start: { line: number } } };
    if (p.code !== undefined && p.span !== undefined) out.push({ code: p.code, line: p.span.start.line });
  }
  return out;
}

test('共享夹具覆盖 22 份源码 × 4 个词法表', () => {
  assert.equal(CASES.length, 88);
  assert.deepEqual([...new Set(CASES.map((c) => c.locale))], ['en-US', 'zh-CN', 'de-DE', 'hi-IN']);
});

for (const c of CASES) {
  test(`compileSource 与 core 同一空源码判定：${c.locale} ${escape(c.source)}`, () => {
    const f = failureOf(c.source, c.locale);
    const coded = codedDiagnostics(f);
    if (c.expect.empty === true) {
      assert.deepEqual(coded, [], `期望按空源码拒绝：${f.message}`);
      return;
    }
    const primary = coded.find((d) => d.code !== 'E063') ?? coded[0];
    assert.ok(primary, `期望带码诊断：${f.message}`);
    assert.deepEqual([primary.code, primary.line], [c.expect.code, c.expect.line]);
  });
}

test('zh-CN 只含 U+3000 的源码按空源码拒绝，不编译成空模块', () => {
  for (const source of ['　\n', '　　', '　\n　　\n']) {
    assert.deepEqual(failureOf(source, 'zh-CN').diagnostics, [EMPTY_SOURCE_MESSAGE], escape(source));
  }
});

test('en-US 只含 U+3000 的源码仍报 E050（第 1 行）', () => {
  assert.deepEqual(codedDiagnostics(failureOf('　\n', 'en-US')).map((d) => [d.code, d.line]), [['E050', 1]]);
});
