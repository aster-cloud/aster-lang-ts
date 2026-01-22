import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule, typecheckModuleWithCapabilities } from '../../../src/typecheck.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import type { TypecheckDiagnostic } from '../../../src/types.js';
import type { CapabilityManifest } from '../../../src/effects/capabilities.js';

/**
 * 编译源代码并返回类型检查诊断
 */
function runTypecheck(source: string): TypecheckDiagnostic[] {
  const canonical = canonicalize(source);
  const tokens = lex(canonical);
  const ast = parse(tokens);
  const core = lowerModule(ast);
  return typecheckModule(core);
}

/**
 * 为类型检查结果提取诊断代码
 */
function codes(diags: readonly TypecheckDiagnostic[]): string[] {
  return diags.map(d => d.code);
}

describe('效应与能力检查', () => {
  it('resolveAlias 应该在使用别名的 IO 调用时触发缺失 IO 诊断', () => {
    const diagnostics = runTypecheck(`
This module is test.typecheck.alias_missing_io.

Use Http as H.

To fetchUser, produce Text:
  Return H.get("/user").
`);
    assert.equal(diagnostics.some(d => d.code === ErrorCode.EFF_MISSING_IO), true, '缺失 IO 诊断应该存在');
  });

  it('resolveAlias 在声明 IO 效应时不应该产生误报', () => {
    const diagnostics = runTypecheck(`
This module is test.typecheck.alias_with_effect.

Use Http as H.

To fetchUser, produce Text. It performs io:
  Return H.get("/user").
`);
    assert.equal(diagnostics.some(d => d.code === ErrorCode.EFF_MISSING_IO), false, '声明 IO 后不应报告缺失');
  });

  it('未使用任何 IO 调用却声明 io 应该触发冗余警告', () => {
    const diagnostics = runTypecheck(`
This module is test.typecheck.superfluous_io.

To ping, produce Text. It performs io:
  Return "pong".
`);
    // E203 已移除，现在由 E207 (EFF_INFER_REDUNDANT_IO) 基于效应推断检测
    assert.equal(
      diagnostics.some(d => d.code === ErrorCode.EFF_INFER_REDUNDANT_IO),
      true,
      '未使用 IO 时应该提示冗余 io'
    );
  });

  it('声明 cpu 但未进行 CPU 工作应该触发冗余警告', () => {
    const diagnostics = runTypecheck(`
This module is test.typecheck.superfluous_cpu.

To compute, produce Int. It performs cpu:
  Return 1.
`);
    assert.equal(
      diagnostics.some(d => d.code === ErrorCode.EFF_SUPERFLUOUS_CPU),
      true,
      '未执行 CPU 工作时应提示冗余 cpu'
    );
  });

  it('加载自定义 CPU 前缀时缺失 CPU 应触发错误', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'aster-eff-'));
    const configPath = join(tmpDir, 'effects.json');
    const config = {
      patterns: {
        io: {
          http: ['Http.'],
          sql: [],
          files: [],
          secrets: [],
          time: []
        },
        cpu: ['CpuWork.'],
        ai: []
      }
    };
    writeFileSync(configPath, JSON.stringify(config), 'utf8');

    const moduleSource = `
This module is test.typecheck.missing_cpu_under_config.

To heavy, produce Int:
  Return CpuWork.hash(42).
`;

    try {
      const script = `
import { canonicalize } from '${join(process.cwd(), 'dist/src/frontend/canonicalizer.js').replace(/\\/g, '/')}';
import { lex } from '${join(process.cwd(), 'dist/src/frontend/lexer.js').replace(/\\/g, '/')}';
import { parse } from '${join(process.cwd(), 'dist/src/parser.js').replace(/\\/g, '/')}';
import { lowerModule } from '${join(process.cwd(), 'dist/src/lower_to_core.js').replace(/\\/g, '/')}';
import { typecheckModule } from '${join(process.cwd(), 'dist/src/typecheck.js').replace(/\\/g, '/')}';

const source = ${JSON.stringify(moduleSource)};
const canonical = canonicalize(source);
const tokens = lex(canonical);
const ast = parse(tokens);
const core = lowerModule(ast);
const diags = typecheckModule(core);
for (const diag of diags) {
  if (diag.code === '${ErrorCode.EFF_INFER_MISSING_CPU}') {
    console.log('FOUND');
    process.exit(0);
  }
}
process.exit(1);
`;
      execFileSync(
        process.execPath,
        ['--input-type=module', '--eval', script],
        {
          env: {
            ...process.env,
            ASTER_EFFECT_CONFIG: configPath
          }
        }
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('显式能力列表未覆盖使用的调用应触发能力缺失错误', () => {
    const diagnostics = runTypecheck(`
This module is test.typecheck.cap_missing.

To bad, produce Text. It performs io [Http]:
  Return Db.query("select 1").
`);
    assert.equal(
      diagnostics.some(d => d.code === ErrorCode.EFF_CAP_MISSING),
      true,
      '缺少相应能力时应提示错误'
    );
  });

  it('显式能力未使用时应产生信息级别提示', () => {
    const diagnostics = runTypecheck(`
This module is test.typecheck.cap_superfluous.

To onlyHttp, produce Text. It performs io [Sql]:
  Return Http.get("/ping").
`);
    const superfluous = diagnostics.find(d => d.code === ErrorCode.EFF_CAP_SUPERFLUOUS);
    assert.ok(superfluous, '未使用的能力需提示冗余');
    assert.equal(superfluous.severity, 'info');
  });

  it('能力清单禁止调用时应该返回 CAPABILITY_NOT_ALLOWED', () => {
    const source = `
This module is test.typecheck.cap_manifest_block.

To callHttp, produce Text. It performs io [Http]:
  Return Http.get("/ban").
`;
    const canonical = canonicalize(source);
    const tokens = lex(canonical);
    const ast = parse(tokens);
    const core = lowerModule(ast);
    const manifest: CapabilityManifest = {
      allow: {
        Http: ['test.typecheck.cap_manifest_block.safe*']
      }
    };
    const diagnostics = typecheckModuleWithCapabilities(core, manifest);
    assert.equal(
      diagnostics.some(d => d.code === ErrorCode.CAPABILITY_NOT_ALLOWED),
      true,
      '清单禁止时应返回错误'
    );
  });

  it('能力清单允许调用时不应产生禁止诊断', () => {
    const source = `
This module is test.typecheck.cap_manifest_allow.

To callHttp, produce Text. It performs io [Http]:
  Return Http.get("/ok").
`;
    const canonical = canonicalize(source);
    const tokens = lex(canonical);
    const ast = parse(tokens);
    const core = lowerModule(ast);
    const allowPattern = ['test.typecheck.cap_manifest_allow.*'];
    const manifest: CapabilityManifest = {
      allow: {
        Http: allowPattern,
        Sql: allowPattern,
        Time: allowPattern,
        Files: allowPattern,
        Secrets: allowPattern,
        AiModel: allowPattern
      }
    };
    const diagnostics = typecheckModuleWithCapabilities(core, manifest);
    assert.equal(
      diagnostics.some(d => d.code === ErrorCode.CAPABILITY_NOT_ALLOWED),
      false,
      '允许模式应通过检查'
    );
  });
});
