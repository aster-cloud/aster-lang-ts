/**
 * 合规示例冒烟测试
 *
 * 验证 examples/compliance/ 和 examples/healthcare/ 目录下的合规示例
 * 能够成功编译并生成有效的 Core IR。
 *
 * 测试覆盖：
 * - SOC2 审计链验证 (soc2-audit-demo.aster)
 * - HIPAA 访问控制验证 (hipaa-validation-demo.aster)
 * - 患者记录管理 (patient-record.aster)
 * - 电子处方工作流 (prescription-workflow.aster)
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule } from '../../../src/typecheck.js';
import type { Module as AstModule, Core } from '../../../src/types.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { attachTypeInferenceRules } from '../../../src/config/lexicons/type-inference-rules.js';

const enUS = attachTypeInferenceRules(EN_US);

// 项目根目录（从源文件位置计算，而非编译后的 dist 位置）
// 测试运行时从项目根目录运行，所以使用 process.cwd()
const PROJECT_ROOT = process.cwd();

// 合规示例文件路径
const COMPLIANCE_DEMOS = [
  {
    name: 'SOC2 审计链验证',
    path: 'examples/compliance/soc2-audit-demo.aster',
    moduleName: 'examples.compliance.soc2_audit_demo',
    expectedFunctions: ['compute_hash', 'verify_record_integrity', 'verify_chain_link', 'verify_one_record', 'verify_audit_chain', 'generate_soc2_report', 'create_genesis_record', 'append_audit_record', 'demo_valid_chain', 'demo_tampered_chain'],
    expectedRecords: ['AuditRecord', 'ChainVerificationResult', 'ChainState'],
  },
  {
    name: 'HIPAA 访问控制验证',
    path: 'examples/compliance/hipaa-validation-demo.aster',
    moduleName: 'examples.compliance.hipaa_validation_demo',
    expectedFunctions: ['get_access_level', 'get_phi_category', 'validate_access_control', 'validate_consent', 'validate_purpose', 'validate_hipaa_compliance', 'generate_hipaa_report', 'demo_compliant_access', 'demo_non_compliant_access', 'demo_spoofed_access_blocked'],
    expectedRecords: ['AccessLevel', 'PHICategory', 'PHIAccessRequest', 'HIPAAValidation'],
  },
  {
    name: '患者记录管理',
    path: 'examples/healthcare/patient-record.aster',
    moduleName: 'examples.healthcare.patient_record',
    expectedFunctions: ['verify_consent', 'get_patient_summary', 'display_patient_safe', 'demo_compliant_access', 'demo_non_compliant_access'],
    expectedRecords: ['PatientPHI', 'AccessRequest', 'ConsentResult', 'PatientSummary'],
  },
  {
    name: '电子处方工作流',
    path: 'examples/healthcare/prescription-workflow.aster',
    moduleName: 'examples.healthcare.prescription_workflow',
    expectedFunctions: ['check_warfarin_aspirin_interaction', 'validate_prescriber', 'verify_dosage', 'verify_prescription', 'transmit_prescription_safe', 'demo_safe_prescription', 'demo_interaction_prescription'],
    expectedRecords: ['Prescription', 'DrugInteraction', 'PharmacyVerification', 'VerificationStep'],
  },
];

/**
 * 完整编译管道函数
 * @param source CNL 源代码
 * @returns 编译结果和诊断信息
 */
function compileEnd2End(source: string): {
  success: boolean;
  ast: AstModule | null;
  core: Core.Module | null;
  diagnostics: Array<{ severity: string; message: string; code?: string }>;
  error: Error | null;
} {
  try {
    // 阶段 1: 规范化
    const canonical = canonicalize(source);

    // 阶段 2: 词法分析
    const tokens = lex(canonical);

    // 阶段 3: 语法分析
    const ast = parse(tokens, enUS).ast as AstModule;

    // 阶段 4: 降级到核心
    const core = lowerModule(ast);

    // 阶段 5: 类型检查
    const diagnostics = typecheckModule(core);

    // 只有 error 级别的诊断才算失败
    const errors = diagnostics.filter(d => d.severity === 'error');

    return {
      success: errors.length === 0,
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

/**
 * 读取示例文件
 */
function readDemoFile(relativePath: string): string {
  const fullPath = join(PROJECT_ROOT, relativePath);
  if (!existsSync(fullPath)) {
    throw new Error(`示例文件不存在: ${fullPath}`);
  }
  return readFileSync(fullPath, 'utf-8');
}

describe('合规示例冒烟测试', () => {
  for (const demo of COMPLIANCE_DEMOS) {
    describe(demo.name, () => {
      let source: string;
      let result: ReturnType<typeof compileEnd2End>;

      before(() => {
        source = readDemoFile(demo.path);
        result = compileEnd2End(source);
      });

      it('文件应该存在', () => {
        const fullPath = join(PROJECT_ROOT, demo.path);
        assert.ok(existsSync(fullPath), `文件应该存在: ${demo.path}`);
      });

      it('应该成功编译', () => {
        if (result.error) {
          assert.fail(`编译出错: ${result.error.message}\n${result.error.stack}`);
        }
        if (!result.success) {
          const errors = result.diagnostics.filter(d => d.severity === 'error');
          const errorMessages = errors.map(e => `  - ${e.message}`).join('\n');
          assert.fail(`编译失败，发现 ${errors.length} 个错误:\n${errorMessages}`);
        }
        assert.ok(result.success, '编译应该成功');
      });

      it('应该生成有效的 AST', () => {
        assert.ok(result.ast, 'AST 不应该为空');
        assert.equal(result.ast.kind, 'Module', 'AST 根节点应该是 Module');
      });

      it('应该生成有效的 Core IR', () => {
        assert.ok(result.core, 'Core IR 不应该为空');
        assert.equal(result.core.name, demo.moduleName, `模块名应该是 ${demo.moduleName}`);
      });

      it('应该包含预期的函数定义', () => {
        assert.ok(result.core, 'Core IR 不应该为空');
        const funcs = result.core.decls.filter((d): d is Core.Func => d.kind === 'Func');
        const funcNames = funcs.map(f => f.name);

        for (const expectedFunc of demo.expectedFunctions) {
          assert.ok(
            funcNames.includes(expectedFunc),
            `应该包含函数 ${expectedFunc}，实际函数列表: [${funcNames.join(', ')}]`
          );
        }
      });

      it('应该包含预期的记录类型定义', () => {
        assert.ok(result.core, 'Core IR 不应该为空');
        const records = result.core.decls.filter((d): d is Core.Data => d.kind === 'Data');
        const recordNames = records.map(r => r.name);

        for (const expectedRecord of demo.expectedRecords) {
          assert.ok(
            recordNames.includes(expectedRecord),
            `应该包含记录类型 ${expectedRecord}，实际记录类型列表: [${recordNames.join(', ')}]`
          );
        }
      });

      it('不应该有类型错误', () => {
        const typeErrors = result.diagnostics.filter(
          d => d.severity === 'error' && d.code?.startsWith('T')
        );
        if (typeErrors.length > 0) {
          const errorMessages = typeErrors.map(e => `  - [${e.code}] ${e.message}`).join('\n');
          assert.fail(`发现 ${typeErrors.length} 个类型错误:\n${errorMessages}`);
        }
      });

      it('应该支持 // 风格注释', () => {
        // 检查源代码中是否包含 // 风格注释
        const hasDoubleSlashComment = source.includes('//');
        if (hasDoubleSlashComment) {
          // 如果源代码包含 // 注释，验证编译成功证明注释被正确处理
          assert.ok(result.success, '包含 // 注释的文件应该能成功编译');
        }
      });
    });
  }
});

describe('合规示例内容验证', () => {
  describe('SOC2 审计链验证', () => {
    it('应该实现 SHA-256 哈希链结构', () => {
      const source = readDemoFile('examples/compliance/soc2-audit-demo.aster');
      assert.ok(source.includes('SHA-256'), '应该使用 SHA-256 哈希算法');
      assert.ok(source.includes('prev_hash'), '应该包含前一条哈希字段');
      assert.ok(source.includes('current_hash'), '应该包含当前哈希字段');
    });

    it('应该实现双重验证（记录完整性 + 链接完整性）', () => {
      const source = readDemoFile('examples/compliance/soc2-audit-demo.aster');
      assert.ok(source.includes('verify_record_integrity'), '应该包含记录完整性验证');
      assert.ok(source.includes('verify_chain_link'), '应该包含链接完整性验证');
    });
  });

  describe('HIPAA 访问控制验证', () => {
    it('应该实现服务端权限计算（不信任客户端）', () => {
      const source = readDemoFile('examples/compliance/hipaa-validation-demo.aster');
      // 验证 PHIAccessRequest 不包含 access_level 字段
      assert.ok(!source.includes('access_level: AccessLevel'), '请求不应该包含客户端传入的 access_level');
      // 验证服务端重新计算
      assert.ok(source.includes('get_access_level(request.user_role)'), '应该从 user_role 重新计算权限');
    });

    it('应该覆盖三项 HIPAA 验证检查', () => {
      const source = readDemoFile('examples/compliance/hipaa-validation-demo.aster');
      assert.ok(source.includes('§164.312(a)'), '应该覆盖访问控制验证');
      assert.ok(source.includes('§164.508'), '应该覆盖同意验证');
      assert.ok(source.includes('§164.512'), '应该覆盖使用目的验证');
    });
  });

  describe('患者记录管理', () => {
    it('应该实现同意验证函数', () => {
      const source = readDemoFile('examples/healthcare/patient-record.aster');
      assert.ok(source.includes('verify_consent'), '应该包含同意验证函数');
      assert.ok(source.includes('ConsentResult'), '应该包含同意结果类型');
    });

    it('应该实现 PHI 数据脱敏', () => {
      const source = readDemoFile('examples/healthcare/patient-record.aster');
      assert.ok(source.includes('redact'), '应该包含数据脱敏操作');
    });
  });

  describe('电子处方工作流', () => {
    it('应该使用正确的 Result API', () => {
      const source = readDemoFile('examples/healthcare/prescription-workflow.aster');
      // 验证使用 Result.isOk() 或 Result.isErr() 静态方法
      assert.ok(source.includes('Result.isOk') || source.includes('Result.isErr'), '应该使用 Result 静态方法');
    });

    it('应该实现药物相互作用检查', () => {
      const source = readDemoFile('examples/healthcare/prescription-workflow.aster');
      assert.ok(source.includes('warfarin') && source.includes('aspirin'), '应该包含 warfarin-aspirin 相互作用检查');
      assert.ok(source.includes('DrugInteraction'), '应该包含药物相互作用记录类型');
    });
  });
});
