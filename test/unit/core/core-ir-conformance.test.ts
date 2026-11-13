import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../../src/browser.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import { HI_IN } from '../../../src/config/lexicons/hi-IN.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import { CoreIrFormatError, readCoreIr } from '../../../src/core/read-core-ir.js';
import { serializeCoreIr } from '../../../src/core/serialize-core-ir.js';
import { loadCorpus } from '../../../scripts/corpus-loader.js';

// ADR 0055 §3：ts 对语料的全部输出都必须通过 v2 schema 与不变式（与 core CoreIrSchemaConformanceTest 对应）。
// 语料取自 aster-lang-test（兄弟 checkout，缺失时退回 npm 快照，见 scripts/corpus-loader.ts）。
const LEXICONS: Readonly<Record<string, Lexicon>> = { 'en-US': EN_US, 'zh-CN': ZH_CN, 'de-DE': DE_DE, 'hi-IN': HI_IN };

test('corpus output conforms to Core IR v2 schema and invariants', async () => {
  const { listSamples } = await loadCorpus();
  const failures: string[] = [];
  let checked = 0;
  for (const sample of listSamples()) {
    if (sample.path.startsWith('tier1-reject/')) continue;
    const lexicon = LEXICONS[sample.meta.lexicon ?? 'en-US'];
    if (!lexicon) continue;
    const result = compile(sample.readSource(), { lexicon });
    if (!result.success || !result.core) continue;
    checked++;
    try {
      readCoreIr(serializeCoreIr(result.core));
    } catch (e) {
      const detail = e instanceof CoreIrFormatError ? JSON.stringify(e.problems.slice(0, 3)) : String(e);
      failures.push(`${sample.path}: ${e instanceof Error ? e.message : String(e)} ${detail}`);
    }
  }
  assert.ok(checked >= 300, `可编译样本异常偏少（${checked}）`);
  assert.deepEqual(failures, []);
});
