#!/usr/bin/env node
/**
 * 发布包 bin 冒烟：确认「默认安装」（plain npm i / npm i -g / npx -p）之后 package.json `bin` 的每个命令都能直接运行。
 *
 * verify-package.mjs 解开 tarball 后把本仓 node_modules 软链过去，看不到「依赖没被装上」这类问题：
 * 3.3.0 把 cac、ora、p-limit、tar、vscode-languageserver* 声明为 optional peer，npm 不装 optional peer，
 * `aster` 与 `aster-lsp` 一启动就 ERR_MODULE_NOT_FOUND。这里不借用本仓任何依赖与文件，只装 tarball 本身：
 *   1. `npm pack --ignore-scripts` 打出与发布相同的 tarball；
 *   2. 库入口不可达 CLI/LSP 依赖：递归展开每个 exports 入口的全部条件（import / require / default / browser /
 *      worker / node / 嵌套对象），对每个目标文件用 esbuild（packages 外置）求模块图：cac/ora/p-limit/tar 不得出现，
 *      vscode-languageserver* 只允许出现在 ./lsp 系列入口。这些包是常规 dependencies，打包器按 import 图取模块，
 *      库消费者（Workers 等）的 bundle 因此不变；
 *   3. 在空临时目录 `npm i <tarball>`，逐个运行 bin：aster --help / version / verify（一致性夹具 a-decimal 先复制进
 *      临时目录再跑，stdout 经真相源 normalize-stdout.mjs 归一后逐字节比较）、aster-core <policy.aster>、
 *      aster-convert --help、aster-lsp --stdio 完成一次 initialize 握手（按 Content-Length 分帧解析 JSON-RPC 响应）；
 *   4. `npm i -g --prefix <tmp>` 后运行 aster --help；
 *   5. `npx -p <tarball> aster --help`。
 *
 * 范围：只保证默认安装（含 optionalDependencies）。`npm i --omit=optional` 下 `aster` 仍会因静态 import 的
 * `openai` / `@anthropic-ai/sdk`（optionalDependencies）失败，另案处理，本脚本不覆盖。
 *
 * 一致性夹具取兄弟仓 aster-lang-test（本地 ../aster-lang-test，CI ./aster-lang-test）；CI 中缺失即失败，本地缺失只跳过 verify。
 * 需要访问 npm registry 安装依赖。退出码：0 通过；1 不通过（打印全部问题）。
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const CLI_ONLY = ['cac', 'ora', 'p-limit', 'tar'];
const LSP_ONLY = ['vscode-languageserver', 'vscode-languageserver-textdocument', 'vscode-languageserver-types'];
const isCi = (process.env.CI ?? '').trim() !== '' || process.env.GITHUB_ACTIONS === 'true';

export const problems = [];

/** 子进程环境：去掉 pnpm/npm 运行脚本时注入的 npm_* 变量，避免影响临时目录里的 npm。 */
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k)));

const firstLines = (s) => s.trim().split('\n').slice(0, 6).join('\n      ');

function npm(args, cwd) {
  return execFileSync('npm', args, { cwd, env: cleanEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function pack(dest) {
  const [info] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', dest], root));
  return path.join(dest, info.filename);
}

/** 裸包名（`@scope/name` 或 `name`），去掉子路径。 */
const packageNameOf = (spec) => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');

/**
 * 展开一个 exports 目标的全部条件分支，返回 [条件路径, 文件] 列表。
 * `types` 分支是 .d.ts，只含类型、不进 bundle，跳过；`null` 表示该条件下不导出，跳过。
 */
export function exportTargets(target, conds = []) {
  if (typeof target === 'string') return [[conds.join('.') || 'default', target]];
  if (Array.isArray(target)) return target.flatMap((t) => exportTargets(t, conds));
  if (target === null || typeof target !== 'object') return [];
  return Object.entries(target)
    .filter(([cond]) => cond !== 'types')
    .flatMap(([cond, t]) => exportTargets(t, [...conds, cond]));
}

/**
 * 第 2 步：每个 exports 入口、每个条件分支的外部包闭包里不得含 CLI/LSP 依赖。
 * 只跟踪字面量说明符（静态 import / export from、字面量 import()、require('x')）；
 * 计算出来的说明符（`import(name)`）esbuild 无法静态解析，不在此检查范围内。
 */
export async function checkLibraryReachability(extracted, exportsMap = pkg.exports ?? {}) {
  for (const [sub, target] of Object.entries(exportsMap)) {
    const forbidden = sub === './lsp' || sub.startsWith('./lsp/') ? CLI_ONLY : [...CLI_ONLY, ...LSP_ONLY];
    for (const [cond, file] of exportTargets(target)) {
      const { metafile } = await build({
        entryPoints: [path.join(extracted, file)],
        bundle: true,
        platform: 'node',
        format: 'esm',
        write: false,
        metafile: true,
        packages: 'external',
        logLevel: 'silent',
      });
      const reached = new Set();
      for (const input of Object.values(metafile.inputs)) {
        for (const im of input.imports) if (im.external) reached.add(packageNameOf(im.path));
      }
      for (const name of forbidden) {
        if (reached.has(name)) problems.push(`exports '${sub}' [${cond}] 的模块图引入了 CLI/LSP 依赖 '${name}'（会进入库消费者的 bundle）`);
      }
    }
  }
}

/** 运行一个命令，返回 { status, stdout, stderr }。 */
function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, env: cleanEnv, encoding: 'utf8', timeout: 120_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr || (r.error?.message ?? '') };
}

function expectOk(label, r, check = () => true) {
  let ok = false;
  try {
    ok = r.status === 0 && check(r.stdout);
  } catch {
    ok = false;
  }
  if (ok) console.log(`  ✓ ${label}`);
  else problems.push(`${label} 失败（exit ${r.status}）：\n      ${firstLines(r.stderr || r.stdout)}`);
}

/**
 * 从 LSP stdout 缓冲里取出完整的 Content-Length 分帧消息。
 * 返回 { messages, rest }；不完整的帧留在 rest 里等下一块数据。
 */
export function readLspFrames(buf) {
  const messages = [];
  let rest = buf;
  for (;;) {
    const headerEnd = rest.indexOf('\r\n\r\n');
    if (headerEnd < 0) break;
    const m = /Content-Length:\s*(\d+)/i.exec(rest.subarray(0, headerEnd).toString('ascii'));
    if (!m) throw new Error(`LSP 帧头缺少 Content-Length：${rest.subarray(0, headerEnd).toString('utf8')}`);
    const start = headerEnd + 4;
    const end = start + Number(m[1]);
    if (rest.length < end) break;
    messages.push(JSON.parse(rest.subarray(start, end).toString('utf8')));
    rest = rest.subarray(end);
  }
  return { messages, rest };
}

/** aster-lsp --stdio：发 initialize（id 1），等到 id 相同且带 result.capabilities 对象的响应即通过。 */
export function checkLsp(bin, cwd, label = 'aster-lsp --stdio initialize', timeoutMs = 30_000) {
  return new Promise((resolve) => {
    const REQUEST_ID = 1;
    let settled = false;
    let out = Buffer.alloc(0);
    let err = '';
    const child = spawn(bin, ['--stdio'], { cwd, env: cleanEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    // 只记录第一个结果：kill 触发的 exit、超时与响应之间可能竞争。
    const done = (ok, why) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (ok) console.log(`  ✓ ${label}`);
      else problems.push(`${label} 失败：${why}\n      ${firstLines(err)}`);
      resolve();
    };
    const timer = setTimeout(() => done(false, `${timeoutMs / 1000} 秒内无 initialize 响应`), timeoutMs);
    child.on('error', (e) => done(false, `无法启动：${e.message}`));
    child.on('exit', (code, signal) => done(false, `进程提前退出（exit ${code ?? signal}）`));
    child.stderr.on('data', (b) => (err += b.toString('utf8')));
    child.stdout.on('data', (b) => {
      let parsed;
      try {
        parsed = readLspFrames(Buffer.concat([out, b]));
      } catch (e) {
        done(false, `响应无法解析：${e.message}`);
        return;
      }
      out = parsed.rest;
      // 服务端可能先发通知（window/logMessage 等，无 id），只看对 initialize 的响应。
      const response = parsed.messages.find((msg) => msg.id === REQUEST_ID);
      if (response === undefined) return;
      const caps = response.result?.capabilities;
      if (caps !== null && typeof caps === 'object') done(true);
      else done(false, `initialize 响应缺少 result.capabilities：${JSON.stringify(response).slice(0, 200)}`);
    });
    child.stdin.on('error', () => {});
    const body = JSON.stringify({ jsonrpc: '2.0', id: REQUEST_ID, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  });
}

/** 一致性夹具目录；CI 缺失即失败，本地缺失返回 undefined。 */
function locatePackageV1() {
  const candidates = ['../aster-lang-test/conformance/package-v1', './aster-lang-test/conformance/package-v1'].map((c) => path.resolve(root, c));
  const found = candidates.find((c) => fs.existsSync(c));
  if (found === undefined && isCi) problems.push(`CI 中必须 checkout aster-lang-test（conformance/package-v1），以下路径均不存在：${candidates.join('、')}`);
  return found;
}

/**
 * aster verify：夹具（a-decimal 包、cases、keys、normalize-stdout.mjs）先复制进临时目录，按原布局在那里运行，
 * 不让 CLI 在本仓或兄弟仓目录里解析任何文件。
 */
async function checkVerify(asterBin, workDir) {
  const fixtures = locatePackageV1();
  if (fixtures === undefined) {
    console.log('  - 跳过 aster verify：本地没有兄弟仓 aster-lang-test');
    return;
  }
  const copy = path.join(workDir, 'package-v1');
  for (const rel of ['packages/a-decimal', 'packages/a-decimal.cases.json', 'keys', 'normalize-stdout.mjs']) {
    fs.cpSync(path.join(fixtures, rel), path.join(copy, rel), { recursive: true });
  }
  const packagesDir = path.join(copy, 'packages');
  const { cases } = JSON.parse(fs.readFileSync(path.join(packagesDir, 'a-decimal.cases.json'), 'utf8'));
  const c = cases.find((x) => x.name === 'verify');
  const { normalizeStdout } = await import(pathToFileURL(path.join(copy, 'normalize-stdout.mjs')).href);
  const r = run(asterBin, c.args, packagesDir);
  if (r.status === c.expectedExit && normalizeStdout(r.stdout) === c.expectedStdout) console.log(`  ✓ aster ${c.args.join(' ')}`);
  else problems.push(`aster ${c.args.join(' ')} 与夹具不符（exit ${r.status}，期望 ${c.expectedExit}）：\n      ${firstLines(r.stderr || r.stdout)}`);
}

/**
 * 解析已安装的 bin 路径；缺失时记一条问题并返回 undefined，调用方跳过运行。
 * 每个缺失的 bin 只记一次。
 */
export function binLocator(binDir, where) {
  const reported = new Set();
  return (name) => {
    const file = path.join(binDir, process.platform === 'win32' ? `${name}.cmd` : name);
    if (fs.existsSync(file)) return file;
    if (!reported.has(name)) {
      reported.add(name);
      problems.push(`${where} 之后缺少 bin '${name}'（${file}），跳过相关检查`);
    }
    return undefined;
  };
}

/** 第 3 步：本地安装后逐个运行 bin（已安装目录作参数，便于单独演练）。 */
export async function checkInstalledBins(project, binDir, where = 'npm i <tarball>') {
  const bin = binLocator(binDir, where);
  for (const name of Object.keys(pkg.bin)) bin(name);
  const aster = bin('aster');
  if (aster) {
    expectOk('aster --help', run(aster, ['--help'], project), (s) => s.includes('Usage'));
    expectOk('aster version', run(aster, ['version'], project), (s) => {
      const v = JSON.parse(s);
      return v.cliVersion === pkg.version && v.trustAnchorKids.includes('export-2026-11a');
    });
    await checkVerify(aster, project);
  }
  const core = bin('aster-core');
  if (core) {
    const policy = path.join(project, 'smoke.aster');
    fs.writeFileSync(policy, 'Module smoke.\n\nRule answer, produce Int:\n  Return 42.\n');
    expectOk('aster-core smoke.aster', run(core, [policy], project), (s) => s.includes('"Module"'));
  }
  const convert = bin('aster-convert');
  if (convert) expectOk('aster-convert --help', run(convert, ['--help'], project));
  const lsp = bin('aster-lsp');
  if (lsp) await checkLsp(lsp, project);
}

async function checkLocalInstall(tmp, tarball) {
  const project = path.join(tmp, 'local');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"bin-smoke","private":true}\n');
  npm(['install', '--no-audit', '--no-fund', '--no-package-lock', tarball], project);
  console.log('npm i <tarball>：');
  await checkInstalledBins(project, path.join(project, 'node_modules', '.bin'));
}

/** 第 4 步：全局安装（隔离 prefix）。 */
function checkGlobalInstall(tmp, tarball) {
  const prefix = path.join(tmp, 'global');
  npm(['install', '-g', '--prefix', prefix, '--no-audit', '--no-fund', tarball], tmp);
  console.log('npm i -g <tarball>：');
  const aster = binLocator(process.platform === 'win32' ? prefix : path.join(prefix, 'bin'), 'npm i -g <tarball>')('aster');
  if (aster) expectOk('aster --help（-g）', run(aster, ['--help'], tmp), (s) => s.includes('Usage'));
}

/** 第 5 步：npx -p <tarball> aster --help（独立 npm cache，不命中先前的缓存）。 */
function checkNpx(tmp, tarball) {
  const cwd = path.join(tmp, 'npx');
  fs.mkdirSync(cwd);
  console.log('npx -p <tarball> aster：');
  const r = run('npx', ['--yes', '--cache', path.join(tmp, 'npx-cache'), '-p', tarball, 'aster', '--help'], cwd);
  expectOk('npx -p <tarball> aster --help', r, (s) => s.includes('Usage'));
}

/** 汇报并设置退出码。 */
export function report() {
  if (problems.length > 0) {
    console.error(`::error::[verify-package-bins] ${pkg.name}@${pkg.version} bin 冒烟未通过：`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log(
      `[verify-package-bins] ${pkg.name}@${pkg.version}：库入口不含 CLI/LSP 依赖，` +
        `${Object.keys(pkg.bin).join('、')} 在默认安装（plain install / -g / npx -p）下可运行 ✓`,
    );
  }
}

async function main() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aster-ts-bins-')));
  try {
    const tarball = pack(tmp);
    const extracted = path.join(tmp, 'pkg');
    fs.mkdirSync(extracted);
    execFileSync('tar', ['-xzf', tarball, '-C', extracted, '--strip-components=1']);
    await checkLibraryReachability(extracted);
    await checkLocalInstall(tmp, tarball);
    checkGlobalInstall(tmp, tarball);
    checkNpx(tmp, tarball);
  } catch (e) {
    problems.push(`冒烟中断：${e?.stderr?.toString?.().trim() || e?.message || e}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  report();
}

// 直接运行时执行全部检查；被 import 时只导出各检查函数（供演练故意破坏的场景）。
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
