import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import {
  StabilityGate,
  STABILITY_EXPERIMENTAL_CODE,
  type StabilityDiagnostic,
  type StabilityFeatureId,
} from '../../../src/stability/stability_gate.js';
import type { Core } from '../../../src/types.js';

function lower(src: string): Core.Module {
  return lowerModule(parse(lex(canonicalize(src))).ast);
}

function scanSource(src: string, strict = false): StabilityDiagnostic[] {
  return StabilityGate.scan(lower(src), { strict });
}

function featureIds(src: string, strict = false): StabilityFeatureId[] {
  return scanSource(src, strict)
    .map((d) => d.data.featureId)
    .sort();
}

describe('StabilityGate — 5 类 Experimental 检测（positive）', () => {
  it('workflow: Start/Wait 语句触发', () => {
    const ids = featureIds(`
Module test.wf.

Rule process, produce Text:
  Start task as async fetch().
  Wait for task.
  Return "done".
`);
    assert.ok(ids.includes('workflow'), 'Start/Wait 应触发 workflow');
  });

  it('version-import: Use ... version N 触发', () => {
    const ids = featureIds(`
Module test.vi.

Use risk.Scoring version 2 as Score.
Use Http as H.

Rule greet, produce Text:
  Return "hi".
`);
    assert.ok(ids.includes('version-import'), 'version import 应触发');
  });

  it('effect-capabilities: @io [Http] 显式 caps 触发', () => {
    const ids = featureIds(`
Module test.eff.

Rule fetch, produce Text. It performs io [Http]:
  Return Http.get("/x").
`);
    assert.ok(ids.includes('effect-capabilities'), '显式 caps 应触发');
  });

  it('pii: @pii 参数触发', () => {
    const ids = featureIds(`
Module test.pii.

Rule secure given field as @pii(L2, email) Text, produce Text:
  Return field.
`);
    assert.ok(ids.includes('pii'), '@pii 应触发');
  });

  it('deprecated-annotation: @deprecated 触发', () => {
    const ids = featureIds(`
Module test.anno.

@deprecated
Rule oldRule, produce Text:
  Return "x".
`);
    assert.ok(ids.includes('deprecated-annotation'), '@deprecated 应触发');
  });

  it('deprecated-annotation: @Example 大小写不敏感触发', () => {
    const ids = featureIds(`
Module test.anno2.

@example
Rule demo, produce Text:
  Return "x".
`);
    assert.ok(ids.includes('deprecated-annotation'), '@example 应触发');
  });
});

describe('StabilityGate — Stable 特性不触发（false-positive 对照）', () => {
  it('裸 @io（无显式 caps）不触发 effect-capabilities（★关键 parity 陷阱）', () => {
    const ids = featureIds(`
Module test.stable_io.

Rule fetch, produce Text. It performs io:
  Return Http.get("/x").
`);
    assert.ok(!ids.includes('effect-capabilities'), '裸 @io 是 Stable，不该触发');
  });

  it('@entry 不触发 deprecated-annotation', () => {
    const ids = featureIds(`
Module test.stable_entry.

@entry
Rule main, produce Text:
  Return "x".
`);
    assert.ok(!ids.includes('deprecated-annotation'), '@entry 是 Stable，不该触发');
  });

  it('无 version 的 import 不触发', () => {
    const ids = featureIds(`
Module test.stable_import.

Use Http as H.

Rule greet, produce Text:
  Return "hi".
`);
    assert.ok(!ids.includes('version-import'), '无 version import 不该触发');
  });

  it('纯 Stable 模块诊断为空', () => {
    const diags = scanSource(`
Module test.pure_stable.

Rule greet given name as Text, produce Text. It performs io:
  Return name.
`);
    assert.equal(diags.length, 0, '纯 Stable 模块不该有诊断');
  });
});

describe('StabilityGate — 嵌套检测', () => {
  it('if 块内的 Workflow 语句被检出', () => {
    const ids = featureIds(`
Module test.nested_wf.

Rule process given flag as Bool, produce Text:
  If flag:
    Start task as async fetch().
    Return "async".
  Otherwise:
    Return "sync".
`);
    assert.ok(ids.includes('workflow'), '嵌套 if 内 Start 应被检出');
  });

  it('嵌套 List of @pii 类型被检出（★类型树递归，Codex P1）', () => {
    // @pii 包在 List 里——须递归类型树才能命中。
    const ids = featureIds(`
Module test.nested_pii.

Rule collect given items as List of @pii(L2, email) Text, produce Text:
  Return "ok".
`);
    assert.ok(ids.includes('pii'), 'List 里嵌套的 @pii 应被检出');
  });

  it('返回类型上的 @pii 被检出', () => {
    const ids = featureIds(`
Module test.ret_pii.

Rule getEmail, produce @pii(L2, email) Text:
  Return "user@example.com".
`);
    assert.ok(ids.includes('pii'), '返回类型 @pii 应被检出');
  });
});

describe('StabilityGate — strict 语义（severity 恒 warning，strict 走 blocking）', () => {
  const src = `
Module test.strict.

@deprecated
Rule oldRule, produce Text:
  Return "x".
`;

  it('severity 恒为 warning，strict 不改 severity', () => {
    const warn = scanSource(src, false);
    const strict = scanSource(src, true);
    assert.ok(warn.every((d) => d.severity === 'warning'));
    assert.ok(strict.every((d) => d.severity === 'warning'), 'strict 也是 warning severity');
  });

  it('strict=true 时 data.blocking=true', () => {
    const strict = scanSource(src, true);
    assert.ok(strict.length > 0);
    assert.ok(strict.every((d) => d.data.blocking === true), 'strict 时 blocking=true');
    const warn = scanSource(src, false);
    assert.ok(warn.every((d) => d.data.blocking === false), 'warn 时 blocking=false');
  });

  it('shouldRejectForStability: strict + 有 W600 → 拒', () => {
    const strict = scanSource(src, true);
    assert.equal(StabilityGate.shouldRejectForStability(strict, true), true);
    assert.equal(StabilityGate.shouldRejectForStability(strict, false), false);
    assert.equal(StabilityGate.shouldRejectForStability([], true), false);
  });

  it('code 恒为 W600，含 featureId + moduleName + span', () => {
    const diags = scanSource(src, false);
    assert.ok(diags.length > 0);
    for (const d of diags) {
      assert.equal(d.code, STABILITY_EXPERIMENTAL_CODE);
      assert.ok(d.data.featureId);
      assert.equal(d.data.moduleName, 'test.strict');
      // span 存在且合理（不逐字节比，ADR §7）。
      if (d.span) {
        assert.ok(d.span.start.line >= 1);
      }
    }
  });
});

describe('StabilityGate — allowExperimental 放行', () => {
  it('allowExperimental=true 返回空（显式放行）', () => {
    const diags = StabilityGate.scan(
      lower(`
Module test.allow.

@deprecated
Rule oldRule, produce Text:
  Return "x".
`),
      { strict: true, allowExperimental: true },
    );
    assert.equal(diags.length, 0, 'allowExperimental 应返回空');
  });
});
