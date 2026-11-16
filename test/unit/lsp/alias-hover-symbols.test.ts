/**
 * 类型别名 / 导入别名的悬停与文档符号（ADR 0058 §8.1）：
 * `type X as T`、`use M as X`；符号分别为 TypeParameter / Module，范围取声明 span。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SymbolKind } from 'vscode-languageserver/node.js';
import { registerHoverHandler } from '../../../src/lsp/navigation/hover.js';
import { registerDocumentSymbolHandler } from '../../../src/lsp/navigation/document-symbol.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import { docOf, documentsOf, getOrParseWith, posOf } from './resolution-fixture.js';
import type { Doc } from './resolution-fixture.js';

type HoverFn = (params: unknown) => Promise<{ contents: { value: string } } | null>;
interface Sym { name: string; kind: number; detail?: string; range: { start: { line: number; character: number }; end: { line: number; character: number } }; children?: Sym[] }

function hoverAt(doc: Doc, pos: { line: number; character: number }, lexicon: Lexicon): Promise<string | null> {
  let handler: HoverFn | undefined;
  registerHoverHandler({ onHover: (fn: HoverFn) => { handler = fn; } } as never, documentsOf(doc), getOrParseWith(lexicon) as never, () => lexicon);
  return handler!({ textDocument: { uri: doc.uri }, position: pos }).then((h) => h?.contents.value ?? null);
}

function symbolsOf(doc: Doc, lexicon: Lexicon): Sym[] {
  let handler: ((p: unknown) => Sym[]) | undefined;
  registerDocumentSymbolHandler({ onDocumentSymbol: (fn: (p: unknown) => Sym[]) => { handler = fn; } } as never, documentsOf(doc), getOrParseWith(lexicon) as never);
  return handler!({ textDocument: { uri: doc.uri } });
}

const CASES = [
  { name: 'en-US', lexicon: EN_US, lines: ['Module m.', '', 'Use foo.bar as L.', '', 'Type Score as Int.', '', 'Define D has s as Score.', ''], target: 'Int' },
  { name: 'de-DE', lexicon: DE_DE, lines: ['Modul m.', '', 'verwende foo.bar als L.', '', 'Type Score als Ganzzahl.', '', 'Definiere D hat s als Score.', ''], target: 'Int' },
  { name: 'zh-CN', lexicon: ZH_CN, lines: ['模块 m。', '', '引用 foo.bar 作为 L。', '', 'Type Score 作为 整数。', '', '定义 D 包含 s 作为 Score。', ''], target: 'Int' },
];

for (const c of CASES) {
  describe(`别名 hover 与文档符号 ${c.name}`, () => {
    const doc = docOf(c.lines);

    it('★类型别名名悬停：type Score as Int', async () => {
      assert.equal(await hoverAt(doc, posOf(doc, 4, 'Score', 1), c.lexicon), `type Score as ${c.target}`);
    });

    it('类型别名在字段类型中被引用时悬停同样显示目标', async () => {
      assert.equal(await hoverAt(doc, posOf(doc, 6, 'Score', 1), c.lexicon), `type Score as ${c.target}`);
    });

    it('★导入别名悬停：use foo.bar as L', async () => {
      assert.equal(await hoverAt(doc, posOf(doc, 2, 'L', 0), c.lexicon), 'use foo.bar as L');
    });

    it('★文档符号：类型别名 TypeParameter、导入别名 Module，范围取声明 span', () => {
      const [mod] = symbolsOf(doc, c.lexicon);
      const kids = mod!.children!;
      const alias = kids.find((s) => s.name === 'Score')!;
      assert.equal(alias.kind, SymbolKind.TypeParameter);
      assert.equal(alias.detail, c.target);
      assert.deepEqual(alias.range.start, { line: 4, character: 0 });
      assert.equal(alias.range.end.line, 4);
      const imp = kids.find((s) => s.name === 'L')!;
      assert.equal(imp.kind, SymbolKind.Module);
      assert.equal(imp.detail, 'foo.bar');
      assert.deepEqual(imp.range.start, { line: 2, character: 0 });
      assert.equal(imp.range.end.line, 2);
    });
  });
}

describe('别名与同名参数并存时 hover 看光标处的实际绑定', () => {
  const doc = docOf(['Module m.', '', 'Type score as Int.', '', 'Rule f given score as Int, produce Int:', '  Return score.', '']);

  it('参数声明处显示参数，不显示别名', async () => {
    assert.equal(await hoverAt(doc, posOf(doc, 4, 'score', 1), EN_US), 'Parameter **score**: Int');
  });

  it('表达式里的引用显示参数，不显示别名', async () => {
    assert.equal(await hoverAt(doc, posOf(doc, 5, 'score', 1), EN_US), 'Parameter **score**: Int');
  });

  it('别名声明处仍显示别名', async () => {
    assert.equal(await hoverAt(doc, posOf(doc, 2, 'score', 1), EN_US), 'type score as Int');
  });
});

describe('别名与同名顶层函数并存时，函数声明与调用显示函数', () => {
  const doc = docOf([
    'Module m.',
    '',
    'Type score as Int.',
    '',
    'Rule score given x as Int, produce score:',
    '  Return x.',
    '',
    'Rule g given y as score, produce Int:',
    '  Return score(y).',
    '',
  ]);

  it('★函数声明名显示函数，不显示别名', async () => {
    const h = await hoverAt(doc, posOf(doc, 4, 'score', 1), EN_US);
    assert.ok(h?.startsWith('Function score'), String(h));
  });

  it('★调用处显示被调函数，不显示别名', async () => {
    const h = await hoverAt(doc, posOf(doc, 8, 'score', 1), EN_US);
    assert.ok(h?.startsWith('Function score'), String(h));
  });

  it('类型位置（返回类型、参数类型）与别名声明仍显示别名', async () => {
    assert.equal(await hoverAt(doc, posOf(doc, 4, 'score', 1, 1), EN_US), 'type score as Int');
    assert.equal(await hoverAt(doc, posOf(doc, 7, 'score', 1), EN_US), 'type score as Int');
    assert.equal(await hoverAt(doc, posOf(doc, 2, 'score', 1), EN_US), 'type score as Int');
  });
});
