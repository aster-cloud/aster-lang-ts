#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';
import cac from 'cac';

type Manifest = {
  name: string;
  version: string;
};

type BuildOptions = {
  packagesDir: string;
  registryDir: string;
  verbose: boolean;
};

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function readManifest(pkgDir: string): Promise<Manifest> {
  const manifestPath = path.join(pkgDir, 'manifest.json');
  const content = await fs.readFile(manifestPath, 'utf8');
  const data = JSON.parse(content) as Partial<Manifest>;
  if (!data.name || !data.version) {
    throw new Error(`包 ${pkgDir} 缺失 name 或 version 字段`);
  }
  return { name: data.name, version: data.version };
}

async function listPackageDirs(root: string): Promise<string[]> {
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) {
    throw new Error(`示例包目录 ${root} 不是合法目录`);
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter(item => item.isDirectory()).map(item => path.join(root, item.name)).sort();
}

async function validatePackageLayout(pkgDir: string): Promise<void> {
  const requiredEntries = ['manifest.json', 'README.md', 'src'];
  await Promise.all(
    requiredEntries.map(async entry => {
      const target = path.join(pkgDir, entry);
      await fs.access(target);
    }),
  );
}

async function tarPackage(pkgDir: string, manifest: Manifest, registryDir: string): Promise<string> {
  const targetDir = path.join(registryDir, manifest.name);
  await ensureDir(targetDir);
  const outputFile = path.join(targetDir, `${manifest.version}.tar.gz`);
  const entries = await fs.readdir(pkgDir);
  await tar.create({ gzip: true, cwd: pkgDir, file: outputFile }, entries);
  return outputFile;
}

async function buildAllPackages(options: BuildOptions): Promise<void> {
  const packageDirs = await listPackageDirs(options.packagesDir);
  if (packageDirs.length === 0) {
    console.warn(`目录 ${options.packagesDir} 未发现示例包，无需构建`);
    return;
  }
  console.log(`在 ${options.packagesDir} 中发现 ${packageDirs.length} 个示例包，开始构建...`);
  for (const pkgDir of packageDirs) {
    const manifest = await readManifest(pkgDir);
    await validatePackageLayout(pkgDir);
    const tarPath = await tarPackage(pkgDir, manifest, options.registryDir);
    if (options.verbose) {
      console.log(`  · 已打包 ${manifest.name}@${manifest.version} → ${tarPath}`);
    }
  }
  console.log(`示例包构建完成，产物位于 ${options.registryDir}`);
}

async function main(): Promise<void> {
  const cli = cac('build-example-packages');
  cli
    .option('--packages <dir>', '示例包根目录，默认 examples/packages')
    .option('--registry <dir>', '输出的本地注册表目录，默认 .aster/local-registry')
    .option('--verbose', '输出详细日志', { default: false });
  const parsed = cli.parse();
  const packagesDir = path.resolve(parsed.options.packages ?? path.join(process.cwd(), 'examples', 'packages'));
  const registryDir = path.resolve(parsed.options.registry ?? path.join(process.cwd(), '.aster', 'local-registry'));
  const verbose = Boolean(parsed.options.verbose);
  try {
    await ensureDir(registryDir);
    await buildAllPackages({ packagesDir, registryDir, verbose });
  } catch (error) {
    console.error('示例包构建失败：', error);
    process.exitCode = 1;
  }
}

void main();
