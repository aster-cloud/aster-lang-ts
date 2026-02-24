/**
 * 编译管道端到端测试
 *
 * 测试完整的编译流程：
 * 源代码 → 规范化 → 词法分析 → 语法分析 → 降级到核心 → 类型检查
 *
 * 与其他测试的区别：
 * - property.test.ts: 基于属性的测试，验证各阶段的不变性
 * - golden.ts: 黄金文件测试，验证输出与预期完全匹配
 * - pipeline.test.ts: 端到端集成测试，验证完整管道的协同工作
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule } from '../../../src/typecheck.js';
import type { Module as AstModule, Core } from '../../../src/types.js';

/**
 * 完整编译管道函数
 * @param source CNL 源代码
 * @returns 编译结果和诊断信息
 */
function compileEnd2End(source: string): {
  success: boolean;
  ast: AstModule | null;
  core: Core.Module | null;
  diagnostics: Array<{ severity: string; message: string }>;
  error: Error | null;
} {
  try {
    // 阶段 1: 规范化
    const canonical = canonicalize(source);

    // 阶段 2: 词法分析
    const tokens = lex(canonical);

    // 阶段 3: 语法分析
    const ast = parse(tokens).ast as AstModule;

    // 阶段 4: 降级到核心
    const core = lowerModule(ast);

    // 阶段 5: 类型检查
    const diagnostics = typecheckModule(core);

    return {
      success: diagnostics.filter(d => d.severity === 'error').length === 0,
      ast,
      core,
      diagnostics,
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      ast: null,
      core: null,
      diagnostics: [],
      error: error as Error,
    };
  }
}

describe('编译管道端到端测试', () => {
  describe('成功编译场景', () => {
    it('应该成功编译简单的模块和函数', () => {
      const source = `
Module test.simple.

Rule greet produce Text:
  Return "Hello, World!".
`;

      const result = compileEnd2End(source);

      assert.equal(result.success, true, '编译应该成功');
      assert.equal(result.error, null, '不应该有错误');
      assert.notEqual(result.ast, null, '应该生成 AST');
      assert.notEqual(result.core, null, '应该生成核心表示');
      assert.equal(result.ast?.kind, 'Module', 'AST 应该是 Module 类型');
      assert.equal(result.core?.kind, 'Module', 'Core 应该是 Module 类型');
      assert.equal(result.ast?.name, 'test.simple', '模块名应该正确');
    });

    it('应该成功编译带参数的函数', () => {
      const source = `
Module test.params.

Rule double given x as Int, produce Int:
  Return x plus x.
`;

      const result = compileEnd2End(source);

      assert.equal(result.success, true, '编译应该成功');
      assert.notEqual(result.core, null, '应该生成核心表示');

      const func = result.core?.decls.find((d: Core.Declaration) => d.kind === 'Func');
      assert.notEqual(func, undefined, '应该包含函数声明');
      assert.equal((func as any)?.params?.length, 1, '应该有一个参数');
    });

    it('应该成功编译数据类型定义', () => {
      const source = `
Module test.data.

Define User has name as Text, age as Int.

Rule createUser given n as Text, a as Int, produce User:
  Return User(n, a).
`;

      const result = compileEnd2End(source);

      assert.equal(result.success, true, '编译应该成功');
      assert.notEqual(result.core, null, '应该生成核心表示');

      const dataDecl = result.core?.decls.find((d: Core.Declaration) => d.kind === 'Data');
      assert.notEqual(dataDecl, undefined, '应该包含数据类型声明');
      assert.equal((dataDecl as any)?.name, 'User', '数据类型名应该正确');
    });

    it('应该成功编译枚举类型', () => {
      const source = `
Module test.enum.

Define Status as one of Success, Failure, Pending.

Rule getStatus produce Status:
  Return Success.
`;

      const result = compileEnd2End(source);

      assert.equal(result.success, true, '编译应该成功');
      assert.notEqual(result.core, null, '应该生成核心表示');

      const enumDecl = result.core?.decls.find((d: Core.Declaration) => d.kind === 'Enum');
      assert.notEqual(enumDecl, undefined, '应该包含枚举声明');
    });

    it('应该成功编译带效果声明的函数', () => {
      const source = `
Module test.effects.

Rule fetchData produce Text. It performs io:
  Return "data".
`;

      const result = compileEnd2End(source);

      assert.equal(result.success, true, '编译应该成功');
      assert.notEqual(result.core, null, '应该生成核心表示');

      const func = result.core?.decls.find((d: Core.Declaration) => d.kind === 'Func');
      assert.notEqual(func, undefined, '应该包含函数声明');
      assert.deepEqual((func as any)?.effects, ['IO'], '效果应该包含 IO');
    });
  });

  describe('编译错误场景', () => {
    it('应该检测缺少模块头', () => {
      const source = `
Rule greet produce Text:
  Return "Hello".
`;

      const result = compileEnd2End(source);

      // 缺少模块头会生成警告，但不阻止编译
      assert.notEqual(result.ast, null, '应该生成 AST');
      // Parser may assign a default name like "<anonymous>" when module header is missing
      const hasWarning = result.diagnostics.some(d =>
        d.message.includes('Missing module header') || d.message.includes('模块头')
      );
      // Either name is undefined/null/empty or there's a warning about missing header
      const hasMissingHeader = !result.ast?.name || hasWarning;
      assert.equal(hasMissingHeader, true, '应该检测到缺失的模块头');
    });

    it('应该检测语法错误', () => {
      const source = `
Module test.syntax.

Rule 123invalid:
  Return "Hello".
`;

      const result = compileEnd2End(source);

      assert.equal(result.success, false, '编译应该失败');
    });

    it('应该检测类型不匹配', () => {
      const source = `
Module test.typecheck.

Rule getNumber produce Int:
  Return "not a number".
`;

      const result = compileEnd2End(source);

      // 类型不匹配会在类型检查阶段报告
      const errors = result.diagnostics.filter((d: { severity: string; message: string }) => d.severity === 'error');
      assert.equal(errors.length > 0, true, '应该有类型错误');
    });
  });

  describe('管道各阶段的输出一致性', () => {
    it('规范化应该是幂等的', () => {
      const source = `
Module test.canonical.

Rule greet produce Text:
  Return "Hello".
`;

      const canonical1 = canonicalize(source);
      const canonical2 = canonicalize(canonical1);

      assert.equal(canonical1, canonical2, '规范化应该是幂等的');
    });

    it('AST 和 Core 应该保持结构对应', () => {
      const source = `
Module test.structure.

Define User has name as Text.

Rule createUser given n as Text, produce User:
  Return User(n).
`;

      const result = compileEnd2End(source);

      assert.equal(result.success, true, '编译应该成功');
      assert.equal(result.ast?.decls.length, result.core?.decls.length, 'AST 和 Core 声明数量应该一致');
    });

    it('词法标记应该覆盖整个源代码', () => {
      const source = 'Module test.';

      const canonical = canonicalize(source);
      const tokens = lex(canonical);

      // 最后一个标记应该是 EOF
      assert.equal(tokens[tokens.length - 1]?.kind, 'EOF', '最后一个标记应该是 EOF');

      // 应该至少有: IDENT(Module) IDENT(test) DOT EOF
      assert.equal(tokens.length >= 3, true, '应该有足够的标记');
    });
  });

  describe('管道性能和边界情况', () => {
    it('应该处理空模块', () => {
      const source = 'Module test.empty.';

      const result = compileEnd2End(source);

      assert.equal(result.success, true, '空模块应该编译成功');
      assert.equal(result.core?.decls.length, 0, '空模块应该没有声明');
    });

    it('应该处理大型模块（多个函数）', () => {
      const functions = [];
      for (let i = 0; i < 50; i++) {
        functions.push(`
Rule func${i} produce Int:
  Return ${i}.
`);
      }

      const source = `
Module test.large.

${functions.join('\n')}
`;

      const result = compileEnd2End(source);

      assert.equal(result.success, true, '大型模块应该编译成功');
      assert.equal(result.core?.decls.length, 50, '应该包含所有函数');
    });

    it('应该处理简单的控制流', () => {
      const source = `
Module test.nested.

Rule simpleIf given x as Int, produce Int:
  If x greater than 10
    Return 1.
  Return 0.
`;

      const result = compileEnd2End(source);

      if (!result.success) {
        console.error('Compilation failed:', result.diagnostics);
        console.error('Error:', result.error);
      }
      assert.equal(result.success, true, '简单控制流应该编译成功');
    });
  });

  describe('管道集成特性', () => {
    it('应该支持泛型函数', () => {
      const source = `
Module test.generic.

Rule identity of T, given x as T, produce T:
  Return x.
`;

      const result = compileEnd2End(source);

      assert.equal(result.success, true, '泛型函数应该编译成功');

      const func = result.core?.decls.find((d: Core.Declaration) => d.kind === 'Func');
      assert.notEqual(func, undefined, '应该包含函数声明');
      assert.equal((func as any)?.typeParams?.length, 1, '应该有一个类型参数');
      assert.equal((func as any)?.typeParams?.[0], 'T', '类型参数应该是 T');
    });

    it('应该支持多个泛型函数', () => {
      const source = `
Module test.generics.

Rule identity of T, given x as T, produce T:
  Return x.

Rule pair of Ta and Tb, given a as Ta, b as Tb, produce Text:
  Return "pair".
`;

      const result = compileEnd2End(source);

      if (!result.success) {
        console.error('Compilation failed:', result.diagnostics);
        console.error('Error:', result.error);
      }
      assert.equal(result.success, true, '多个泛型函数应该编译成功');

      const funcs = result.core?.decls.filter((d: Core.Declaration) => d.kind === 'Func');
      assert.equal(funcs?.length, 2, '应该有两个函数');
    });

    it('应该支持异步操作（Start/Wait）', () => {
      const source = `
Module test.async.

Rule fetchDashboard given userId as Text, produce Text. It performs io:
  Start profile as async fetchProfile(userId).
  Start timeline as async fetchTimeline(userId).
  Wait for profile and timeline.
  Return "Dashboard".

Rule fetchProfile given id as Text, produce Text. It performs io:
  Return "Profile".

Rule fetchTimeline given id as Text, produce Text. It performs io:
  Return "Timeline".
`;

      const result = compileEnd2End(source);

      assert.equal(result.success, true, '异步操作应该编译成功');

      const funcDecls = result.core?.decls.filter((d: Core.Declaration) => d.kind === 'Func');
      const dashFunc = funcDecls?.find((f: Core.Declaration) => (f as any).name === 'fetchDashboard');

      assert.notEqual(dashFunc, undefined, '应该包含 fetchDashboard 函数');

      const stmts = (dashFunc as any)?.body?.statements || [];
      const hasStart = stmts.some((s: any) => s.kind === 'Start');
      const hasWait = stmts.some((s: any) => s.kind === 'Wait');

      assert.equal(hasStart, true, '应该包含 Start 语句');
      assert.equal(hasWait, true, '应该包含 Wait 语句');
    });
  });
});
