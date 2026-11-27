/**
 * ADR 0056 修订 A8 第 3 条（产品裁决 2026-11-28「处处照 core」）：六项一侧差异照 aster-lang-core 收紧或放宽——构造里首字母大写的
 * 字段名、顶层省略 Define 的数据类型、字段列表里换行起头的逗号、点之后的 core 大写关键词记号（Set / Use / On / It / Map / Module）、
 * 裸表达式语句（降为 `Let _ be …`，非名字表达式之后的成员访问与方法调用）、规则头里 with 引导的形参（E062）。
 * 共享夹具 shared/follow_core_parity.json 与 aster-lang-core src/test/resources/diagnostics/follow_core_parity.json 逐字节相同，
 * core FollowCoreParityTest 按同一夹具断言：带 pf 的例两引擎 Core IR 的 positionFreeSha256 恰为 pf；带 reject 的例两引擎都拒，
 * 带 code / line / column（及 params、message）的第一条诊断逐项相同。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CompileFailure, compileSource, positionFreeSha256 } from '../../../src/policy-package/compile-source.js';

interface FollowCoreCase {
  readonly name: string;
  readonly locale?: string;
  readonly source: string;
  readonly pf?: string;
  readonly reject?: true;
  readonly code?: string;
  readonly line?: number;
  readonly column?: number;
  readonly params?: Readonly<Record<string, string>>;
  readonly message?: string;
}

interface FirstDiagnostic {
  readonly code: string;
  readonly span?: { readonly start?: { readonly line?: number; readonly col?: number } };
  readonly params?: Readonly<Record<string, unknown>>;
  readonly message: string;
}

const REPO_ROOT = process.cwd();
const FIXTURE = resolve(REPO_ROOT, 'shared', 'follow_core_parity.json');
const CASES = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: FollowCoreCase[] }).cases;

function firstDiagnostic(c: FollowCoreCase): FirstDiagnostic {
  try {
    compileSource(c.source, { locale: c.locale ?? 'en-US' });
  } catch (e) {
    assert.ok(e instanceof CompileFailure, `应是编译失败：${String(e)}`);
    return JSON.parse(e.diagnostics[0]!) as FirstDiagnostic;
  }
  return assert.fail('应拒绝');
}

describe('处处照 core（ADR 0056 修订 A8 第 3 条）', () => {
  it('共享夹具共 108 例，其中 42 例两引擎都拒、23 例诊断逐项相同', () => {
    assert.equal(CASES.length, 108);
    assert.equal(CASES.filter((c) => c.reject).length, 42);
    assert.equal(CASES.filter((c) => c.code !== undefined).length, 23);
  });

  for (const c of CASES) {
    it(`与 core 同一结论：${c.name}`, () => {
      if (!c.reject) {
        assert.equal(positionFreeSha256(compileSource(c.source, { locale: c.locale ?? 'en-US' })), c.pf);
        return;
      }
      const d = firstDiagnostic(c);
      if (c.code === undefined) return;
      assert.deepEqual([d.code, d.span?.start?.line, d.span?.start?.col], [c.code, c.line, c.column]);
      if (c.params !== undefined) assert.deepEqual(d.params ?? {}, c.params);
      if (c.message !== undefined) assert.equal(d.message, c.message);
    });
  }

  it('ts 夹具与 aster-lang-core 副本 byte-identical（跨仓同源）', () => {
    // 与 keyword-name-parity 同口径：CI 中兄弟仓必须存在（fail-closed），本地未并列 checkout 时跳过。
    const RELATIVE = 'src/test/resources/diagnostics/follow_core_parity.json';
    const candidates = [resolve(REPO_ROOT, '..', 'aster-lang-core', RELATIVE), resolve(REPO_ROOT, 'aster-lang-core', RELATIVE)];
    const inCi =
      process.env.CI === 'true' ||
      process.env.GITHUB_ACTIONS === 'true' ||
      process.env.ASTER_ERROR_CODES_PARITY_REQUIRED === 'true';
    let javaBytes: Buffer | undefined;
    for (const candidate of candidates) {
      try {
        javaBytes = readFileSync(candidate);
        break;
      } catch {
        // 试下一个候选路径
      }
    }
    if (javaBytes === undefined) {
      if (inCi) assert.fail(`CI 中必须 checkout aster-lang-core 才能校验 parity 夹具同源：\n${candidates.join('\n')}`);
      return;
    }
    assert.ok(readFileSync(FIXTURE).equals(javaBytes), 'follow_core_parity.json 与 aster-lang-core 副本必须 byte-identical');
  });
});
