#!/usr/bin/env node
/**
 * 发布包冒烟（ADR 0053 修订 A2）：发布 run 不再跑全量测试后，确认「要发布的 npm tarball 本身」可用。
 *
 * 由 prepublishOnly 在 clean + build 之后调用，几秒钟：
 *   1. `npm pack --ignore-scripts` 打出与 publish 相同的 tarball（package.json `files` 决定内容）；
 *   2. `main` / `types` / `bin` / 每个 `exports` 条件指向的文件都在 tarball 里；
 *   3. tarball 内每个 .js 的相对 import（静态与动态）都解析到 tarball 内的文件——不允许引用包外的路径，
 *      例如兄弟仓 aster-lang-test 的语料 loader（ts 2.0.0 发布时发布流程因缺 loader 失败两次，
 *      ts#318 / ts#319；这里保证发出去的包本身不依赖任何兄弟仓产物）；
 *   4. 在仓外的临时目录解开 tarball，逐个 `import()` 无副作用的 exports 入口，确认模块图能加载。
 *      `./cli`、`./core`、`./lsp/server` 是可执行入口（导入即运行），只检查文件存在与第 3 条。
 *
 * 第 4 条借用本仓 node_modules，看不到「依赖没被 npm 装上」；bin 在空目录 plain install 后能否运行由
 * scripts/verify-package-bins.mjs 负责（CI package-v1 job）。
 *
 * 退出码：0 通过；1 不通过（打印全部问题）。
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
// 导入即执行的入口：只做存在性与相对 import 检查，不 import。
const EXECUTABLE_EXPORTS = new Set(['./cli', './core', './lsp/server', './runner']);

const problems = [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-ts-pack-'));

function pack() {
  const out = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', tmp], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const [info] = JSON.parse(out);
  return { tarball: path.join(tmp, info.filename), files: new Set(info.files.map(f => f.path)) };
}

/** package.json 里所有声明的入口：[描述, 相对路径]。 */
function declaredEntries() {
  const entries = [];
  const add = (label, p) => typeof p === 'string' && entries.push([label, p.replace(/^\.\//, '')]);
  add('main', pkg.main);
  add('types', pkg.types);
  for (const [name, p] of Object.entries(pkg.bin ?? {})) add(`bin ${name}`, p);
  for (const [sub, target] of Object.entries(pkg.exports ?? {})) {
    if (typeof target === 'string') add(`exports ${sub}`, target);
    else for (const [cond, p] of Object.entries(target)) add(`exports ${sub} [${cond}]`, p);
  }
  return entries;
}

/** 解析相对 specifier 到 tarball 内路径；解析不到返回 null。 */
function resolveInPackage(fromFile, spec, files) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.json`, `${base}/index.js`];
  return candidates.find(c => !c.startsWith('..') && files.has(c)) ?? null;
}

function checkRelativeImports(extracted, files) {
  for (const file of files) {
    if (!/\.(m?js)$/.test(file)) continue;
    const text = fs.readFileSync(path.join(extracted, file), 'utf8');
    const { importedFiles } = ts.preProcessFile(text, true, true);
    for (const { fileName: spec } of importedFiles) {
      if (!spec.startsWith('.')) continue;
      if (!resolveInPackage(file, spec, files)) problems.push(`${file} 导入的 '${spec}' 不在发布包内`);
    }
  }
}

async function importExports(extracted) {
  for (const [sub, target] of Object.entries(pkg.exports ?? {})) {
    if (EXECUTABLE_EXPORTS.has(sub)) continue;
    const file = typeof target === 'string' ? target : target.import;
    if (!file) continue;
    try {
      await import(pathToFileURL(path.join(extracted, file)).href);
    } catch (e) {
      problems.push(`import('${pkg.name}${sub === '.' ? '' : sub.slice(1)}') 失败：${e?.message ?? e}`);
    }
  }
}

try {
  const { tarball, files } = pack();
  for (const [label, p] of declaredEntries()) {
    if (!files.has(p)) problems.push(`${label} 指向的 ${p} 不在发布包内`);
  }
  // 解到仓外：相对路径逃逸不会意外命中仓内文件；依赖经 node_modules 软链解析到本仓已安装的依赖。
  const extracted = path.join(tmp, 'pkg');
  fs.mkdirSync(extracted);
  execFileSync('tar', ['-xzf', tarball, '-C', extracted, '--strip-components=1']);
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), 'dir');
  checkRelativeImports(extracted, files);
  await importExports(extracted);
  if (problems.length > 0) {
    console.error(`::error::[verify-package] ${pkg.name}@${pkg.version} 发布包冒烟未通过：`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log(`[verify-package] ${pkg.name}@${pkg.version}：${files.size} 个文件，入口与相对 import 齐全，exports 可加载 ✓`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
