import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PACKAGE_V1, readCases, type ConformanceCase } from '../helpers/package-v1.js';

/**
 * 包格式 v1 一致性用例的子进程运行器（ADR 0059 P1 T4 / T5）：遍历 aster-lang-test `conformance/package-v1/` 的
 * 全部 `packages/*.cases.json`、`tamper/cases.json`、`inputs-invalid/cases.json`、`compile/cases.json` 与 `tamper/test-time.json`，
 * 以 cases.json 所在目录为 cwd 运行 CLI，stdout 经真相源的 `normalize-stdout.mjs` 归一后逐字节比较，再比较退出码。
 * `compile` 的成功用例按 `expectedPositionFreeSha256` 比较投影哈希（两侧 IR 只差 origin 列，修订 1 A2）。
 */

interface RunResult {
  readonly stdout: string;
  readonly exit: number | null;
  readonly ms: number;
}

function runCli(
  cli: readonly string[],
  args: readonly string[],
  cwd: string,
  stdin: Buffer | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(process.execPath, [...cli, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
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

/** 与参照实现相同的投影哈希（只删 origin.start.col / end.col，规范 JSON 后取 SHA-256）。 */
async function positionFreeOf(coreJson: string): Promise<string> {
  const { positionFreeSha256 } = await import('../../src/policy-package/obtain-ir.js');
  return positionFreeSha256(coreJson);
}

interface HttpsRoute {
  readonly status: number;
  readonly file?: string;
  readonly zeros?: number;
  readonly jwksPaddedTo?: number;
  readonly location?: string;
  readonly body?: string;
  readonly headers?: Record<string, string>;
  readonly contentEncoding?: string;
}

interface TestTimeCase extends ConformanceCase {
  readonly recipe: {
    readonly copyPackage?: string;
    readonly add?: readonly { path: string; size: number }[];
    readonly addDirs?: readonly string[];
    readonly copyZip?: string;
    readonly appendZeros?: number;
    readonly usePackage?: string;
    readonly httpsServer?: { readonly routes: Readonly<Record<string, HttpsRoute>> };
    readonly env?: Readonly<Record<string, string>>;
  };
  readonly stdinRecipe?: { readonly prefix: string; readonly padding: number; readonly suffix: string };
}

interface CompileCase extends Omit<ConformanceCase, 'expectedStdout'> {
  readonly expectedStdout?: string | null;
  readonly expectedPositionFreeSha256?: string;
  readonly outFile?: string;
  readonly outFileMustNotExist?: boolean;
  /** 夹具标注的已知引擎分歧（期望取平台 Java 结果，ts 编译器尚未对齐），值为跟踪 issue */
  readonly knownEngineDivergence?: string;
}

/** 自签名测试证书（CN / SAN 为 localhost 与 127.0.0.1），全部 https 用例共用一份。 */
let testCert: { key: Buffer; cert: Buffer; pemPath: string } | undefined;
function certificate(): { key: Buffer; cert: Buffer; pemPath: string } {
  if (testCert) return testCert;
  const dir = mkdtempSync(join(tmpdir(), 'aster-anchor-ca-'));
  const gen = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'),
  ]);
  assert.equal(gen.status, 0, `openssl 生成测试证书失败：${String(gen.stderr)}`);
  testCert = { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')), pemPath: join(dir, 'cert.pem') };
  return testCert;
}

/** 按配方起一个只服务本用例的 127.0.0.1 https 服务。 */
async function startHttps(root: string, routes: Readonly<Record<string, HttpsRoute>>): Promise<{ server: Server; port: number }> {
  const { key, cert } = certificate();
  const jwks = readFileSync(join(root, 'keys/test-jwks.json'));
  let port = 0;
  const server = createServer({ key, cert }, (req, res) => {
    const r = routes[req.url ?? ''];
    if (!r) return void res.writeHead(404).end();
    const headers: Record<string, string> = { ...(r.headers ?? {}) };
    if (r.contentEncoding) headers['content-encoding'] = r.contentEncoding;
    if (r.location) return void res.writeHead(r.status, { ...headers, location: r.location.replaceAll('<PORT>', String(port)) }).end();
    if (r.file) return void res.writeHead(r.status, headers).end(readFileSync(join(root, r.file)));
    if (r.zeros) return void res.writeHead(r.status, headers).end(Buffer.alloc(r.zeros, 0x20));
    if (r.jwksPaddedTo) return void res.writeHead(r.status, headers).end(Buffer.concat([jwks, Buffer.alloc(r.jwksPaddedTo - jwks.length, 0x20)]));
    return void res.writeHead(r.status, headers).end(r.body ?? '');
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  port = (server.address() as { port: number }).port;
  return { server, port };
}

/** 运行时生成的夹具：在临时目录按配方生成包 / 输入 / https 服务，替换占位符后运行。 */
async function runTestTimeCase(cli: readonly string[], root: string, c: TestTimeCase, tmp: string): Promise<RunResult> {
  let pkg = '';
  const recipe = c.recipe;
  if (recipe.copyPackage) {
    pkg = join(tmp, 'pkg');
    cpSync(join(root, recipe.copyPackage), pkg, { recursive: true });
    for (const d of recipe.addDirs ?? []) mkdirSync(join(pkg, d), { recursive: true });
    for (const f of recipe.add ?? []) {
      mkdirSync(dirname(join(pkg, f.path)), { recursive: true });
      writeFileSync(join(pkg, f.path), '');
      truncateSync(join(pkg, f.path), f.size);
    }
  } else if (recipe.copyZip) {
    pkg = join(tmp, 'pkg.zip');
    cpSync(join(root, recipe.copyZip), pkg);
    appendFileSync(pkg, Buffer.alloc(recipe.appendZeros ?? 0));
  }
  const server = recipe.httpsServer ? await startHttps(root, recipe.httpsServer.routes) : undefined;
  try {
    const sub = (s: string): string =>
      s.replaceAll('<PKG>', pkg).replaceAll('<PACKAGE_V1>', root).replaceAll('<PORT>', String(server?.port ?? 0)).replaceAll('<CA_PEM>', server ? certificate().pemPath : '');
    const args = c.args.map(sub);
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env['ASTER_ANCHOR_CA_FILE'];
    for (const [k, v] of Object.entries(recipe.env ?? {})) env[k] = sub(v);
    const r = c.stdinRecipe;
    const stdin = r ? Buffer.concat([Buffer.from(r.prefix), Buffer.alloc(r.padding, 0x20), Buffer.from(r.suffix)]) : stdinOf(c);
    return await runCli(cli, args, join(root, 'tamper'), stdin, env);
  } finally {
    server?.server.close();
  }
}

/** 注册一组一致性用例测试。cli 为 node 之后的参数（脚本路径）。 */
export function defineConformanceSuite(label: string, cli: readonly string[]): void {
  if (PACKAGE_V1 === undefined) {
    test(`${label}：包格式 v1 一致性用例`, { skip: '本地未检出 aster-lang-test' }, () => {});
    return;
  }
  const root = resolve(PACKAGE_V1);
  const files = [
    ...readdirSync(join(root, 'packages')).filter((f) => f.endsWith('.cases.json')).map((f) => `packages/${f}`),
    'tamper/cases.json',
    'inputs-invalid/cases.json',
  ];
  const timeoutCases: { rel: string; cwd: string; c: ConformanceCase }[] = [];
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
        // TIMEOUT 用例要量墙钟，放到并发用例之后单独串行跑（见下方「超时用例」测试）
        if (c.code === 'TIMEOUT') {
          timeoutCases.push({ rel, cwd, c });
          continue;
        }
        void t.test(`${rel} › ${c.name}`, async () => {
          const r = await runCli(cli, c.args, cwd, stdinOf(c));
          assert.equal(normalizeStdout(r.stdout), c.expectedStdout);
          assert.equal(r.exit, c.expectedExit);
        });
      }
    }
    if (existsSync(join(root, 'compile/cases.json'))) {
      for (const c of readCases('compile/cases.json') as unknown as CompileCase[]) {
        total++;
        // 夹具自身标注的已知引擎分歧（如 aster-cloud/aster-lang-ts#348）按 todo 运行：不特判 CLI，issue 修复后自动转绿
        const todo = c.knownEngineDivergence ? `已知引擎分歧 ${c.knownEngineDivergence}` : undefined;
        void t.test(`compile/cases.json › ${c.name}`, todo ? { todo } : {}, async () => {
          const tmp = mkdtempSync(join(tmpdir(), 'aster-compile-out-'));
          try {
            const outPath = join(tmp, 'out', 'core.json');
            mkdirSync(dirname(outPath));
            const args = c.args.map((a) => a.replaceAll('<OUT>', outPath));
            const r = await runCli(cli, args, join(root, 'compile'), stdinOf(c as unknown as ConformanceCase));
            assert.equal(r.exit, c.expectedExit, r.stdout);
            if (c.expectedPositionFreeSha256 !== undefined) {
              const ir = c.outFile !== undefined ? readFileSync(outPath, 'utf8') : r.stdout.slice(0, -1);
              if (c.outFile === undefined) assert.ok(r.stdout.endsWith('\n') && !ir.includes('\n'), 'stdout 应为一行 IR');
              assert.equal(await positionFreeOf(ir), c.expectedPositionFreeSha256);
            }
            if (typeof c.expectedStdout === 'string') assert.equal(normalizeStdout(r.stdout), c.expectedStdout);
            if (c.outFileMustNotExist) {
              assert.equal(existsSync(outPath), false, '--out 目标不应被创建');
              assert.deepEqual(readdirSync(dirname(outPath)), [], '--out 目录中不应留下临时文件');
            }
          } finally {
            rmSync(tmp, { recursive: true, force: true });
          }
        });
      }
    }
    for (const c of readCases('tamper/test-time.json') as TestTimeCase[]) {
      total++;
      void t.test(`tamper/test-time.json › ${c.name}`, async () => {
        const tmp = mkdtempSync(join(tmpdir(), 'aster-pkg-v1-'));
        try {
          const r = await runTestTimeCase(cli, root, c, tmp);
          assert.equal(normalizeStdout(r.stdout), c.expectedStdout);
          assert.equal(r.exit, c.expectedExit);
        } finally {
          rmSync(tmp, { recursive: true, force: true });
        }
      });
    }
    assert.ok(total >= 400, `用例数异常偏少：${total}`);
  });
  test(`${label}：超时用例（串行，--timeout 1s 时进程墙钟在 [0.9 s, 2.5 s)）`, async (t) => {
    const { normalizeStdout } = (await import(pathToFileURL(join(root, 'normalize-stdout.mjs')).href)) as {
      normalizeStdout: (s: string) => string;
    };
    assert.ok(timeoutCases.length > 0, '没有 TIMEOUT 用例');
    for (const { rel, cwd, c } of timeoutCases) {
      await t.test(`${rel} › ${c.name}`, async () => {
        const r = await runCli(cli, c.args, cwd, stdinOf(c));
        assert.equal(normalizeStdout(r.stdout), c.expectedStdout);
        assert.equal(r.exit, c.expectedExit);
        // 下界防止计时器提前触发（例如误用了更小的值）；上界防止挂住。超时值取自用例参数
        const limit = c.args.find((a, i) => c.args[i - 1] === '--timeout') ?? c.args.find((a) => a.startsWith('--timeout='))?.slice(10);
        assert.equal(limit, '1s', 'TIMEOUT 用例应为 --timeout 1s');
        assert.ok(r.ms >= 900, `TIMEOUT 用例过早结束：${Math.round(r.ms)} ms`);
        assert.ok(r.ms < 2500, `TIMEOUT 用例耗时 ${Math.round(r.ms)} ms`);
      });
    }
  });
}

