import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, readdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PACKAGE_V1, readCases, type ConformanceCase } from '../helpers/package-v1.js';

/**
 * 包格式 v1 一致性用例的子进程运行器（ADR 0059 P1 T4 / T5）：遍历 aster-lang-test `conformance/package-v1/` 的
 * 全部 `packages/*.cases.json`、`tamper/cases.json`、`inputs-invalid/cases.json` 与 `tamper/test-time.json`，
 * 以 cases.json 所在目录为 cwd 运行 CLI，stdout 经真相源的 `normalize-stdout.mjs` 归一后逐字节比较，再比较退出码。
 */

/**
 * 真相源中已知有误、修正 PR 进行中的夹具（不为它们特判 CLI；修正合入后删除本表）：
 * - a-compiled-core-unreadable：期望的 meta.coreIrSha256 用了 base 包的哈希，应为被篡改 manifest 的 coreIr.sha256；
 * - b-position-free-hash-wrong：verify --recompile / --probes 应以 PKG_IR_DRIFT 失败，夹具期望通过。
 */
export const KNOWN_RED: ReadonlySet<string> = new Set([
  'a-compiled-core-unreadable (verify)',
  'a-compiled-core-unreadable (verify --recompile)',
  'a-compiled-core-unreadable (verify --probes)',
  'a-compiled-core-unreadable (inspect)',
  'b-position-free-hash-wrong (verify --recompile)',
  'b-position-free-hash-wrong (verify --probes)',
]);

interface RunResult {
  readonly stdout: string;
  readonly exit: number | null;
  readonly ms: number;
}

function runCli(cli: readonly string[], args: readonly string[], cwd: string, stdin: Buffer | undefined): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(process.execPath, [...cli, ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => out.push(b));
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout: Buffer.concat(out).toString('utf8'), exit: code, ms: performance.now() - start }));
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}

const stdinOf = (c: ConformanceCase): Buffer | undefined =>
  c.stdinB64 !== undefined ? Buffer.from(c.stdinB64, 'base64') : c.stdin !== undefined ? Buffer.from(c.stdin, 'utf8') : undefined;

interface TestTimeCase extends ConformanceCase {
  readonly recipe: {
    readonly copyPackage?: string;
    readonly add?: readonly { path: string; size: number }[];
    readonly copyZip?: string;
    readonly appendZeros?: number;
    readonly usePackage?: string;
  };
  readonly stdinRecipe?: { readonly prefix: string; readonly padding: number; readonly suffix: string };
}

/** 按 test-time.json 的配方在临时目录生成包，返回替换占位符后的参数与 stdin。 */
function materialize(c: TestTimeCase, tmp: string): { args: string[]; stdin: Buffer | undefined } {
  const root = resolve(PACKAGE_V1!);
  let pkg = '';
  if (c.recipe.copyPackage) {
    pkg = join(tmp, 'pkg');
    cpSync(join(root, c.recipe.copyPackage), pkg, { recursive: true });
    for (const f of c.recipe.add ?? []) {
      writeFileSync(join(pkg, f.path), '');
      truncateSync(join(pkg, f.path), f.size);
    }
  } else if (c.recipe.copyZip) {
    pkg = join(tmp, 'pkg.zip');
    cpSync(join(root, c.recipe.copyZip), pkg);
    appendFileSync(pkg, Buffer.alloc(c.recipe.appendZeros ?? 0));
  }
  const args = c.args.map((a) => a.replaceAll('<PKG>', pkg).replaceAll('<PACKAGE_V1>', root));
  const r = c.stdinRecipe;
  const stdin = r ? Buffer.concat([Buffer.from(r.prefix), Buffer.alloc(r.padding, 0x20), Buffer.from(r.suffix)]) : stdinOf(c);
  return { args, stdin };
}

/** 注册一组一致性用例测试。cli 为 node 之后的参数（脚本路径）。 */
export function defineConformanceSuite(label: string, cli: readonly string[]): void {
  if (PACKAGE_V1 === undefined) {
    test(`${label}：包格式 v1 一致性用例`, { skip: '本地未检出 aster-lang-test' }, () => {});
    return;
  }
  const root = PACKAGE_V1;
  const files = [
    ...readdirSync(join(root, 'packages')).filter((f) => f.endsWith('.cases.json')).map((f) => `packages/${f}`),
    'tamper/cases.json',
    'inputs-invalid/cases.json',
  ];
  test(`${label}：包格式 v1 一致性用例`, { concurrency: Math.max(2, availableParallelism()) }, async (t) => {
    const { normalizeStdout } = (await import(pathToFileURL(join(root, 'normalize-stdout.mjs')).href)) as {
      normalizeStdout: (s: string) => string;
    };
    let total = 0;
    for (const rel of files) {
      const cwd = dirname(join(root, rel));
      for (const c of readCases(rel)) {
        if (c.engines && !c.engines.includes('node')) continue;
        total++;
        const todo = KNOWN_RED.has(c.name) ? 'aster-lang-test 夹具待修（见 KNOWN_RED）' : undefined;
        void t.test(`${rel} › ${c.name}`, todo ? { todo } : {}, async () => {
          const r = await runCli(cli, c.args, cwd, stdinOf(c));
          assert.equal(normalizeStdout(r.stdout), c.expectedStdout);
          assert.equal(r.exit, c.expectedExit);
          if (c.code === 'TIMEOUT') assert.ok(r.ms < 2500, `TIMEOUT 用例耗时 ${Math.round(r.ms)} ms`);
        });
      }
    }
    for (const c of readCases('tamper/test-time.json') as TestTimeCase[]) {
      total++;
      void t.test(`tamper/test-time.json › ${c.name}`, async () => {
        const tmp = mkdtempSync(join(tmpdir(), 'aster-pkg-v1-'));
        try {
          const { args, stdin } = materialize(c, tmp);
          const r = await runCli(cli, args, join(root, 'tamper'), stdin);
          assert.equal(normalizeStdout(r.stdout), c.expectedStdout);
          assert.equal(r.exit, c.expectedExit);
        } finally {
          rmSync(tmp, { recursive: true, force: true });
        }
      });
    }
    assert.ok(total >= 400, `用例数异常偏少：${total}`);
  });
}
