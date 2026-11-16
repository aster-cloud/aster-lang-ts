import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { PackageError } from '../../../src/policy-package/errors.js';
import { parseInput, type IrView } from '../../../src/policy-package/input.js';
import { obtainIr } from '../../../src/policy-package/obtain-ir.js';
import { readPackage } from '../../../src/policy-package/read-package.js';
import { defaultEntry } from '../../../src/policy-package/manifest.js';
import { PACKAGE_V1, readCases, type ConformanceCase } from '../../helpers/package-v1.js';

const skip = PACKAGE_V1 === undefined ? '本地未检出 aster-lang-test' : false;
const irCache = new Map<string, { ir: IrView; entry: string }>();

/** 从用例参数取包路径与 --entry，返回 IR 与入口。 */
function target(c: ConformanceCase, dir: string): { ir: IrView; entry: string } {
  const args = [...c.args];
  const pos = args.filter((a, i) => i > 0 && !a.startsWith('--') && !args[i - 1]!.startsWith('--'));
  const at = args.findIndex((a) => a === '--entry' || a.startsWith('--entry='));
  const key = join(dir, pos[0]!);
  let t = irCache.get(key);
  if (!t) {
    const p = readPackage(key);
    t = { ir: JSON.parse(obtainIr(p).coreJson) as IrView, entry: defaultEntry(p.manifest) };
    irCache.set(key, t);
  }
  const entry = at < 0 ? t.entry : args[at]!.includes('=') ? args[at]!.split('=')[1]! : args[at + 1]!;
  return { ir: t.ir, entry };
}

const stdinOf = (c: ConformanceCase): Buffer => (c.stdinB64 !== undefined ? Buffer.from(c.stdinB64, 'base64') : Buffer.from(c.stdin ?? '', 'utf8'));

if (PACKAGE_V1 !== undefined) {
  for (const c of readCases('inputs-invalid/cases.json')) {
    test(`inputs-invalid：${c.name}`, () => {
      const { ir, entry } = target(c, join(PACKAGE_V1!, 'inputs-invalid'));
      assert.throws(() => parseInput(stdinOf(c), ir, entry), (e: unknown) => e instanceof PackageError && e.code === 'INPUT_INVALID');
    });
  }
  test('黄金包中通过输入阶段的用例都被接受', () => {
    let n = 0;
    for (const f of ['b-credit-limit', 'a-decimal', 'a-inputs', 'a-multi-entry', 'b-alias', 'b-vocab-de', 'b-zh']) {
      for (const c of readCases(`packages/${f}.cases.json`)) {
        if (c.args[0] !== 'run' || ['USAGE', 'INPUT_INVALID', 'ENTRY_NOT_FOUND', 'PKG_UNTRUSTED_KID'].includes(c.code ?? '')) continue;
        if (c.stdin === undefined && c.stdinB64 === undefined) continue;
        const { ir, entry } = target(c, join(PACKAGE_V1!, 'packages'));
        parseInput(stdinOf(c), ir, entry);
        n++;
      }
    }
    assert.ok(n >= 20, `接受的用例数异常偏少：${n}`);
  });
} else {
  test('inputs-invalid', { skip }, () => {});
}

test('输入：顶层非对象、超安全整数、Decimal 为数字、Int 超 int32 都是 INPUT_INVALID', () => {
  const ir: IrView = {
    decls: [{ kind: 'Func', name: 'f', params: [{ name: 'n', type: { kind: 'TypeName', name: 'Int' } }, { name: 'd', type: { kind: 'TypeName', name: 'Decimal' } }] }],
  };
  const bad = (text: string): void =>
    assert.throws(() => parseInput(Buffer.from(text), ir, 'f'), (e: unknown) => e instanceof PackageError && e.code === 'INPUT_INVALID', text);
  bad('[]');
  bad('');
  bad('{"n":9007199254740993,"d":"1"}');
  bad('{"n":1,"d":1.5}');
  bad('{"n":2147483648,"d":"1"}');
  bad('{"n":1,"d":"1\\n"}');
  bad('{"n":1,"d":"1","n":2}');
  assert.deepEqual(parseInput(Buffer.from('{"n":7,"d":"1.50"}'), ir, 'f'), { n: 7n, d: '1.50' });
});
