/**
 * manifest 能力检查双引擎 parity（ADR 0056 §4.1、aster-lang-ts#320）。
 *
 * 共享夹具 shared/manifest_capability_parity.json 与 aster-lang-core 的
 * src/test/resources/diagnostics/manifest_capability_parity.json 必须 byte-identical；core 侧
 * ManifestCapabilityParityTest 跑同一组例子。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSource, resolveAndLowerChecked } from '../../../src/compile-pipeline.js';
import { typecheckModuleWithCapabilities } from '../../../src/typecheck.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';

interface ManifestCase {
  readonly name: string;
  readonly source: string;
  readonly allow: readonly string[];
  readonly deny: readonly string[];
  readonly codes: readonly (readonly [string, number, string])[];
}

const REPO_ROOT = process.cwd();
const RELATIVE = ['shared', 'manifest_capability_parity.json'];
const CORE_RELATIVE = ['src', 'test', 'resources', 'diagnostics', 'manifest_capability_parity.json'];
const FIXTURE_BYTES = readFileSync(resolve(REPO_ROOT, ...RELATIVE));
const CASES = (JSON.parse(FIXTURE_BYTES.toString('utf8')) as { cases: ManifestCase[] }).cases;

const table = (labels: readonly string[]) => Object.fromEntries(labels.map((l) => [l, ['*']]));

describe('manifest 能力检查 parity 夹具（ts 侧）', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const parsed = parseSource(c.source);
      assert.deepEqual(parsed.diagnostics.filter((d) => d.severity === 'error'), [], c.name);
      const { core } = resolveAndLowerChecked(parsed.ast);
      const manifest = c.deny.length > 0 ? { allow: table(c.allow), deny: table(c.deny) } : { allow: table(c.allow) };
      const actual = typecheckModuleWithCapabilities(core, manifest as never)
        .filter((d) => d.code === ErrorCode.CAPABILITY_NOT_ALLOWED)
        .map((d) => [d.code, d.span?.start.line ?? 0, String((d.data as Record<string, unknown>)?.cap)] as const)
        .sort((a, b) => a[2].localeCompare(b[2]));
      assert.deepEqual(actual, c.codes);
    });
  }

  it('与 aster-lang-core 的副本 byte-identical', () => {
    const candidates = [
      resolve(REPO_ROOT, '..', 'aster-lang-core', ...CORE_RELATIVE),
      resolve(REPO_ROOT, 'aster-lang-core', ...CORE_RELATIVE),
    ];
    const inCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
    const found = candidates.map((p) => { try { return readFileSync(p); } catch { return undefined; } }).find((b) => b);
    if (!found) {
      if (inCi) assert.fail(`CI 中必须 checkout aster-lang-core 才能校验夹具同源：\n${candidates.join('\n')}`);
      return;
    }
    assert.ok(found.equals(FIXTURE_BYTES), 'shared/manifest_capability_parity.json 与 core 副本不一致');
  });
});
