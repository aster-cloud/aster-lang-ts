import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { StabilityGate } from '../../../src/stability/stability_gate.js';
import type { Core } from '../../../src/types.js';

/**
 * TS 侧 StabilityGate parity 断言：证明 TS 参考实现产出 == 共享 fixture。
 *
 * 与 aster-lang-core 的 StabilityGateParityTest（断言 Java 产出 == 同一 fixture）配对：
 *   TS == fixture ∧ Java == fixture ⟹ TS == Java（featureId + nodeKind 集）。
 * 若改 stability_gate.ts 改变检出而忘同步 fixture/Java 侧，此测试立即红。
 */

interface Fixture {
  name: string;
  src: string;
  features: string[];
  nodeKinds: string[];
}

interface FixtureFile {
  version: string;
  cases: Fixture[];
}

// 编译后测试从 dist/test/unit/stability/ 运行；fixture 是 test/fixtures 下的源文件（tsc
// 不复制 json）。从 dist 目录上溯到 dist 根，再到仓库根（dist 的父），进 test/fixtures。
const here = dirname(fileURLToPath(import.meta.url));
// here = <repo>/dist/test/unit/stability → 上溯 4 级到 <repo>。
const repoRoot = join(here, '..', '..', '..', '..');
const fixtures: FixtureFile = JSON.parse(
  readFileSync(join(repoRoot, 'test', 'fixtures', 'stability', 'stability-gate-fixtures.json'), 'utf8'),
);

function lower(src: string): Core.Module {
  return lowerModule(parse(lex(canonicalize(src))).ast);
}

describe('StabilityGate parity — TS 产出 == 共享 fixture', () => {
  it('fixture 非空（防 corpus 删除后假通过）', () => {
    assert.ok(fixtures.cases.length >= 8);
  });

  for (const f of fixtures.cases) {
    it(`${f.name}: featureId + nodeKind 集匹配 fixture`, () => {
      const diags = StabilityGate.scan(lower(f.src), { strict: false });
      const features = diags.map((d) => d.data.featureId).sort();
      const nodeKinds = diags.map((d) => d.data.nodeKind ?? '').sort();
      assert.deepEqual(features, [...f.features].sort());
      assert.deepEqual(nodeKinds, [...f.nodeKinds].sort());
    });
  }
});
