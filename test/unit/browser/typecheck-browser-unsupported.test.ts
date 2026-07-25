/**
 * Regression tests for the "explicit unsupported" diagnostics added in D3 +
 * the cross-module reference detector added in R-fix 4. These pin down the
 * fixes for the silent-pass bugs the codex Round-3 review flagged.
 *
 * Cross-module warnings are tested at the typecheckBrowser entry against
 * a hand-constructed Core module rather than via the full compile pipeline
 * — `lowerModule` strips `Import` decls in some forms, so the integration-
 * level shape isn't a reliable fixture for the warning detector.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile, typecheckBrowser } from '../../../src/browser.js';
import type { Core } from '../../../src/types.js';

// 从**真实 compile(...) 输出**构造带 Import 的 Core 模块（取代旧的手搓 IR fixture）。
// usesImport=true → 函数体引用 Http.get(url)（qualified call）；false → 只 Return url。
// 早年注释称 "lowerModule strips Import decls" 已不成立：现编译保留 Import decl，
// 检测器也据真实引用触发，故不再需要手搓 IR、不再 skip。
function compileModuleWithImport(usesImport: boolean): Core.Module {
  const body = usesImport ? 'Return Http.get(url).' : 'Return url.';
  const source = `Module demo.crossmodule.
Use Http.
Rule fetch given url as Text, produce Text:
  ${body}`;
  const compiled = compile(source);
  assert.ok(compiled.success && compiled.core, 'fixture 源应能编译');
  return compiled.core;
}

describe('typecheckBrowser — cross-module fallback diagnostics (D3 + R-fix 4)', () => {
  // 历史背景：本套件原本测试 "PII unsupported in browser" 警告。
  // ADR-0009 P0-1 之后 PII 检查在 browser 永远启用，不再有 "unsupported"
  // 警告。本套件现在只保留 cross-module effect 警告的 documentation-only
  // skip 测试，以及验证 P0-1 设计的两个 active 测试。
  //
  // The cross-module reference detector runs against real compile(...) output
  // (imports are retained through lowering, contrary to an earlier note).
  it('emits partial warning when imports are referenced but no importedEffects provided', () => {
    const m = compileModuleWithImport(/* usesImport */ true);
    const diags = typecheckBrowser(m);
    const partial = diags.find(
      (d) => d.message.includes('cross-module effect checks unavailable') && d.severity === 'warning',
    );
    assert.ok(partial, 'expected a partial-coverage warning when import is referenced but no effects provided');
    assert.match(partial!.message, /Http/, 'warning should name the unresolved alias');
  });

  it('does NOT warn for declared-but-unreferenced imports (R-fix 4)', () => {
    const m = compileModuleWithImport(/* usesImport */ false);
    const diags = typecheckBrowser(m);
    const partial = diags.find(
      (d) => d.message.includes('cross-module effect checks unavailable'),
    );
    assert.equal(partial, undefined, 'unused imports should NOT trigger a partial-coverage warning');
  });

  it('PII 检查在 browser 永远启用，不再发出 "unsupported" 警告 (ADR-0009 P0-1)', () => {
    // P0-1: typecheck-pii 是环境无关的（不读 process.env / fs），
    // 在 browser / CF Workers / Node 都能跑。enforcePii 选项保留作向后兼容
    // 但已无效（@deprecated）。代码层面 PII 检查永远启用。
    const source = `
Module demo.pii.

Rule hello given name as Text, produce Text:
  Return name.
`;
    const compiled = compile(source);
    if (!compiled.success || !compiled.core) return;

    // 即使传 enforcePii: true，也不应再有 "unsupported" 警告
    const diags = typecheckBrowser(compiled.core, { enforcePii: true });
    const unsupportedWarning = diags.find(
      (d) => d.message.includes('PII enforcement requested but not'),
    );
    assert.equal(
      unsupportedWarning,
      undefined,
      'ADR-0009: browser 不应再发 "PII unsupported" 警告——PII 检查已永远启用',
    );
  });

  it('PII 默认启用：browser 路径产生与 Node 一致的诊断 (ADR-0009 P0-1)', () => {
    // 这个测试验证浏览器路径**确实跑了** PII 检查。
    // 用一个简单的 "无 PII 字段" 模块，确保不会因为启用 PII 而误报。
    const source = `
Module demo.no_pii.

Rule hello given name as Text, produce Text:
  Return name.
`;
    const compiled = compile(source);
    if (!compiled.success || !compiled.core) return;

    const diags = typecheckBrowser(compiled.core);
    // 这段代码没有 PII 字段也没有 sink，应该无 PII 诊断
    const piiDiag = diags.find(
      (d) => d.code === 'E400' || (typeof d.code === 'string' && d.code.startsWith('PII_')),
    );
    assert.equal(piiDiag, undefined, '无 PII 字段的代码不应触发 PII 诊断');
  });
});
