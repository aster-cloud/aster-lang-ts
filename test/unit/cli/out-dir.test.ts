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

  // ★issue #202：标记只由 prepareOutDir 写入，升级前的 aster jvm 与 emit-classfiles 都在
  //   build/jvm-src 生成过源码却没有标记；build/ 之下一律视为产物，否则默认目录首跑即失败。
  it('★build/ 之下无标记但有内容（升级前或其它脚本的产物）：静默重建', () => {
    const dir = path.join(cwd, 'build', 'jvm-src', 'com');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'A.java'), 'class A{}');
    const abs = prepareOutDir('build/jvm-src', false, cwd);
    assert.deepEqual(fs.readdirSync(abs), [GENERATED_MARKER]);
  });

  it('build 本身与同名前缀目录（build-x）不享受 build/ 之下的豁免', () => {
    for (const rel of ['build', 'build-x']) {
      fs.mkdirSync(path.join(cwd, rel), { recursive: true });
      fs.writeFileSync(path.join(cwd, rel, 'keep.txt'), 'keep');
      assert.throws(() => prepareOutDir(rel, false, cwd), /缺少生成标记/);
      assert.equal(fs.readFileSync(path.join(cwd, rel, 'keep.txt'), 'utf8'), 'keep');
    }
  });

  it('错误信息区分「不在 cwd 之下」与「缺少标记」', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-outside-'));
    try {
      assert.throws(
        () => prepareOutDir(outside, false, cwd),
        (e: Error) => /不在当前工作目录之下/.test(e.message) && !/标记/.test(e.message)
      );
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
    const dir = path.join(cwd, 'data');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'important.txt'), 'keep');
    assert.throws(
      () => prepareOutDir('data', false, cwd),
      (e: Error) => /缺少生成标记 \.aster-generated/.test(e.message) && !/不在当前工作目录/.test(e.message)
    );
  });

  it('--force 时按用户意愿清空', () => {
    const dir = path.join(cwd, 'data');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'important.txt'), 'gone');
    prepareOutDir('data', true, cwd);
    assert.deepEqual(fs.readdirSync(dir), [GENERATED_MARKER]);
  });
});
