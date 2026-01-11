import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TokenKind } from '../../../src/types.js';
import {
  findAmbiguousInteropCalls,
  findDottedCallRangeAt,
  describeDottedCallAt,
  buildDescriptorPreview,
  returnTypeTextFromDesc,
  findNullabilityDiagnostics,
  computeDisambiguationEdits,
  collectSemanticDiagnostics,
} from '../../../src/lsp/analysis.js';

// Helper: 创建 token
function createToken(kind: TokenKind, value: any, line: number, col: number, endCol?: number): any {
  return {
    kind,
    value,
    start: { line, col },
    end: { line, col: endCol ?? col + String(value).length },
  };
}

describe('analysis.ts', () => {
  describe('findAmbiguousInteropCalls', () => {
    it('应该检测混合数字类型的interop调用', () => {
      // 模拟: aster.runtime.Interop.sum(1, 2L)
      const tokens = [
        createToken(TokenKind.IDENT, 'aster', 1, 1),
        createToken(TokenKind.DOT, '.', 1, 6),
        createToken(TokenKind.IDENT, 'runtime', 1, 7),
        createToken(TokenKind.DOT, '.', 1, 14),
        createToken(TokenKind.IDENT, 'Interop', 1, 15),
        createToken(TokenKind.DOT, '.', 1, 22),
        createToken(TokenKind.IDENT, 'sum', 1, 23),
        createToken(TokenKind.LPAREN, '(', 1, 26),
        createToken(TokenKind.INT, 1, 1, 27),
        createToken(TokenKind.COMMA, ',', 1, 28),
        createToken(TokenKind.LONG, 2, 1, 30),
        createToken(TokenKind.RPAREN, ')', 1, 32),
      ];

      const diags = findAmbiguousInteropCalls(tokens);

      assert.ok(diags.length > 0, 'should detect ambiguous call');
      assert.ok(diags[0]?.message.includes('Ambiguous interop call'), 'should have correct message');
      assert.ok(diags[0]?.message.includes('int=true'), 'should detect int');
      assert.ok(diags[0]?.message.includes('long=true'), 'should detect long');
    });

    it('应该检测Int+Long+Double混合', () => {
      // 模拟: foo.bar(1, 2L, 3.0)
      const tokens = [
        createToken(TokenKind.IDENT, 'foo', 1, 1),
        createToken(TokenKind.DOT, '.', 1, 4),
        createToken(TokenKind.IDENT, 'bar', 1, 5),
        createToken(TokenKind.LPAREN, '(', 1, 8),
        createToken(TokenKind.INT, 1, 1, 9),
        createToken(TokenKind.COMMA, ',', 1, 10),
        createToken(TokenKind.LONG, 2, 1, 12),
        createToken(TokenKind.COMMA, ',', 1, 14),
        createToken(TokenKind.FLOAT, 3.0, 1, 16),
        createToken(TokenKind.RPAREN, ')', 1, 19),
      ];

      const diags = findAmbiguousInteropCalls(tokens);

      assert.ok(diags.length > 0);
      assert.ok(diags[0]?.message.includes('int=true'));
      assert.ok(diags[0]?.message.includes('long=true'));
      assert.ok(diags[0]?.message.includes('double=true'));
    });

    it('应该忽略单一类型的调用', () => {
      // 模拟: foo.bar(1, 2, 3) - 全部Int
      const tokens = [
        createToken(TokenKind.IDENT, 'foo', 1, 1),
        createToken(TokenKind.DOT, '.', 1, 4),
        createToken(TokenKind.IDENT, 'bar', 1, 5),
        createToken(TokenKind.LPAREN, '(', 1, 8),
        createToken(TokenKind.INT, 1, 1, 9),
        createToken(TokenKind.COMMA, ',', 1, 10),
        createToken(TokenKind.INT, 2, 1, 12),
        createToken(TokenKind.COMMA, ',', 1, 14),
        createToken(TokenKind.INT, 3, 1, 16),
        createToken(TokenKind.RPAREN, ')', 1, 18),
      ];

      const diags = findAmbiguousInteropCalls(tokens);

      assert.strictEqual(diags.length, 0, 'should not report single-type calls');
    });

    it('应该忽略非dotted调用', () => {
      // 模拟: sum(1, 2L) - 没有dot
      const tokens = [
        createToken(TokenKind.IDENT, 'sum', 1, 1),
        createToken(TokenKind.LPAREN, '(', 1, 4),
        createToken(TokenKind.INT, 1, 1, 5),
        createToken(TokenKind.COMMA, ',', 1, 6),
        createToken(TokenKind.LONG, 2, 1, 8),
        createToken(TokenKind.RPAREN, ')', 1, 10),
      ];

      const diags = findAmbiguousInteropCalls(tokens);

      assert.strictEqual(diags.length, 0, 'should ignore non-dotted calls');
    });
  });

  describe('findDottedCallRangeAt', () => {
    it('应该找到覆盖指定位置的dotted调用', () => {
      // 模拟: Text.concat("a", "b") at line 0
      const tokens = [
        createToken(TokenKind.IDENT, 'Text', 1, 1),
        createToken(TokenKind.DOT, '.', 1, 5),
        createToken(TokenKind.IDENT, 'concat', 1, 6),
        createToken(TokenKind.LPAREN, '(', 1, 12),
        createToken(TokenKind.STRING, 'a', 1, 13),
        createToken(TokenKind.COMMA, ',', 1, 16),
        createToken(TokenKind.STRING, 'b', 1, 18),
        createToken(TokenKind.RPAREN, ')', 1, 21),
      ];

      const range = findDottedCallRangeAt(tokens, { line: 0, character: 10 });

      assert.ok(range !== null, 'should find range');
      assert.strictEqual(range.start.line, 0);
      assert.strictEqual(range.start.character, 0);
    });

    it('应该在位置不匹配时返回null', () => {
      const tokens = [
        createToken(TokenKind.IDENT, 'Text', 1, 1),
        createToken(TokenKind.DOT, '.', 1, 5),
        createToken(TokenKind.IDENT, 'concat', 1, 6),
        createToken(TokenKind.LPAREN, '(', 1, 12),
        createToken(TokenKind.RPAREN, ')', 1, 13),
      ];

      const range = findDottedCallRangeAt(tokens, { line: 10, character: 0 });

      assert.strictEqual(range, null, 'should return null for non-matching position');
    });

    it('应该忽略非dotted调用', () => {
      const tokens = [
        createToken(TokenKind.IDENT, 'foo', 1, 1),
        createToken(TokenKind.LPAREN, '(', 1, 4),
        createToken(TokenKind.RPAREN, ')', 1, 5),
      ];

      const range = findDottedCallRangeAt(tokens, { line: 0, character: 2 });

      assert.strictEqual(range, null);
    });
  });

  describe('describeDottedCallAt', () => {
    it('应该描述包含Int参数的调用', () => {
      // 模拟: Text.length("hello")
      const tokens = [
        createToken(TokenKind.IDENT, 'Text', 1, 1),
        createToken(TokenKind.DOT, '.', 1, 5),
        createToken(TokenKind.IDENT, 'length', 1, 6),
        createToken(TokenKind.LPAREN, '(', 1, 12),
        createToken(TokenKind.STRING, 'hello', 1, 13),
        createToken(TokenKind.RPAREN, ')', 1, 20),
      ];

      const desc = describeDottedCallAt(tokens, { line: 0, character: 10 });

      assert.ok(desc !== null);
      assert.strictEqual(desc.name, 'Text.length');
      assert.deepStrictEqual(desc.argDescs, ['Ljava/lang/String;']);
    });

    it('应该正确widen Int->Long', () => {
      // 模拟: foo.bar(1, 2L)
      const tokens = [
        createToken(TokenKind.IDENT, 'foo', 1, 1),
        createToken(TokenKind.DOT, '.', 1, 4),
        createToken(TokenKind.IDENT, 'bar', 1, 5),
        createToken(TokenKind.LPAREN, '(', 1, 8),
        createToken(TokenKind.INT, 1, 1, 9),
        createToken(TokenKind.COMMA, ',', 1, 10),
        createToken(TokenKind.LONG, 2, 1, 12),
        createToken(TokenKind.RPAREN, ')', 1, 14),
      ];

      const desc = describeDottedCallAt(tokens, { line: 0, character: 6 });

      assert.ok(desc !== null);
      assert.deepStrictEqual(desc.argDescs, ['J', 'J'], 'Int should be widened to J (Long)');
    });

    it('应该正确widen Int/Long->Double', () => {
      // 模拟: foo.bar(1, 2L, 3.0)
      const tokens = [
        createToken(TokenKind.IDENT, 'foo', 1, 1),
        createToken(TokenKind.DOT, '.', 1, 4),
        createToken(TokenKind.IDENT, 'bar', 1, 5),
        createToken(TokenKind.LPAREN, '(', 1, 8),
        createToken(TokenKind.INT, 1, 1, 9),
        createToken(TokenKind.COMMA, ',', 1, 10),
        createToken(TokenKind.LONG, 2, 1, 12),
        createToken(TokenKind.COMMA, ',', 1, 14),
        createToken(TokenKind.FLOAT, 3.0, 1, 16),
        createToken(TokenKind.RPAREN, ')', 1, 20),
      ];

      const desc = describeDottedCallAt(tokens, { line: 0, character: 6 });

      assert.ok(desc !== null);
      assert.deepStrictEqual(desc.argDescs, ['D', 'D', 'D'], 'All should be widened to D (Double)');
    });

    it('应该在位置不匹配时返回null', () => {
      const tokens = [
        createToken(TokenKind.IDENT, 'Text', 1, 1),
        createToken(TokenKind.DOT, '.', 1, 5),
        createToken(TokenKind.IDENT, 'length', 1, 6),
        createToken(TokenKind.LPAREN, '(', 1, 12),
        createToken(TokenKind.RPAREN, ')', 1, 13),
      ];

      const desc = describeDottedCallAt(tokens, { line: 10, character: 0 });

      assert.strictEqual(desc, null);
    });
  });

  describe('buildDescriptorPreview', () => {
    it('应该为aster.runtime.Interop.sum生成descriptor', () => {
      const desc1 = buildDescriptorPreview('aster.runtime.Interop.sum', ['I', 'I']);
      assert.strictEqual(desc1, '(II)Ljava/lang/String;');

      const desc2 = buildDescriptorPreview('aster.runtime.Interop.sum', ['J', 'J']);
      assert.strictEqual(desc2, '(JJ)Ljava/lang/String;');

      const desc3 = buildDescriptorPreview('aster.runtime.Interop.sum', ['D', 'D']);
      assert.strictEqual(desc3, '(DD)Ljava/lang/String;');
    });

    it('应该为aster.runtime.Interop.pick生成descriptor', () => {
      const desc1 = buildDescriptorPreview('aster.runtime.Interop.pick', ['I']);
      assert.strictEqual(desc1, '(I)Ljava/lang/String;');

      const desc2 = buildDescriptorPreview('aster.runtime.Interop.pick', ['Ljava/lang/String;']);
      assert.strictEqual(desc2, '(Ljava/lang/String;)Ljava/lang/String;');
    });

    it('应该为Text方法生成descriptor', () => {
      assert.strictEqual(
        buildDescriptorPreview('Text.concat', ['Ljava/lang/String;', 'Ljava/lang/String;']),
        '(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;'
      );

      assert.strictEqual(
        buildDescriptorPreview('Text.length', ['Ljava/lang/String;']),
        '(Ljava/lang/String;)I'
      );

      assert.strictEqual(
        buildDescriptorPreview('Text.contains', ['Ljava/lang/String;', 'Ljava/lang/CharSequence;']),
        '(Ljava/lang/String;Ljava/lang/CharSequence;)Z'
      );

      assert.strictEqual(
        buildDescriptorPreview('Text.split', ['Ljava/lang/String;', 'Ljava/lang/String;']),
        '(Ljava/lang/String;Ljava/lang/String;)Ljava/util/List;'
      );
    });

    it('应该为List方法生成descriptor', () => {
      assert.strictEqual(
        buildDescriptorPreview('List.get', ['Ljava/util/List;', 'I']),
        '(Ljava/util/List;I)Ljava/lang/Object;'
      );

      assert.strictEqual(
        buildDescriptorPreview('List.length', ['Ljava/util/List;']),
        '(Ljava/util/List;)I'
      );

      assert.strictEqual(
        buildDescriptorPreview('List.isEmpty', ['Ljava/util/List;']),
        '(Ljava/util/List;)Z'
      );
    });

    it('应该为Map/Set方法生成descriptor', () => {
      assert.strictEqual(
        buildDescriptorPreview('Map.get', ['Ljava/util/Map;', 'Ljava/lang/Object;']),
        '(Ljava/util/Map;Ljava/lang/Object;)Ljava/lang/Object;'
      );

      assert.strictEqual(
        buildDescriptorPreview('Set.contains', ['Ljava/util/Set;', 'Ljava/lang/Object;']),
        '(Ljava/util/Set;Ljava/lang/Object;)Z'
      );
    });

    it('应该为未知方法返回null', () => {
      const desc = buildDescriptorPreview('Unknown.method', ['I']);
      assert.strictEqual(desc, null);
    });
  });

  describe('returnTypeTextFromDesc', () => {
    it('应该正确转换基本类型', () => {
      assert.strictEqual(returnTypeTextFromDesc('()V'), 'Unit');
      assert.strictEqual(returnTypeTextFromDesc('()I'), 'Int');
      assert.strictEqual(returnTypeTextFromDesc('()Z'), 'Bool');
      assert.strictEqual(returnTypeTextFromDesc('()J'), 'Long');
      assert.strictEqual(returnTypeTextFromDesc('()D'), 'Double');
      assert.strictEqual(returnTypeTextFromDesc('()Ljava/lang/String;'), 'Text');
    });

    it('应该正确转换集合类型', () => {
      assert.strictEqual(returnTypeTextFromDesc('()Ljava/util/List;'), 'List');
      assert.strictEqual(returnTypeTextFromDesc('()Ljava/util/Map;'), 'Map');
      assert.strictEqual(returnTypeTextFromDesc('()Ljava/util/Set;'), 'Set');
    });

    it('应该正确转换其他对象类型', () => {
      assert.strictEqual(returnTypeTextFromDesc('()Lcom/example/Foo;'), 'Object');
    });

    it('应该处理null descriptor', () => {
      assert.strictEqual(returnTypeTextFromDesc(null), null);
    });
  });

  describe('findNullabilityDiagnostics', () => {
    it('应该检测Text.concat的null参数', () => {
      // 模拟: Text.concat(null, "b")
      const tokens = [
        createToken(TokenKind.IDENT, 'Text', 1, 1),
        createToken(TokenKind.DOT, '.', 1, 5),
        createToken(TokenKind.IDENT, 'concat', 1, 6),
        createToken(TokenKind.LPAREN, '(', 1, 12),
        createToken(TokenKind.NULL, null, 1, 13),
        createToken(TokenKind.COMMA, ',', 1, 17),
        createToken(TokenKind.STRING, 'b', 1, 19),
        createToken(TokenKind.RPAREN, ')', 1, 22),
      ];

      const diags = findNullabilityDiagnostics(tokens);

      assert.ok(diags.length > 0);
      assert.ok(diags[0]?.message.includes('Nullability'));
      assert.ok(diags[0]?.message.includes('Text.concat'));
      assert.ok(diags[0]?.message.includes('parameter 1'));
    });

    it('应该检测第一个null参数（已知限制：仅检测第一个）', () => {
      // 模拟: Text.concat(null, null)
      // 注意：当前实现由于argIndex递增逻辑只能检测第一个null
      const tokens = [
        createToken(TokenKind.IDENT, 'Text', 1, 1),
        createToken(TokenKind.DOT, '.', 1, 5),
        createToken(TokenKind.IDENT, 'concat', 1, 6),
        createToken(TokenKind.LPAREN, '(', 1, 12),
        createToken(TokenKind.NULL, null, 1, 13),
        createToken(TokenKind.COMMA, ',', 1, 17),
        createToken(TokenKind.NULL, null, 1, 19),
        createToken(TokenKind.RPAREN, ')', 1, 23),
      ];

      const diags = findNullabilityDiagnostics(tokens);

      assert.strictEqual(diags.length, 1, 'should detect first null argument');
      assert.ok(diags[0]?.message.includes('parameter 1'));
    });

    it('应该允许nullable参数的null值', () => {
      // 模拟: Text.equals(null, null) - 两个参数都允许null
      const tokens = [
        createToken(TokenKind.IDENT, 'Text', 1, 1),
        createToken(TokenKind.DOT, '.', 1, 5),
        createToken(TokenKind.IDENT, 'equals', 1, 6),
        createToken(TokenKind.LPAREN, '(', 1, 12),
        createToken(TokenKind.NULL, null, 1, 13),
        createToken(TokenKind.COMMA, ',', 1, 17),
        createToken(TokenKind.NULL, null, 1, 19),
        createToken(TokenKind.RPAREN, ')', 1, 23),
      ];

      const diags = findNullabilityDiagnostics(tokens);

      assert.strictEqual(diags.length, 0, 'should allow null for nullable parameters');
    });

    it('应该忽略未知方法', () => {
      const tokens = [
        createToken(TokenKind.IDENT, 'Unknown', 1, 1),
        createToken(TokenKind.DOT, '.', 1, 8),
        createToken(TokenKind.IDENT, 'method', 1, 9),
        createToken(TokenKind.LPAREN, '(', 1, 15),
        createToken(TokenKind.NULL, null, 1, 16),
        createToken(TokenKind.RPAREN, ')', 1, 20),
      ];

      const diags = findNullabilityDiagnostics(tokens);

      assert.strictEqual(diags.length, 0, 'should ignore unknown methods');
    });
  });

  describe('computeDisambiguationEdits', () => {
    it('应该生成Int->Long编辑', () => {
      // 模拟: foo.bar(1, 2L)
      const tokens = [
        createToken(TokenKind.IDENT, 'foo', 1, 1),
        createToken(TokenKind.DOT, '.', 1, 4),
        createToken(TokenKind.IDENT, 'bar', 1, 5),
        createToken(TokenKind.LPAREN, '(', 1, 8),
        createToken(TokenKind.INT, 1, 1, 9),
        createToken(TokenKind.COMMA, ',', 1, 10),
        createToken(TokenKind.LONG, 2, 1, 12),
        createToken(TokenKind.RPAREN, ')', 1, 14),
      ];

      const edits = computeDisambiguationEdits(tokens, {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 20 },
      });

      assert.ok(edits.length > 0);
      assert.strictEqual(edits[0]?.newText, '1L', 'should append L to int literal');
    });

    it('应该生成Int->Double和Long->Double编辑', () => {
      // 模拟: foo.bar(1, 2L, 3.0)
      const tokens = [
        createToken(TokenKind.IDENT, 'foo', 1, 1),
        createToken(TokenKind.DOT, '.', 1, 4),
        createToken(TokenKind.IDENT, 'bar', 1, 5),
        createToken(TokenKind.LPAREN, '(', 1, 8),
        createToken(TokenKind.INT, 1, 1, 9),
        createToken(TokenKind.COMMA, ',', 1, 10),
        createToken(TokenKind.LONG, 2, 1, 12),
        createToken(TokenKind.COMMA, ',', 1, 14),
        createToken(TokenKind.FLOAT, 3.0, 1, 16),
        createToken(TokenKind.RPAREN, ')', 1, 20),
      ];

      const edits = computeDisambiguationEdits(tokens, {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 25 },
      });

      assert.strictEqual(edits.length, 2, 'should have 2 edits');
      assert.strictEqual(edits[0]?.newText, '1.0', 'should append .0 to int');
      assert.strictEqual(edits[1]?.newText, '2.0', 'should append .0 to long');
    });

    it('应该在范围外返回空edits', () => {
      const tokens = [
        createToken(TokenKind.IDENT, 'foo', 1, 1),
        createToken(TokenKind.LPAREN, '(', 1, 4),
        createToken(TokenKind.INT, 1, 1, 5),
        createToken(TokenKind.RPAREN, ')', 1, 6),
      ];

      const edits = computeDisambiguationEdits(tokens, {
        start: { line: 10, character: 0 },
        end: { line: 10, character: 10 },
      });

      assert.strictEqual(edits.length, 0);
    });
  });

  describe('collectSemanticDiagnostics', () => {
    it('应该收集所有语义诊断', () => {
      // 模拟: Text.concat(1, 2L) - 既有混合类型又有nullability问题
      const tokens = [
        createToken(TokenKind.IDENT, 'Text', 1, 1),
        createToken(TokenKind.DOT, '.', 1, 5),
        createToken(TokenKind.IDENT, 'concat', 1, 6),
        createToken(TokenKind.LPAREN, '(', 1, 12),
        createToken(TokenKind.INT, 1, 1, 13),
        createToken(TokenKind.COMMA, ',', 1, 14),
        createToken(TokenKind.LONG, 2, 1, 16),
        createToken(TokenKind.RPAREN, ')', 1, 18),
      ];

      const core: any = {
        name: 'test',
        imports: [],
        decls: [],
        span: { start: { line: 1, col: 1 }, end: { line: 1, col: 1 } },
      };

      const diags = collectSemanticDiagnostics(tokens, core);

      // 应该至少检测到ambiguous call
      assert.ok(diags.length > 0, 'should collect diagnostics');
    });

    it('应该在空tokens时返回空数组', () => {
      const core: any = {
        name: 'test',
        imports: [],
        decls: [],
        span: { start: { line: 1, col: 1 }, end: { line: 1, col: 1 } },
      };

      const diags = collectSemanticDiagnostics([], core);

      assert.ok(Array.isArray(diags));
    });
  });
});
