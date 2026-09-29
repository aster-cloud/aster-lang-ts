import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import { prepareOutDir, GENERATED_MARKER } from '../../../src/cli/utils/out-dir.js';

// ★issue #196：`aster jvm --out <dir>` 对用户给的任意目录 rmSync(recursive, force)。
//   只有「cwd 之内 + 空目录或带生成标记」才可静默重建，其余必须 --force。
describe('prepareOutDir：只清空可证明为生成产物的目录', () => {
  let cwd: string;
  beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-outdir-')); });
  afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

  it('不存在的目录：创建并写入标记', () => {
    const abs = prepareOutDir('build/jvm-src', false, cwd);
    assert.equal(abs, path.join(cwd, 'build', 'jvm-src'));
    assert.ok(fs.existsSync(path.join(abs, GENERATED_MARKER)));
  });

  it('带标记的目录：静默清空重建', () => {
    const abs = prepareOutDir('out', false, cwd);
    fs.writeFileSync(path.join(abs, 'Old.java'), '');
    prepareOutDir('out', false, cwd);
    assert.deepEqual(fs.readdirSync(abs), [GENERATED_MARKER]);
  });

  it('空目录：静默重建', () => {
    fs.mkdirSync(path.join(cwd, 'empty'));
    assert.doesNotThrow(() => prepareOutDir('empty', false, cwd));
  });

  it('★cwd 内含用户文件且无标记：拒绝，文件必须原封不动', () => {
    const dir = path.join(cwd, 'data');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'important.txt'), 'keep');
    assert.throws(() => prepareOutDir('data', false, cwd), /--force/);
    assert.equal(fs.readFileSync(path.join(dir, 'important.txt'), 'utf8'), 'keep');
  });

  it('★cwd 之外的目录：即使为空也拒绝', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-outside-'));
    try {
      assert.throws(() => prepareOutDir(outside, false, cwd), /--force/);
      assert.ok(fs.existsSync(outside));
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('★cwd 本身：拒绝', () => {
    assert.throws(() => prepareOutDir('.', false, cwd), /--force/);
  });

  it('同名前缀的兄弟目录不算「在 cwd 内」', () => {
    const sibling = `${cwd}-sibling`;
    fs.mkdirSync(sibling);
    try {
      assert.throws(() => prepareOutDir(sibling, false, cwd), /--force/);
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });

  it('--force 时按用户意愿清空', () => {
    const dir = path.join(cwd, 'data');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'important.txt'), 'gone');
    prepareOutDir('data', true, cwd);
    assert.deepEqual(fs.readdirSync(dir), [GENERATED_MARKER]);
  });
});
