/**
 * 包格式 1.1 的 CLI 编排（ADR 0059 修订 4 D5–D8；计划 T3 Step 1）：以 aster-lang-test 黄金包 display/packages/b-jingyesi
 * 断言 show 的 stdout 与 stderr 说明、run --display 的结果与 meta，以及 1.0 黄金包的 inspect / verify 输出不变。
 * 另断言两个引擎共享的拼写来源：ts 词法表的字面量关键词与运算符拼写等于 keyword-spellings.json。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCommand } from '../../../src/policy-package/cli.js';
import { OPERATOR_KINDS } from '../../../src/policy-package/alias-validate.js';
import { keywordSpellings, LITERAL_KINDS } from '../../../src/policy-package/display.js';
import { PACKAGE_V1, readCases } from '../../helpers/package-v1.js';

const skip = PACKAGE_V1 === undefined ? '本地未检出 aster-lang-test' : false;
const POEM = '床前明月光，\n疑是地上霜。\n举头望明月，\n低头思故乡。';

const ioWith = (stdin: string) => ({ stdin: async (): Promise<Uint8Array> => new TextEncoder().encode(stdin) });
const pkgDir = (): string => join(PACKAGE_V1!, 'display/packages');
const jwks = (): string[] => ['--jwks', join(PACKAGE_V1!, 'keys/test-jwks.json')];

test('keyword-spellings.json 与 ts 词法表一致（L6(c) / L7 的拼写来源，计划裁决 PR4）', () => {
  const doc = JSON.parse(readFileSync(join(process.cwd(), 'shared/layout-vectors/keyword-spellings.json'), 'utf8')) as {
    operatorKinds: string[];
    literalKinds: string[];
    locales: Record<string, { literal: string[]; operator: string[] }>;
  };
  assert.deepEqual([...OPERATOR_KINDS].sort(), [...doc.operatorKinds].sort());
  assert.deepEqual([...LITERAL_KINDS].sort(), [...doc.literalKinds].sort());
  for (const [locale, want] of Object.entries(doc.locales)) assert.deepEqual(keywordSpellings(locale), want, locale);
});

test('show：stdout 为原诗 + \\n，stderr 列出结构映射与字面量宏', { skip }, async () => {
  const r = await runCommand(['show', join(pkgDir(), 'b-jingyesi'), ...jwks()], ioWith(''));
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, `${POEM}\n`);
  const err = r.stderr.join('\n');
  assert.ok(err.includes('"，\\n" ⇐ "。\\n"'), err);
  assert.ok(err.includes('"" ⇐ " "'), err);
  assert.ok(err.includes('思故乡 → 静夜思'), err);
});

test('show --canonical 与 1.0 包上的 show：打印规范源码', { skip }, async () => {
  const canon = readFileSync(join(pkgDir(), 'b-jingyesi/policy/policy.aster'), 'utf8');
  const r = await runCommand(['show', join(pkgDir(), 'b-jingyesi'), '--canonical', ...jwks()], ioWith(''));
  assert.equal(r.stdout, `${canon}\n`);
  const legacy = join(PACKAGE_V1!, 'packages/b-credit-limit');
  const r2 = await runCommand(['show', legacy, ...jwks()], ioWith(''));
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.stdout, `${readFileSync(join(legacy, 'policy/policy.aster'), 'utf8')}\n`);
  assert.ok(r2.stderr.join('\n').includes('无显示排版'));
});

test('run --display last-line-literal：值为 月光、matchesPackage false、coreIrSha256 null，stderr 先打印派生源码', { skip }, async () => {
  const edit = join(PACKAGE_V1!, 'display/edits/b-jingyesi/last-line-literal.txt');
  const r = await runCommand(['run', join(pkgDir(), 'b-jingyesi'), '--display', edit, '--input', '-', ...jwks()], ioWith('{}'));
  assert.equal(r.exitCode, 0, r.stderr.join('\n'));
  const env = JSON.parse(r.stdout) as { value: string; meta: { coreIrSha256: null; irRecompiled: boolean; display: { matchesPackage: boolean } } };
  assert.equal(env.value, '月光');
  assert.equal(env.meta.coreIrSha256, null);
  assert.equal(env.meta.irRecompiled, true);
  assert.equal(env.meta.display.matchesPackage, false);
  const i = r.stderr.findIndex((l) => l.includes('不在包签名覆盖之内'));
  assert.ok(i >= 0);
  assert.equal(r.stderr[i + 1], '床前 明月光。\n疑是 地上霜，举头 望明月：\n  低头 「月光」。\n');
});

test('1.0 黄金包：inspect 与 verify 的 stdout 与夹具逐字节相同（无 display 成员、无新检查项）', { skip }, async () => {
  const { normalizeStdout } = (await import(pathToFileURL(resolve(PACKAGE_V1!, 'normalize-stdout.mjs')).href)) as {
    normalizeStdout: (s: string) => string;
  };
  const cwd = join(PACKAGE_V1!, 'packages');
  const rows = readCases('packages/b-credit-limit.cases.json').filter((c) => (c.args[0] === 'inspect' || c.args[0] === 'verify') && c.code === null);
  assert.ok(rows.length >= 2);
  for (const c of rows) {
    // 位置参数（包路径）与 --jwks / --pubkey 的值是相对 cases 目录的路径
    const args = c.args.map((a, i) => (i === 1 || c.args[i - 1] === '--jwks' || c.args[i - 1] === '--pubkey' ? join(cwd, a) : a));
    const r = await runCommand(args, ioWith(''));
    assert.equal(normalizeStdout(r.stdout), c.expectedStdout, c.name);
    assert.ok(!r.stdout.includes('"display"'));
  }
});
