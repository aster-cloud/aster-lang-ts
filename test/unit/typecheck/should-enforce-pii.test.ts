/**
 * shouldEnforcePii 函数 stub 行为测试 (P0-1 / ADR-0009 之后)。
 *
 * 自 ADR-0009 起，PII flow 分析**永远启用**——不再依赖 LSP 配置、环境变量
 * 或任何配置开关。shouldEnforcePii() 退化为 backwards-compat stub，
 * 总是返回 true。
 *
 * 本测试只验证 stub 在所有可能的环境状态下都返回 true，确保不会有
 * 意外的"配置作用"。下一个 major release 中此函数将被移除。
 */
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { shouldEnforcePii } from '../../../src/typecheck/utils.js';

interface EnvSnapshot {
  ENFORCE_PII: string | undefined;
  ASTER_ENFORCE_PII: string | undefined;
  lspConfig: typeof globalThis.lspConfig;
}

function saveEnv(): EnvSnapshot {
  return {
    ENFORCE_PII: process.env.ENFORCE_PII,
    ASTER_ENFORCE_PII: process.env.ASTER_ENFORCE_PII,
    lspConfig: globalThis.lspConfig,
  };
}

function restoreEnv(snapshot: EnvSnapshot): void {
  if (snapshot.ENFORCE_PII === undefined) {
    delete process.env.ENFORCE_PII;
  } else {
    process.env.ENFORCE_PII = snapshot.ENFORCE_PII;
  }
  if (snapshot.ASTER_ENFORCE_PII === undefined) {
    delete process.env.ASTER_ENFORCE_PII;
  } else {
    process.env.ASTER_ENFORCE_PII = snapshot.ASTER_ENFORCE_PII;
  }
  if (snapshot.lspConfig === undefined) {
    (globalThis as any).lspConfig = undefined;
  } else {
    globalThis.lspConfig = snapshot.lspConfig;
  }
}

function clearAllConfig(): void {
  delete process.env.ENFORCE_PII;
  delete process.env.ASTER_ENFORCE_PII;
  (globalThis as any).lspConfig = undefined;
}

describe('shouldEnforcePii (deprecated stub, ADR-0009)', () => {
  let originalEnv: EnvSnapshot;

  before(() => {
    originalEnv = saveEnv();
  });

  after(() => {
    restoreEnv(originalEnv);
  });

  beforeEach(() => {
    clearAllConfig();
  });

  afterEach(() => {
    clearAllConfig();
  });

  it('无任何配置时返回 true（不再默认禁用）', () => {
    assert.equal(shouldEnforcePii(), true);
  });

  it('忽略 globalThis.lspConfig.enforcePiiChecks = false', () => {
    globalThis.lspConfig = { enforcePiiChecks: false };
    assert.equal(
      shouldEnforcePii(),
      true,
      'PII 现在永远启用，LSP 配置已被忽略',
    );
  });

  it('忽略 ENFORCE_PII=false', () => {
    process.env.ENFORCE_PII = 'false';
    assert.equal(shouldEnforcePii(), true);
  });

  it('忽略 ASTER_ENFORCE_PII=false', () => {
    process.env.ASTER_ENFORCE_PII = 'false';
    assert.equal(shouldEnforcePii(), true);
  });

  it('即使所有禁用配置同时设置也返回 true', () => {
    globalThis.lspConfig = { enforcePiiChecks: false };
    process.env.ENFORCE_PII = 'false';
    process.env.ASTER_ENFORCE_PII = 'false';
    assert.equal(shouldEnforcePii(), true);
  });
});
