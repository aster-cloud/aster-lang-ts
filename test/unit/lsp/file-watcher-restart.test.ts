/**
 * 停止后立即重启监控器：上一轮仍在进行的扫描不得占住单飞行锁、发出本轮的 scan:end 或写入本轮快照。
 * 这正是 lsp-file-watcher 集成测试在负载下偶发"跟踪 0 个文件"的成因。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';

import { FileWatcher } from '../../../src/lsp/workspace/file-watcher.js';

async function workspaceWith(count: number): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'aster-watch-'));
  for (let i = 0; i < count; i++) await fs.writeFile(join(dir, `f${i}.aster`), `Module m${i}.\n`);
  return dir;
}

test('重启后的首个 scan:end 反映新工作区，而非上一轮残留扫描', async () => {
  const big = await workspaceWith(50);
  const small = await workspaceWith(2);
  const watcher = new FileWatcher({ mode: 'polling', enabled: true, pollingInterval: 60_000 });
  try {
    watcher.start([big]);
    // 上一轮扫描已在 readdir/stat 中挂起时停止并换到新工作区
    watcher.stop();
    const scanned = once(watcher.getEventEmitter(), 'scan:end');
    watcher.start([small]);
    await scanned;
    assert.equal(watcher.getStatus().trackedFiles, 2);
    // 残留扫描结束后也不得把旧工作区的文件写进本轮快照
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(watcher.getStatus().trackedFiles, 2);
  } finally {
    watcher.stop();
    await fs.rm(big, { recursive: true, force: true });
    await fs.rm(small, { recursive: true, force: true });
  }
});
