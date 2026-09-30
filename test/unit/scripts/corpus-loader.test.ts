import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertCorpusFrom, loadCorpus, CORPUS_PATH_ENV } from '../../../scripts/corpus-loader.js';

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
