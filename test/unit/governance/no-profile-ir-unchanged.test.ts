import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseSource, resolveAndLower, withInputRefs } from '../../../src/compile-pipeline.js';
import { returnsVerdict } from '../../../src/typecheck/governance.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';

// ADR 0046 §11 D2：inputRefs 只写入声明了档案的模块（Java NoProfileIrUnchangedTest 的对应物）。对 aster-lang-test
// 的 tier1 语料逐个编译：未声明档案的模块 IR 不含 inputRefs 键、标注步骤原样返回同一对象（IR 逐字节不变）；
// 声明档案的模块只有返回 Verdict 的规则带 inputRefs。语料须并列 checkout（CI 同 governance-check 的 W704 黄金）。

const LEXICONS: Readonly<Record<string, Lexicon>> = { 'zh-CN': ZH_CN, 'de-DE': DE_DE };

function asterFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...asterFiles(p));
    else if (name.endsWith('.aster')) out.push(p);
  }
  return out;
}

test('未声明档案的语料 IR 不含 inputRefs', (t) => {
  const corpus = [join(process.cwd(), '..', 'aster-lang-test', 'corpus'), join(process.cwd(), 'aster-lang-test', 'corpus')]
    .find((c) => existsSync(c));
  if (corpus === undefined) {
    assert.ok(!process.env.CI, 'CI 中须 checkout aster-lang-test（见 .github/workflows/ci.yml test job）');
    return t.skip('aster-lang-test 未并列 checkout');
  }
  let noProfile = 0;
  let profiled = 0;
  const leaked: string[] = [];
  for (const file of [...asterFiles(join(corpus, 'tier1-equivalence')), ...asterFiles(join(corpus, 'tier1-parity'))]) {
    const metaPath = file.replace(/\.aster$/, '.meta.json');
    const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) as { lexicon?: string; expect?: string } : {};
    if (meta.expect === 'reject') continue;
    let core;
    try {
      const parsed = parseSource(readFileSync(file, 'utf8'), meta.lexicon ? LEXICONS[meta.lexicon] : undefined);
      if (parsed.diagnostics.some((d) => d.severity === 'error')) continue;
      core = resolveAndLower(parsed.ast).core;
    } catch {
      continue; // 语法 / 名称解析失败的样本不产出 IR，与本断言无关
    }
    if (core.profile === undefined) {
      noProfile++;
      assert.equal(withInputRefs(core), core, file);
      if (JSON.stringify(core).includes('"inputRefs"')) leaked.push(file);
      continue;
    }
    profiled++;
    for (const d of core.decls) {
      if (d.kind === 'Func') assert.equal(d.inputRefs !== undefined, returnsVerdict(d), `${file} ${d.name}`);
    }
  }
  assert.ok(noProfile > 100, `纳入的无档案语料过少：${noProfile}`);
  assert.ok(profiled >= 2, `声明档案的语料过少：${profiled}`);
  assert.deepEqual(leaked, []);
});
