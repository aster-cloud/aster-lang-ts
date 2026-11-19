#!/usr/bin/env node
/**
 * 发布包 bin 冒烟：确认「plain npm i / npm i -g / npx -p」之后 package.json `bin` 的每个命令都能直接运行。
 *
 * verify-package.mjs 解开 tarball 后把本仓 node_modules 软链过去，看不到「依赖没被装上」这类问题：
 * 3.3.0 把 cac、ora、p-limit、tar、vscode-languageserver* 声明为 optional peer，npm 不装 optional peer，
 * `aster` 与 `aster-lsp` 一启动就 ERR_MODULE_NOT_FOUND。这里不借用本仓任何依赖，只装 tarball 本身：
 *   1. `npm pack --ignore-scripts` 打出与发布相同的 tarball；
 *   2. 库入口不可达 CLI/LSP 依赖：对每个 exports 入口用 esbuild（packages 外置）求模块图，
 *      cac/ora/p-limit/tar 不得出现；vscode-languageserver* 只允许出现在 ./lsp 系列入口。
 *      这些包是常规 dependencies，打包器按 import 图取模块，库消费者（Workers 等）的 bundle 因此不变；
 *   3. 在空临时目录 `npm i <tarball>`，逐个运行 bin：aster --help / version / verify（一致性夹具
 *      a-decimal 的 verify 用例，stdout 经真相源 normalize-stdout.mjs 归一后逐字节比较）、
 *      aster-core <policy.aster>、aster-convert --help、aster-lsp --stdio 完成一次 initialize 握手；
 *   4. `npm i -g --prefix <tmp>` 后运行 aster --help；
 *   5. `npx -p <tarball> aster --help`。
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

const problems = [];
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aster-ts-bins-')));

/** 子进程环境：去掉 pnpm/npm 运行脚本时注入的 npm_* 变量，避免影响临时目录里的 npm。 */
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k)));

function npm(args, cwd) {
  return execFileSync('npm', args, { cwd, env: cleanEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function pack() {
  const [info] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', tmp], root));
  return path.join(tmp, info.filename);
}

/** 裸包名（`@scope/name` 或 `name`），去掉子路径。 */
const packageNameOf = (spec) => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');

/** 第 2 步：每个 exports 入口的外部包闭包里不得含 CLI/LSP 依赖。 */
async function checkLibraryReachability(extracted) {
  for (const [sub, target] of Object.entries(pkg.exports ?? {})) {
    const file = typeof target === 'string' ? target : target.import;
    if (!file) continue;
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
    const forbidden = sub === './lsp' || sub.startsWith('./lsp/') ? CLI_ONLY : [...CLI_ONLY, ...LSP_ONLY];
    for (const name of forbidden) {
      if (reached.has(name)) problems.push(`exports '${sub}' 的模块图引入了 CLI/LSP 依赖 '${name}'（会进入库消费者的 bundle）`);
    }
  }
}

/** 运行一个命令，返回 { status, stdout, stderr }。 */
function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, env: cleanEnv, encoding: 'utf8', timeout: 120_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error?.message ?? '') };
}

function expectOk(label, r, check = () => true) {
  if (r.status === 0 && check(r.stdout)) {
    console.log(`  ✓ ${label}`);
    return;
  }
  const tail = (r.stderr || r.stdout).trim().split('\n').slice(0, 6).join('\n      ');
  problems.push(`${label} 失败（exit ${r.status}）：\n      ${tail}`);
}

/** aster-lsp --stdio：发 initialize，收到带 capabilities 的响应即通过。 */
function checkLsp(bin, cwd) {
  return new Promise((resolve) => {
    const child = spawn(bin, ['--stdio'], { cwd, env: cleanEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const done = (ok, why) => {
      clearTimeout(timer);
      child.kill();
      if (ok) console.log('  ✓ aster-lsp --stdio initialize');
      else problems.push(`aster-lsp --stdio initialize 失败：${why}\n      ${err.trim().split('\n').slice(0, 6).join('\n      ')}`);
      resolve();
    };
    const timer = setTimeout(() => done(false, '30 秒内无 initialize 响应'), 30_000);
    child.stdout.on('data', (b) => {
      out += b.toString('utf8');
      if (out.includes('"capabilities"')) done(true);
    });
    child.stderr.on('data', (b) => (err += b.toString('utf8')));
    child.on('exit', (code) => done(false, `进程提前退出（exit ${code}）`));
    child.stdin.on('error', () => {});
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } });
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

async function checkVerify(asterBin) {
  const fixtures = locatePackageV1();
  if (fixtures === undefined) {
    console.log('  - 跳过 aster verify：本地没有兄弟仓 aster-lang-test');
    return;
  }
  const packagesDir = path.join(fixtures, 'packages');
  const { cases } = JSON.parse(fs.readFileSync(path.join(packagesDir, 'a-decimal.cases.json'), 'utf8'));
  const c = cases.find((x) => x.name === 'verify');
  const { normalizeStdout } = await import(pathToFileURL(path.join(fixtures, 'normalize-stdout.mjs')).href);
  const r = run(asterBin, c.args, packagesDir);
  if (r.status === c.expectedExit && normalizeStdout(r.stdout) === c.expectedStdout) console.log(`  ✓ aster ${c.args.join(' ')}`);
  else problems.push(`aster ${c.args.join(' ')} 与夹具不符（exit ${r.status}，期望 ${c.expectedExit}）：\n      ${(r.stderr || r.stdout).trim().split('\n').slice(0, 6).join('\n      ')}`);
}

/** 第 3 步：本地安装后逐个运行 bin。 */
async function checkLocalInstall(tarball) {
  const project = path.join(tmp, 'local');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"bin-smoke","private":true}\n');
  npm(['install', '--no-audit', '--no-fund', '--no-package-lock', tarball], project);
  console.log('npm i <tarball>：');
  const bin = (name) => path.join(project, 'node_modules', '.bin', name);
  for (const name of Object.keys(pkg.bin)) {
    if (!fs.existsSync(bin(name))) problems.push(`npm i 之后缺少 node_modules/.bin/${name}`);
  }
  expectOk('aster --help', run(bin('aster'), ['--help'], project), (s) => s.includes('Usage'));
  expectOk('aster version', run(bin('aster'), ['version'], project), (s) => {
    const v = JSON.parse(s);
    return v.cliVersion === pkg.version && v.trustAnchorKids.includes('export-2026-11a');
  });
  await checkVerify(bin('aster'));
  const policy = path.join(project, 'smoke.aster');
  fs.writeFileSync(policy, 'Module smoke.\n\nRule answer, produce Int:\n  Return 42.\n');
  expectOk('aster-core smoke.aster', run(bin('aster-core'), [policy], project), (s) => s.includes('"Module"'));
  expectOk('aster-convert --help', run(bin('aster-convert'), ['--help'], project));
  await checkLsp(bin('aster-lsp'), project);
}

/** 第 4 步：全局安装（隔离 prefix）。 */
function checkGlobalInstall(tarball) {
  const prefix = path.join(tmp, 'global');
  npm(['install', '-g', '--prefix', prefix, '--no-audit', '--no-fund', tarball], tmp);
  console.log('npm i -g <tarball>：');
  const binDir = process.platform === 'win32' ? prefix : path.join(prefix, 'bin');
  expectOk('aster --help（-g）', run(path.join(binDir, 'aster'), ['--help'], tmp), (s) => s.includes('Usage'));
}

/** 第 5 步：npx -p <tarball> aster --help（独立 npm cache，不命中先前的缓存）。 */
function checkNpx(tarball) {
  const cwd = path.join(tmp, 'npx');
  fs.mkdirSync(cwd);
  console.log('npx -p <tarball> aster：');
  const r = run('npx', ['--yes', '--cache', path.join(tmp, 'npx-cache'), '-p', tarball, 'aster', '--help'], cwd);
  expectOk('npx -p <tarball> aster --help', r, (s) => s.includes('Usage'));
}

try {
  const tarball = pack();
  const extracted = path.join(tmp, 'pkg');
  fs.mkdirSync(extracted);
  execFileSync('tar', ['-xzf', tarball, '-C', extracted, '--strip-components=1']);
  await checkLibraryReachability(extracted);
  await checkLocalInstall(tarball);
  checkGlobalInstall(tarball);
  checkNpx(tarball);
} catch (e) {
  problems.push(`冒烟中断：${e?.stderr?.toString?.().trim() || e?.message || e}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error(`::error::[verify-package-bins] ${pkg.name}@${pkg.version} bin 冒烟未通过：`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exitCode = 1;
} else {
  console.log(`[verify-package-bins] ${pkg.name}@${pkg.version}：库入口不含 CLI/LSP 依赖，${Object.keys(pkg.bin).join('、')} 在 plain install / -g / npx -p 下可运行 ✓`);
}
