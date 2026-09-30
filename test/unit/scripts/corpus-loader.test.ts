import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCorpusFrom, loadCorpus, corpusLoaderPath, CORPUS_PATH_ENV } from '../../../scripts/corpus-loader.js';

// ★issue #194：corpus-regression 工作流设置 ASTER_LANG_TEST_PATH，golden.ts 却静态
//   import npm 包，变量零读取。这里守住两件事：变量生效、生效与否可被察觉。
describe('corpus-loader：ASTER_LANG_TEST_PATH 必须生效且可验证', () => {
  const sample = (absPath: string) => ({ absPath, meta: { tier: 1 } });

  it('样本全部位于 checkout 之下 → 通过', () => {
    const root = path.join(os.tmpdir(), 'aster-lang-test');
    const mod = { listSamples: () => [sample(path.join(root, 'corpus', 'a.aster'))] } as never;
    assert.doesNotThrow(() => assertCorpusFrom(mod, root));
  });

  it('★样本来自别处（例如 node_modules 里的 npm 版本）→ 失败并指出来源', () => {
    const root = path.join(os.tmpdir(), 'aster-lang-test');
    const stray = path.join(os.tmpdir(), 'node_modules', 'pkg', 'corpus', 'a.aster');
    const mod = { listSamples: () => [sample(stray)] } as never;
    assert.throws(() => assertCorpusFrom(mod, root), new RegExp(`未生效.*${stray.replace(/[/\\]/g, '.')}`));
  });

  it('同名前缀目录不算「位于其下」', () => {
    const root = path.join(os.tmpdir(), 'aster-lang-test');
    const mod = { listSamples: () => [sample(`${root}-other${path.sep}a.aster`)] } as never;
    assert.throws(() => assertCorpusFrom(mod, root), /未生效/);
  });

  it('空样本集也视为未生效', () => {
    assert.throws(() => assertCorpusFrom({ listSamples: () => [] } as never, '/x'), /未生效/);
  });

  // ★issue #203：ESM loader 对模块路径 realpath，样本 absPath 是真实路径；root 若只
  //   path.resolve，经过任意一层符号链接就被误判「未生效」。两侧都按真实路径比较。
  it('★root 经符号链接、样本为真实路径（或反之）→ 通过', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-corpus-link-'));
    try {
      const real = path.join(base, 'real');
      fs.mkdirSync(path.join(real, 'corpus'), { recursive: true });
      const file = path.join(real, 'corpus', 'a.aster');
      fs.writeFileSync(file, '');
      const link = path.join(base, 'link');
      fs.symlinkSync(real, link);
      const viaReal = { listSamples: () => [sample(fs.realpathSync.native(file))] } as never;
      assert.doesNotThrow(() => assertCorpusFrom(viaReal, link));
      const viaLink = { listSamples: () => [sample(path.join(link, 'corpus', 'a.aster'))] } as never;
      assert.doesNotThrow(() => assertCorpusFrom(viaLink, real));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('★loadCorpus：变量指向符号链接的 checkout → 生效，样本来自该 checkout', async () => {
    // 按 issue 复现步骤：把 npm 包的 loader 与语料复制成 checkout 布局，再经软链加载。
    const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@aster-cloud/aster-lang-test'))), '..');
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-corpus-checkout-'));
    try {
      const real = path.join(base, 'real');
      fs.cpSync(path.join(pkgRoot, 'corpus'), path.join(real, 'corpus'), { recursive: true });
      fs.mkdirSync(path.dirname(corpusLoaderPath(real)), { recursive: true });
      fs.copyFileSync(path.join(pkgRoot, 'dist', 'loader.js'), corpusLoaderPath(real));
      const link = path.join(base, 'link');
      fs.symlinkSync(real, link);
      const mod = await loadCorpus({ [CORPUS_PATH_ENV]: link });
      const samples = mod.listSamples();
      assert.ok(samples.length > 0);
      assert.ok(samples[0]!.absPath.startsWith(fs.realpathSync.native(real) + path.sep));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('未设置变量 → 回退到 npm 依赖', async () => {
    const mod = await loadCorpus({});
    assert.equal(typeof mod.listSamples, 'function');
  });

  it('★变量指向没有 loader 产物的目录 → 失败并提示构建', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-corpus-missing-'));
    try {
      await assert.rejects(loadCorpus({ [CORPUS_PATH_ENV]: dir }), /pnpm run build/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
