/**
 * lossless golden 的真源是本仓 test/lossless/golden/；兄弟仓 aster-lang-test 的
 * corpus/tier3-fixtures/lossless/ 是它的镜像（落位规则同 aster-lang-test scripts/classify-existing.mjs 的 tier3：
 * 原样复制 .aster，并配同名 meta）。golden 改动后须同步镜像，否则本测试失败。
 * CI 的 test job 会 checkout aster-lang-test，因此 CI 中缺失即失败；仅本地未并列 checkout 时跳过。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 编译后从 dist/test/unit 运行：上溯 3 级到仓库根
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const goldenDir = join(repoRoot, 'test', 'lossless', 'golden');
const MIRROR = ['corpus', 'tier3-fixtures', 'lossless'];

function mirrorDir(): string | undefined {
  return [join(repoRoot, '..', 'aster-lang-test', ...MIRROR), join(repoRoot, 'aster-lang-test', ...MIRROR)]
    .find((c) => existsSync(c));
}

const asterFiles = (dir: string): string[] => readdirSync(dir).filter((n) => n.endsWith('.aster')).sort();

// 与 classify-existing.mjs 写 tier3 meta 的方式逐字节相同
function expectedMeta(name: string): string {
  const meta = { tier: 3, bucket: 'lossless', engines: ['ts'], lexicon: 'en-US', source: `aster-lang-ts/test/lossless/golden/${name}` };
  return JSON.stringify(meta, null, 2) + '\n';
}

test('lossless golden 与 aster-lang-test 镜像逐字节一致', (t) => {
  const mirror = mirrorDir();
  if (mirror === undefined) {
    assert.ok(!process.env.CI, 'CI 中须 checkout aster-lang-test（见 .github/workflows/ci.yml test job）');
    return t.skip('aster-lang-test 未并列 checkout');
  }
  const names = asterFiles(goldenDir);
  assert.deepEqual(asterFiles(mirror), names, '镜像的 .aster 文件集合须与 golden 相同');
  for (const name of names) {
    assert.ok(readFileSync(join(mirror, name)).equals(readFileSync(join(goldenDir, name))), `${name} 与 golden 不一致`);
    const metaPath = join(mirror, name.replace(/\.aster$/, '.meta.json'));
    assert.ok(existsSync(metaPath), `${name} 缺同名 meta`);
    assert.equal(readFileSync(metaPath, 'utf8'), expectedMeta(name), `${name} 的 meta 不符合落位规则`);
  }
});
