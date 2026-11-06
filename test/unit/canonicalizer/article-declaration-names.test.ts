/**
 * @module test/unit/canonicalizer/article-declaration-names.test
 *
 * 冠词删除不得吞掉声明名（`Define A has …`、`Rule a given …`）：声明关键词之后、
 * 且后面紧跟关键词的冠词就是声明名，按语法位置保护；其余位置的真冠词照常删除。
 * 夹具与 aster-lang-core 副本字节一致（共享夹具）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalize, compileAndTypecheck } from '../../../src/browser.js';

interface Fixture {
  readonly name: string;
  readonly source: string;
  readonly success: boolean;
  readonly errors: readonly string[];
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const fixtures = JSON.parse(
  readFileSync(join(repoRoot, 'test', 'fixtures', 'canonicalizer', 'article-declaration-names.json'), 'utf8')
) as { locale: string; cases: Fixture[] };

/** 源码里 `Define X` / `Rule X` 写下的声明名（去掉 Define 后的真冠词 `a Customer`）。 */
function declaredNames(source: string): string[] {
  return [...source.matchAll(/^(?:Define|Rule) (?:(?:a|an|the) (?=[A-Z]\w* (?:has|with)))?(\w+)/gm)].map((m) => m[1]!);
}

describe('冠词删除 vs 声明名（共享夹具）', () => {
  assert.equal(fixtures.locale, 'en-US');
  for (const c of fixtures.cases) {
    it(c.name, () => {
      const r = compileAndTypecheck(c.source);
      const errors = [...(r.parseErrors ?? []), ...(r.resolutionDiagnostics ?? []), ...r.typeErrors]
        .filter((d) => ((d as { severity?: string }).severity ?? 'error') === 'error')
        .map((d) => String(d.code));
      assert.deepEqual(errors, c.errors, canonicalize(c.source));
      assert.equal(errors.length === 0, c.success);
      if (!c.success) return;
      // 语义不漂移：Core 里的声明名与源码写下的一致（防止冠词被删后 `Rule given …` 静默得到函数 given）
      assert.deepEqual(r.core?.decls.map((d) => d.name), declaredNames(c.source));
    });
  }
});

describe('冠词删除：声明名位置以外的行为不变', () => {
  it('Define / Rule 后接名词时冠词仍删除', () => {
    assert.equal(canonicalize('Define a Customer has name as Text.'), 'Define Customer has name as Text.');
    assert.equal(canonicalize('define the User has a name.'), 'define User has name.');
  });

  it('Define / Rule 之外的冠词不受声明名保护', () => {
    assert.equal(canonicalize('Return a Decision with approved set to true.'), 'Return Decision with approved set to true.');
    assert.equal(canonicalize('Let x be the y has.'), 'Let x be y has.');
  });

  it('声明名保护不区分大小写，覆盖 A / An / The', () => {
    for (const art of ['A', 'An', 'The', 'a', 'an', 'the']) {
      assert.equal(canonicalize(`Define ${art} has score as Int.`), `Define ${art} has score as Int.`);
      assert.equal(canonicalize(`Rule ${art} given x as Int, produce Int:`), `Rule ${art} given x as Int, produce Int:`);
    }
  });
});
