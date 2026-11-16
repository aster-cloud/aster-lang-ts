import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { PackageError, type Stage } from '../../../src/policy-package/errors.js';
import { verifyIntegrity } from '../../../src/policy-package/integrity.js';
import { obtainIr } from '../../../src/policy-package/obtain-ir.js';
import { readPackage } from '../../../src/policy-package/read-package.js';
import { verifySignature } from '../../../src/policy-package/signature.js';
import { loadTrustAnchor } from '../../../src/policy-package/trust-anchor.js';
import { PACKAGE_V1, readCases, type ConformanceCase } from '../../helpers/package-v1.js';

// T1 篡改夹具逐条走 read → manifest → signature → integrity → ir，断言错误码与阶段（ADR 0059 P1 T2）。
const skip = PACKAGE_V1 === undefined ? '本地未检出 aster-lang-test' : false;
const PACKAGE_CODES = new Set([
  'PKG_INTEGRITY', 'PKG_SIGNATURE', 'PKG_UNSIGNED', 'PKG_UNTRUSTED_KID', 'PKG_INVALID_MANIFEST',
  'PKG_UNSUPPORTED_FORMAT', 'PKG_UNSUPPORTED_IR', 'PKG_IR_DRIFT',
]);

const opt = (args: readonly string[], name: string): string | undefined => {
  const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return undefined;
  return args[i]!.includes('=') ? args[i]!.slice(name.length + 1) : args[i + 1];
};

/** 跑包级流水线，返回 { stage, code } 或 null（全部通过）。 */
async function check(dir: string, c: ConformanceCase): Promise<{ stage: Stage; code: string } | null> {
  const at = (p: string | undefined): string | undefined => (p === undefined ? undefined : resolve(dir, p));
  const anchor = await loadTrustAnchor({ jwks: at(opt(c.args, '--jwks')), pubkey: at(opt(c.args, '--pubkey')) });
  try {
    const pkg = readPackage(resolve(dir, c.args[1]!));
    verifySignature(pkg, anchor, { allowUnsigned: c.args.includes('--allow-unsigned') });
    verifyIntegrity(pkg);
    obtainIr(pkg);
    return null;
  } catch (e) {
    if (e instanceof PackageError) return { stage: e.stage, code: e.code };
    throw e;
  }
}

if (PACKAGE_V1 !== undefined) {
  const dir = join(PACKAGE_V1, 'tamper');
  for (const c of readCases('tamper/cases.json').filter((x) => x.args[0] === 'run')) {
    test(`篡改夹具：${c.name}`, async () => {
      const r = await check(dir, c);
      if (c.code !== null && PACKAGE_CODES.has(c.code)) {
        assert.equal(r?.code, c.code);
        // 取得 IR 之前失败时 meta.entry 为 null；夹具的期望 stdout 据此区分阶段
        const meta = (JSON.parse(c.expectedStdout) as { meta: { signed: boolean } }).meta;
        assert.equal(meta.signed, !['read', 'manifest', 'signature'].includes(r!.stage), `${c.name}: signed 与阶段 ${r!.stage} 不符`);
      } else {
        assert.equal(r, null, `${c.name}: 包级检查不该失败`);
      }
    });
  }
  for (const f of ['b-credit-limit', 'b-alias', 'b-vocab-de', 'b-zh', 'a-decimal', 'a-inputs', 'a-multi-entry', 'a-timeout', 'a-deep-recursion', 'a-bad-probe']) {
    test(`黄金包通过包级检查：${f}`, async () => {
      const c = readCases(`packages/${f}.cases.json`).find((x) => x.code === null)!;
      assert.equal(await check(join(PACKAGE_V1!, 'packages'), c), null);
    });
  }
  test('zip 炸弹：解压期间 arrayBuffers 增量 < 96 MiB 且报 PKG_INTEGRITY', async () => {
    for (const name of ['zip-bomb-single-entry.zip', 'zip-bomb-many-entries.zip', 'zip-bomb-listed-file.zip']) {
      const before = process.memoryUsage().arrayBuffers;
      let peak = before;
      const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().arrayBuffers)), 1);
      let code: string | undefined;
      try {
        readPackage(join(dir, name));
      } catch (e) {
        code = e instanceof PackageError ? e.code : String(e);
      }
      peak = Math.max(peak, process.memoryUsage().arrayBuffers);
      clearInterval(timer);
      assert.equal(code, 'PKG_INTEGRITY', name);
      assert.ok(peak - before < 96 * 1024 * 1024, `${name}: arrayBuffers 增量 ${peak - before}`);
    }
  });
} else {
  test('篡改夹具', { skip }, () => {});
}
