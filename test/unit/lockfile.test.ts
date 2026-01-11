/**
 * lockfile.ts 单元测试
 */

import test from 'node:test';
import assert from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DependencyGraph } from '../../src/package/dependency-graph.js';
import type { ResolvedDependencies } from '../../src/package/resolver.js';
import {
  generateLockfile,
  parseLockfile,
  mergeLockfile,
  writeLockfile,
  type Lockfile,
} from '../../src/package/lockfile.js';

test('lockfile 测试套件', async (t) => {
  await t.test('生成lockfile后再解析应返回一致结果', () => {
    const resolved = buildResolved(
      [
        ['aster.http', '2.5.0'],
        ['aster.time', '1.5.3'],
      ],
      [['aster.http', 'aster.time']]
    );

    const lockfile = generateLockfile(resolved);
    const tempPath = join(tmpdir(), `test-aster-${Date.now()}.lock`);
    writeLockfile(lockfile, tempPath);

    const parsed = parseLockfile(tempPath);
    assert.ok(!(parsed instanceof Error));
    assert.deepStrictEqual(parsed, lockfile);
  });

  await t.test('合并新增依赖', () => {
    const existing: Lockfile = {
      version: '1.0',
      packages: {
        'aster.http': {
          version: '2.0.0',
          resolved: '',
        },
      },
    };

    const newDeps = buildResolved(
      [
        ['aster.http', '2.0.0'],
        ['aster.time', '1.5.3'],
      ],
      [['aster.http', 'aster.time']]
    );

    const merged = mergeLockfile(existing, newDeps);
    assert.strictEqual(Object.keys(merged.packages).length, 2);
    assert.ok(merged.packages['aster.http']);
    assert.ok(merged.packages['aster.time']);
  });

  await t.test('合并更新依赖', () => {
    const existing: Lockfile = {
      version: '1.0',
      packages: {
        'aster.http': {
          version: '2.0.0',
          resolved: '',
        },
      },
    };

    const newDeps = buildResolved([
      ['aster.http', '2.5.0'],
    ]);

    const merged = mergeLockfile(existing, newDeps);
    const updated = merged.packages['aster.http'];
    assert.ok(updated);
    assert.strictEqual(updated.version, '2.5.0');
  });

  await t.test('合并保留未变更的包', () => {
    const existing: Lockfile = {
      version: '1.0',
      packages: {
        'aster.http': {
          version: '2.5.0',
          resolved: '',
        },
        'aster.sql': {
          version: '1.0.0',
          resolved: '',
        },
      },
    };

    const newDeps = buildResolved([
      ['aster.http', '2.5.0'],
    ]);

    const merged = mergeLockfile(existing, newDeps);
    assert.strictEqual(Object.keys(merged.packages).length, 2);
    const sql = merged.packages['aster.sql'];
    assert.ok(sql);
    assert.strictEqual(sql.version, '1.0.0');
  });

  await t.test('解析不存在的文件应返回错误', () => {
    const result = parseLockfile('/tmp/non-existent-lockfile.json');
    assert.ok(result instanceof Error);
    assert.ok(result.message.includes('not found'));
  });

  await t.test('解析非法JSON应返回错误', () => {
    const tempPath = join(tmpdir(), `invalid-lock-${Date.now()}.json`);
    writeFileSync(tempPath, '{ invalid json }', 'utf-8');

    const result = parseLockfile(tempPath);
    assert.ok(result instanceof Error);
    assert.ok(result.message.includes('Invalid lockfile format'));
  });
});

function buildResolved(
  packages: Array<[string, string]>,
  edges: Array<[string, string]> = []
): ResolvedDependencies {
  const graph = new DependencyGraph();
  const versions = new Map(packages);

  for (const [name, version] of packages) {
    graph.addNode(name, version);
  }

  for (const [from, to] of edges) {
    const fromVersion = versions.get(from);
    const toVersion = versions.get(to);
    if (!fromVersion || !toVersion) {
      continue;
    }
    graph.addEdge(`${from}@${fromVersion}`, `${to}@${toVersion}`);
  }

  return {
    packages: new Map(packages),
    graph,
  };
}
