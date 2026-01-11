import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { create } from 'tar';
import type { Manifest } from '../../src/manifest.js';

/**
 * 在指定工作目录的 `.aster/local-registry` 下创建一个可供安装的 tarball。
 */
export async function seedLocalRegistryPackage(
  workspace: string,
  packageName: string,
  version: string,
  overrides?: Partial<Manifest>
): Promise<string> {
  const registryDir = join(workspace, '.aster', 'local-registry', packageName);
  await mkdir(registryDir, { recursive: true });

  const tempDir = await mkdtemp(join(tmpdir(), 'aster-cli-pkg-'));
  const manifest: Manifest = {
    name: overrides?.name ?? packageName,
    version: overrides?.version ?? version,
    dependencies: overrides?.dependencies ?? {},
    devDependencies: overrides?.devDependencies ?? {},
  };

  if (overrides?.effects) {
    manifest.effects = overrides.effects;
  }
  if (overrides?.capabilities) {
    manifest.capabilities = overrides.capabilities;
  }

  await writeFile(join(tempDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  await writeFile(join(tempDir, 'index.aster'), 'package pkg\nfunction main() {}\n', 'utf-8');

  const tarballPath = join(registryDir, `${version}.tar.gz`);
  await create(
    {
      gzip: true,
      cwd: tempDir,
      file: tarballPath,
    },
    ['manifest.json', 'index.aster']
  );

  await rm(tempDir, { recursive: true, force: true });
  return tarballPath;
}
