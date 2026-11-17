import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, parseTimeout } from '../../../src/policy-package/argv.js';
import { Readable } from 'node:stream';
import { probeMatches, readAll, runCommand } from '../../../src/policy-package/cli.js';
import { PackageError } from '../../../src/policy-package/errors.js';
import { positionFreeSha256 } from '../../../src/policy-package/obtain-ir.js';
import { PACKAGE_V1 } from '../../helpers/package-v1.js';

// 包格式 CLI 的命令行语法与 compile / version 子命令（一致性夹具不覆盖 compile，ADR 0059 P1 T4）。
const io = { stdin: async (): Promise<Uint8Array> => new Uint8Array(0) };
const usage = (argv: string[]): void =>
  assert.throws(() => parseArgs(argv), (e: unknown) => e instanceof PackageError && e.code === 'USAGE', argv.join(' '));

test('argv：选项两种写法、先后任意、开关、缺省超时', () => {
  const a = parseArgs(['run', '--entry=x', 'pkg', '--input', '-', '--allow-unsigned']);
  assert.equal(a.path, 'pkg');
  assert.equal(a.values.get('entry'), 'x');
  assert.equal(a.values.get('input'), '-');
  assert.ok(a.flags.has('allow-unsigned'));
  assert.equal(a.timeoutMs, 5000);
  assert.equal(parseArgs(['verify', 'p', '--timeout', '300000ms']).timeoutMs, 300_000);
  assert.equal(parseTimeout('2s'), 2000);
  // `--` 结束选项解析
  const dd = parseArgs(['run', '--input', '-', '--', '--weird-name']);
  assert.equal(dd.path, '--weird-name');
  assert.equal(parseArgs(['run', '--input=--', 'p']).values.get('input'), '--');
});

test('argv：重复、未知、缺值、开关带值、位置参数个数、run 缺 --input、超时语法都是 USAGE', () => {
  usage([]);
  usage(['frobnicate']);
  usage(['run', 'p', '--input', '-', '--input', 'x']);
  usage(['run', 'p', '--input', '-', '--nope']);
  usage(['run', 'p', '--input']);
  usage(['run', 'p', '--entry', '--input', '-']);
  usage(['run', 'p', '--input', '-', '--allow-unsigned=true']);
  usage(['run', '--input', '-']);
  usage(['run', 'a', 'b', '--input', '-']);
  usage(['run', 'p']);
  usage(['version', 'x']);
  usage(['inspect', 'p', '--entry', 'x']);
  usage(['run', 'p', '--input', '-', '--entry=']);
  usage(['run', 'p', '--input', '-', '--entry', '']);
  usage(['run', 'p', '--input', '-', '--entry', '--']);
  usage(['compile', 'x.aster', '--entry', 'e']);
  for (const t of ['0s', '1.5s', '01s', '5', '300001ms', '1s\n', '']) usage(['verify', 'p', '--timeout', t]);
});

test('version：一行规范 JSON，内置锚为空', async () => {
  const r = await runCommand(['version'], io);
  assert.equal(r.exitCode, 0);
  const v = JSON.parse(r.stdout) as Record<string, unknown>;
  assert.deepEqual(Object.keys(v), ['cliVersion', 'coreIrVersions', 'engine', 'formatVersions', 'toolchainId', 'trustAnchorKids']);
  assert.equal(v['engine'], 'aster-lang-ts-interpreter');
  assert.deepEqual(v['trustAnchorKids'], []);
  assert.ok(r.stdout.endsWith('}\n'));
});

test('compile <file.aster>：成功输出规范 IR；非法 aliasSet 为 COMPILE_ERROR；--out 写文件', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aster-compile-'));
  try {
    const src = join(dir, 'p.aster');
    writeFileSync(src, 'Module m.\n\nRule p given x as Int, produce Int:\n  Return x multiplied by 2.');
    writeFileSync(join(dir, 'ok.json'), '{"TIMES":["multiplied by"]}');
    writeFileSync(join(dir, 'bad.json'), '{"TIMES":["scaled"]}');
    writeFileSync(join(dir, 'unknown.json'), '{"NO_SUCH_KIND":["a b"]}');
    const ok = await runCommand(['compile', src, '--alias-set', join(dir, 'ok.json')], io);
    assert.equal(ok.exitCode, 0, ok.stderr.join('\n'));
    assert.match(ok.stdout, /^\{"decls":/);
    for (const f of ['bad.json', 'unknown.json']) {
      const bad = await runCommand(['compile', src, '--alias-set', join(dir, f)], io);
      assert.equal(bad.exitCode, 4, f);
      assert.equal((JSON.parse(bad.stdout) as { error: { code: string } }).error.code, 'COMPILE_ERROR');
    }
    // 无别名时 multiplied by 不是关键词 → 编译失败
    assert.equal((await runCommand(['compile', src], io)).exitCode, 4);
    const out = join(dir, 'core.json');
    const w = await runCommand(['compile', src, '--alias-set', join(dir, 'ok.json'), '--out', out], io);
    assert.equal(w.stdout, '');
    assert.equal(readFileSync(out, 'utf8') + '\n', ok.stdout);
    assert.equal((await runCommand(['compile', join(dir, 'missing.aster')], io)).exitCode, 2);
    // 前导 BOM 去掉一个后照常编译；非法 UTF-8 为 USAGE；只含 ASCII 空白为 COMPILE_ERROR
    writeFileSync(join(dir, 'bom.aster'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(src)]));
    assert.equal((await runCommand(['compile', join(dir, 'bom.aster'), '--alias-set', join(dir, 'ok.json')], io)).exitCode, 0);
    writeFileSync(join(dir, 'bad-utf8.aster'), Buffer.from([0x4d, 0xff, 0x0a]));
    assert.equal((await runCommand(['compile', join(dir, 'bad-utf8.aster')], io)).exitCode, 2);
    writeFileSync(join(dir, 'blank.aster'), ' \t\r\n');
    assert.equal((JSON.parse((await runCommand(['compile', join(dir, 'blank.aster')], io)).stdout) as { error: { code: string } }).error.code, 'COMPILE_ERROR');
    // --out 指向已存在的目录：编译之前即 USAGE
    assert.equal((await runCommand(['compile', src, '--alias-set', join(dir, 'ok.json'), '--out', dir], io)).exitCode, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compile <pkg>：按 manifest 编译，投影哈希等于 positionFreeSha256；包不接受 --locale', { skip: PACKAGE_V1 === undefined }, async () => {
  const jwks = join(PACKAGE_V1!, 'keys/test-jwks.json');
  for (const name of ['b-alias', 'b-zh', 'a-decimal']) {
    const pkg = join(PACKAGE_V1!, 'packages', name);
    const r = await runCommand(['compile', pkg, '--jwks', jwks], io);
    assert.equal(r.exitCode, 0, r.stderr.join('\n'));
    const manifest = JSON.parse(readFileSync(join(pkg, 'manifest.json'), 'utf8')) as { coreIr: { positionFreeSha256: string } };
    assert.equal(positionFreeSha256(r.stdout.slice(0, -1)), manifest.coreIr.positionFreeSha256, name);
  }
  const bad = await runCommand(['compile', join(PACKAGE_V1!, 'packages/b-alias'), '--locale', 'de-DE', '--jwks', jwks], io);
  assert.equal(bad.exitCode, 2);
  const unsigned = await runCommand(['compile', join(PACKAGE_V1!, 'packages/b-alias')], io);
  assert.equal((JSON.parse(unsigned.stdout) as { error: { code: string } }).error.code, 'PKG_UNTRUSTED_KID');
});

test('run（进程内，dist Worker 入口）：成功信封；factSources 为空时不提示 facts unverified', { skip: PACKAGE_V1 === undefined }, async () => {
  const r = await runCommand(['run', join(PACKAGE_V1!, 'packages/a-decimal'), '--input', '-', '--jwks', join(PACKAGE_V1!, 'keys/test-jwks.json')], {
    stdin: async () => Buffer.from('{"amount":"10"}'),
  });
  assert.equal(r.exitCode, 0, r.stderr.join('\n'));
  assert.match(r.stdout, /^\{"meta":\{"cliVersion":"[^"]+","coreIrSha256":"[0-9a-f]{64}","engine":"aster-lang-ts-interpreter","entry":"withTax","irRecompiled":false,"signed":true\},"ok":true,"value":"[0-9.]+"\}\n$/);
  assert.ok(!r.stderr.some((l) => l.startsWith('facts unverified')));
});

test('readAll：读到上限 + 1 字节即停止（超大 stdin 不整个读入）', async () => {
  const big = Readable.from((function* (): Generator<Buffer> {
    for (let i = 0; i < 40; i++) yield Buffer.alloc(1024 * 1024, 0x20);
  })());
  const got = await readAll(big);
  assert.equal(got.length, 16 * 1024 * 1024 + 1);
  assert.equal((await readAll(Readable.from([Buffer.from('{}')]))).length, 2);
  // 单个块远大于上限：只保留上限 + 1 字节，返回值不引用原缓冲
  const one = await readAll(Readable.from([Buffer.alloc(40 * 1024 * 1024, 0x20)]));
  assert.equal(one.length, 16 * 1024 * 1024 + 1);
  assert.equal(one.buffer.byteLength, one.length);
});

test('probeMatches：期望形状不完整或不可写出时判为不符，而不是抛异常', () => {
  const ok = { ok: true as const, valueJson: '1' };
  assert.equal(probeMatches({ ok: true, value: 1n }, ok), true);
  assert.equal(probeMatches({ ok: true }, ok), false);
  assert.equal(probeMatches({ ok: true, value: '\uD800' }, ok), false);
  assert.equal(probeMatches(null, ok), false);
  assert.equal(probeMatches({ code: 'EVAL_ERROR', ok: false }, { ok: false, code: 'EVAL_ERROR', message: '' }), true);
  assert.equal(probeMatches({ code: 'EVAL_ERROR', ok: false }, { ok: false, code: 'TIMEOUT', message: '' }), false);
});

test('求值开始前的安全看门狗：Worker 迟迟不发 started 时报 RESOURCE_EXHAUSTED，不挂住', async () => {
  const { evaluateInWorker } = await import('../../../src/policy-package/cli.js');
  const dir = mkdtempSync(join(tmpdir(), 'aster-watchdog-'));
  try {
    const stuck = join(dir, 'stuck.mjs');
    writeFileSync(stuck, 'setInterval(() => {}, 1000);\n');
    const start = performance.now();
    const r = await evaluateInWorker({ coreJson: '{}', entry: 'f', input: {} }, 5000, pathToFileURL(stuck), 300);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, 'RESOURCE_EXHAUSTED');
    assert.ok(performance.now() - start < 3000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
