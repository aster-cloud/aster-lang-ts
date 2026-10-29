import { parseSource, resolveAndLower } from '../compile-pipeline.js';
import { typecheckModule, type TypecheckDiagnostic } from '../typecheck.js';
import type { Core } from '../types.js';

/**
 * 验证结果接口
 */
export interface ValidationResult {
  /**
   * 验证是否通过
   * - true: CNL 代码无语法或类型错误
   * - false: 存在错误或警告
   */
  valid: boolean;

  /**
   * 诊断信息列表
   * 包含所有错误、警告和提示信息
   */
  diagnostics: TypecheckDiagnostic[];

  /**
   * Core IR（仅在验证通过时）
   * 用于后续的代码生成或转换
   */
  coreIR?: Core.Module;
}

/**
 * Policy Validator
 *
 * 封装 policy-converter 的编译流程，提供字符串输入的验证接口。
 * 验证 LLM 生成的 CNL 代码是否通过完整的编译管线：
 * canonicalize → lex → parse → R1 → lowerModule → R2 → typecheck（名称解析见 ADR 0051）
 */
export class PolicyValidator {
  /**
   * 验证 CNL 代码
   *
   * @param cnlCode - Aster CNL 源代码字符串
   * @returns 验证结果，包含 valid 标志、diagnostics 和可选的 coreIR
   */
  async validate(cnlCode: string): Promise<ValidationResult> {
    try {
      // 编译管线：CNL → Canonical → Tokens → AST
      const { ast, diagnostics: parseDiags } = parseSource(cnlCode);

      // 解析错误直接返回
      if (parseDiags.length > 0) {
        return {
          valid: false,
          diagnostics: parseDiags.map(d => ({
            severity: 'error' as const,
            code: 'COMPILATION_ERROR' as any,
            message: d.message,
            span: d.span,
          })),
        };
      }

      // 名称解析 R1 → lower → R2；任一 E8xx 时不做类型检查、不返回 IR
      const resolved = resolveAndLower(ast);
      if (resolved.diagnostics.some(d => d.severity === 'error')) {
        return { valid: false, diagnostics: [...resolved.diagnostics] };
      }
      const coreIR = resolved.core;

      // 类型检查（名称解析的 warning 一并返回）
      const diagnostics = [...resolved.diagnostics, ...typecheckModule(coreIR)];

      // 检查是否有错误（忽略 warning 和 info）
      const hasErrors = diagnostics.some(d => d.severity === 'error');

      if (hasErrors) {
        return {
          valid: false,
          diagnostics,
        };
      } else {
        return {
          valid: true,
          diagnostics,
          coreIR,
        };
      }
    } catch (error) {
      // 捕获编译过程中的异常（语法错误等）
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        valid: false,
        diagnostics: [
          {
            severity: 'error',
            code: 'COMPILATION_ERROR' as any, // 使用通用错误码
            message: `编译失败: ${errorMessage}`,
          },
        ],
      };
    }
  }

  /**
   * 格式化诊断信息为用户友好的字符串
   *
   * @param diagnostics - 诊断信息列表
   * @returns 格式化后的字符串，每行一个诊断信息
   */
  formatDiagnostics(diagnostics: TypecheckDiagnostic[]): string {
    if (diagnostics.length === 0) {
      return '无诊断信息';
    }

    return diagnostics
      .map(d => {
        const location = d.span
          ? `${d.origin?.file ?? '<unknown>'}:${d.span.start.line}:${d.span.start.col}`
          : '<unknown location>';

        return `[${d.severity.toUpperCase()}] ${d.message} (${location})`;
      })
      .join('\n');
  }

  /**
   * 仅检查是否有错误（快速验证）
   *
   * @param cnlCode - Aster CNL 源代码字符串
   * @returns true 表示无错误，false 表示有错误
   */
  async isValid(cnlCode: string): Promise<boolean> {
    const result = await this.validate(cnlCode);
    return result.valid;
  }

  /**
   * 获取所有错误（过滤掉 warning 和 info）
   *
   * @param diagnostics - 诊断信息列表
   * @returns 仅包含错误的诊断信息列表
   */
  getErrors(diagnostics: TypecheckDiagnostic[]): TypecheckDiagnostic[] {
    return diagnostics.filter(d => d.severity === 'error');
  }

  /**
   * 获取所有警告
   *
   * @param diagnostics - 诊断信息列表
   * @returns 仅包含警告的诊断信息列表
   */
  getWarnings(diagnostics: TypecheckDiagnostic[]): TypecheckDiagnostic[] {
    return diagnostics.filter(d => d.severity === 'warning');
  }
}
