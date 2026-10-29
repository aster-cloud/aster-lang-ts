/**
 * scripts/typecheck-cli.ts 与 scripts/repl.ts 的子进程级集成测试（#248）。
 *
 * 两个入口此前没有任何测试；这里按用户实际调用方式运行编译产物 dist/scripts/*.js，
 * 校验输出格式、退出码与名称解析（ADR 0051）拦截。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 编译后位于 dist/test/integration/scripts：上溯 4 级到仓库根
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TYPECHECK_CLI = path.join(ROOT, 'dist', 'scripts', 'typecheck-cli.js');
const REPL = path.join(ROOT, 'dist', 'scripts', 'repl.js');

const VALID = 'Module m.\n\nRule f given x as Int, produce Int:\n  Return x.\n';
/** y 未定义：解析通过，名称解析报 E802 */
const UNRESOLVED = 'Module m.\n\nRule f given x as Int, produce Int:\n  Return y.\n';
/** 返回类型不符：类型检查报 E003 */
const TYPE_ERROR = 'Module m.\n\nRule f given x as Int, produce Int:\n  Return "s".\n';

let dir = '';
const write = (name: string, content: string): string => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
};

function run(script: string, args: readonly string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: dir,
    encoding: 'utf8',
    input: options.input ?? '',
    env: { ...process.env, ...options.env },
    timeout: 30_000,
  });
}

interface Payload {
  source: string;
  diagnostics: { code: string; severity: string; message: string }[];
  summary: { total: number; error: number; warning: number; info: number };
}

/** stdout 必须是单个 JSON 文档（日志走 stderr） */
function payloadOf(r: SpawnSyncReturns<string>): Payload {
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout) as Payload;
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-cli-scripts-'));
});
after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('typecheck-cli', () => {
  it('合法程序：输出 JSON，无诊断', () => {
    const file = write('ok.aster', VALID);
    const p = payloadOf(run(TYPECHECK_CLI, [file]));
    assert.equal(p.source, file);
    assert.deepEqual(p.diagnostics, []);
    assert.deepEqual(p.summary, { total: 0, error: 0, warning: 0, info: 0 });
  });

  it('类型错误：报告诊断并汇总严重级别（退出码仍为 0，由调用方读 summary）', () => {
    const p = payloadOf(run(TYPECHECK_CLI, [write('type.aster', TYPE_ERROR)]));
    assert.deepEqual(p.diagnostics.map((d) => d.code), ['E003']);
    assert.equal(p.summary.error, 1);
  });

  it('★名称解析失败（E8xx）只报告名称解析诊断，不再对不可信的 Core 做类型检查', () => {
    const p = payloadOf(run(TYPECHECK_CLI, [write('unresolved.aster', UNRESOLVED)]));
    assert.deepEqual(p.diagnostics.map((d) => d.code), ['E802']);
    assert.match(p.diagnostics[0]!.message, /'y'/);
  });

  it('--filter-codes 只保留指定码（大小写不敏感）', () => {
    const file = write('filter.aster', TYPE_ERROR);
    assert.deepEqual(payloadOf(run(TYPECHECK_CLI, ['--filter-codes=e003', file])).diagnostics.map((d) => d.code), ['E003']);
    const none = payloadOf(run(TYPECHECK_CLI, ['--filter-codes=E999', file]));
    assert.deepEqual(none.diagnostics, []);
    assert.equal(none.summary.total, 0);
  });

  it('--help 打印用法并以 0 退出；缺少文件参数打印用法并以 2 退出', () => {
    const help = run(TYPECHECK_CLI, ['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /typecheck-cli\.js <file\.aster>/);
    const missing = run(TYPECHECK_CLI, []);
    assert.equal(missing.status, 2);
    assert.match(missing.stdout, /typecheck-cli\.js <file\.aster>/);
  });

  it('输入文件不存在、ASTER_CAPS 无法读取时以 1 退出并在 stderr 说明', () => {
    const noFile = run(TYPECHECK_CLI, [path.join(dir, 'nope.aster')]);
    assert.equal(noFile.status, 1);
    assert.match(noFile.stderr, /nope\.aster/);
    const badCaps = run(TYPECHECK_CLI, [write('caps.aster', VALID)], { env: { ASTER_CAPS: path.join(dir, 'missing-caps.json') } });
    assert.equal(badCaps.status, 1);
    assert.match(badCaps.stderr, /ASTER_CAPS/);
  });

  it('ASTER_CAPS 指向合法 manifest 时照常输出', () => {
    const caps = write('caps.json', JSON.stringify({ allow: {} }));
    const p = payloadOf(run(TYPECHECK_CLI, [write('caps-ok.aster', VALID)], { env: { ASTER_CAPS: caps } }));
    assert.equal(p.summary.error, 0);
  });
});

/** REPL：空行触发求值，所以每段输入必须没有内部空行 */
const replInput = (...chunks: string[]): string => `${chunks.join('\n\n')}\n\n:q\n`;
const COMPACT_VALID = 'Module m.\nRule f given x as Int, produce Int:\n  Return x.';
const COMPACT_UNRESOLVED = 'Module m.\nRule f given x as Int, produce Int:\n  Return y.';

describe('repl', () => {
  it('求值模块并输出 Core 伪代码，:q 正常退出', () => {
    const r = run(REPL, [], { input: replInput(COMPACT_VALID) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Aster REPL/);
    assert.match(r.stdout, /func f\(x: Int\): Int = \{\s+return x\s+\}/);
    assert.equal(r.stderr, '');
  });

  it(':f 切换为 JSON 输出', () => {
    const r = run(REPL, [], { input: `:f\n${replInput(COMPACT_VALID)}` });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Formatter: off/);
    assert.match(r.stdout, /"kind": "Module"/);
  });

  it('★名称解析失败（E8xx）报错且不输出 IR，之后的输入继续可用', () => {
    const r = run(REPL, [], { input: replInput(COMPACT_UNRESOLVED, COMPACT_VALID) });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /E802/);
    assert.match(r.stdout, /func f\(x: Int\): Int/);
    assert.equal((r.stdout.match(/func f/g) ?? []).length, 1, '出错的那段不应输出 IR');
  });

  it('词法错误按诊断格式输出位置', () => {
    const r = run(REPL, [], { input: replInput('Module m.\nRule g, produce Text:\n  Return "abc.') });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /L002/);
    assert.match(r.stderr, /3:10/);
  });

  it(':h 打印帮助；输入流结束（无 :q）也以 0 退出', () => {
    const r = run(REPL, [], { input: ':h\n' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /:f {2}toggle formatter output/);
  });
});
