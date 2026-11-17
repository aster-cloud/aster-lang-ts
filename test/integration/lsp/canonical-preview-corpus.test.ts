/**
 * `aster/canonicalPreview` 忠实性验收（ADR 0058 §8.2）：对 vocab-de / vocab-zh / vocab-hi 语料与 jingyesi、sherlock 示例，
 * 「不带词汇编译预览文本」与「带词汇编译源码」的 Core IR（去掉 origin）深等。
 * 每个样本单独一条用例，不一致者逐个失败，不设豁免。
 *
 * vocab-* 取自 aster-lang-test（scripts/corpus-loader.ts 的 loadCorpus）；
 * jingyesi、sherlock 是本仓库 examples/ 下的方言示例，lexicon 与词汇按各自 .mjs 原样复刻。
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from '../../../src/browser.js';
import { buildCanonicalPreview } from '../../../src/lsp/canonical-preview.js';
import { parseDocumentWith } from '../../../src/lsp/parse-document.js';
import { buildVocabularyScopes } from '../../../src/config/lexicons/identifiers/scopes.js';
import type { DomainVocabulary } from '../../../src/config/lexicons/identifiers/types.js';
import { SemanticTokenKind as K } from '../../../src/config/token-kind.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { HI_IN } from '../../../src/config/lexicons/hi-IN.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import { loadCorpus } from '../../../scripts/corpus-loader.js';

interface Case {
  readonly name: string;
  readonly source: string;
  readonly lexicon: Lexicon;
  readonly vocabulary: DomainVocabulary;
}

const LEXICONS: Readonly<Record<string, Lexicon>> = { 'en-US': EN_US, 'de-DE': DE_DE, 'zh-CN': ZH_CN, 'hi-IN': HI_IN };

/** 各语言语料目录与最少样本数（防止语料缺失或检出过旧时静默通过） */
const VOCAB_DIRS: Readonly<Record<string, number>> = { 'vocab-de': 16, 'vocab-zh': 8, 'vocab-hi': 3 };

/** 递归去掉 origin（位置信息不参与比较：预览改变了行内长度）。 */
function stripOrigin(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripOrigin);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>).filter(([k]) => k !== 'origin').map(([k, v]) => [k, stripOrigin(v)])
  );
}

function emptyVocabulary(id: string, locale: string): DomainVocabulary {
  return { id, name: id, locale, version: '1.0.0', structs: [], fields: [], functions: [], enumValues: [], literals: [] } as DomainVocabulary;
}

/** examples/jingyesi/jingyesi.mjs 的方言与词汇。 */
const JINGYESI_LEXICON = {
  ...ZH_CN, id: 'jingyesi', name: '静夜思',
  aliases: { [K.MODULE_DECL]: ['床前'], [K.FUNC_TO]: ['疑是'], [K.FUNC_PRODUCE]: ['举头'], [K.RETURN]: ['低头'] },
} as Lexicon;
const JINGYESI_VOCAB = {
  ...emptyVocabulary('jingyesi', 'jingyesi'),
  name: '静夜思',
  structs: [{ localized: '望明月', canonical: 'Text', kind: 'struct' }],
  literals: [{ localized: '思故乡', canonical: '静夜思', kind: 'literal' }],
} as DomainVocabulary;

/** examples/sherlock/sherlock.mjs 的方言（无领域词汇）。 */
const SHERLOCK_LEXICON = {
  ...ZH_CN, id: 'sherlock', name: '福尔摩斯',
  aliases: {
    [K.MODULE_DECL]: ['探案笔记'], [K.FUNC_TO]: ['推断'], [K.FUNC_GIVEN]: ['已知'],
    [K.IF]: ['若'], [K.RETURN]: ['凶手即'], [K.AND]: ['且'],
  },
} as Lexicon;

const EXAMPLES: readonly Case[] = [
  { name: 'examples/jingyesi', source: readFileSync(resolve('examples/jingyesi/jingyesi.aster'), 'utf8'), lexicon: JINGYESI_LEXICON, vocabulary: JINGYESI_VOCAB },
  { name: 'examples/sherlock', source: readFileSync(resolve('examples/sherlock/sherlock.aster'), 'utf8'), lexicon: SHERLOCK_LEXICON, vocabulary: emptyVocabulary('sherlock', 'sherlock') },
];

async function vocabCases(dir: string): Promise<Case[]> {
  const { listSamples } = await loadCorpus();
  return listSamples()
    .filter((s) => s.path.startsWith(`tier1-parity/${dir}/`))
    .map((s) => {
      const vocabPath = s.absPath.replace(/\.aster$/, '.vocab.json');
      assert.ok(existsSync(vocabPath), `${s.path} 缺少 .vocab.json`);
      const lexicon = LEXICONS[s.meta.lexicon ?? 'en-US'];
      assert.ok(lexicon, `${s.path} 的 lexicon ${s.meta.lexicon} 未知`);
      return { name: s.path, source: s.readSource(), lexicon, vocabulary: JSON.parse(readFileSync(vocabPath, 'utf8')) as DomainVocabulary };
    });
}

function assertParity(c: Case): void {
  const scopes = buildVocabularyScopes(c.vocabulary);
  const preview = buildCanonicalPreview(c.source, parseDocumentWith(c.source, c.lexicon, scopes), c.lexicon);
  const withVocab = compile(c.source, { lexicon: c.lexicon, vocabulary: c.vocabulary });
  assert.ok(withVocab.success && withVocab.core, `带词汇编译源码失败：${JSON.stringify(withVocab)}`);
  assert.ok(preview, `${c.name}：预览为 null（有替换位置证明不了）`);
  const plain = compile(preview.text, { lexicon: c.lexicon });
  assert.ok(plain.success && plain.core, `不带词汇编译预览失败：\n${preview.text}\n${JSON.stringify(plain)}`);
  assert.deepEqual(stripOrigin(plain.core), stripOrigin(withVocab.core), `预览文本：\n${preview.text}`);
}

describe('canonicalPreview 语料忠实性', () => {
  const vocab = new Map<string, Case[]>();
  before(async () => {
    for (const dir of Object.keys(VOCAB_DIRS)) vocab.set(dir, await vocabCases(dir));
  });

  for (const c of EXAMPLES) {
    it(c.name, () => assertParity(c));
  }

  for (const [dir, min] of Object.entries(VOCAB_DIRS)) {
    it(`${dir} 语料存在（防止语料缺失时静默通过）`, () => {
      const n = vocab.get(dir)?.length ?? 0;
      assert.ok(n >= min, `${dir} 样本异常偏少（${n} < ${min}）`);
    });

    it(`${dir} 每个样本`, async (t) => {
      for (const c of vocab.get(dir) ?? []) {
        await t.test(c.name, () => assertParity(c));
      }
    });
  }
});
