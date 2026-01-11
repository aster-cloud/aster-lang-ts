/**
 * shouldEnforcePii 函数单元测试
 *
 * 测试 PII 检查启用逻辑的配置优先级：
 * 1. LSP 配置注入（globalThis.lspConfig.enforcePiiChecks）
 * 2. 环境变量（ENFORCE_PII 或 ASTER_ENFORCE_PII）
 * 3. 默认值 false（opt-in 策略）
 */
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { shouldEnforcePii } from '../../../src/typecheck/utils.js';

// 保存原始环境状态
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

describe('shouldEnforcePii 配置优先级', () => {
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

  // 优先级 1: LSP 配置注入
  describe('优先级 1: LSP 配置注入 (globalThis.lspConfig)', () => {
    it('globalThis.lspConfig.enforcePiiChecks = true 应启用 PII 检查', () => {
      globalThis.lspConfig = { enforcePiiChecks: true };
      assert.equal(shouldEnforcePii(), true);
    });

    it('globalThis.lspConfig.enforcePiiChecks = false 应禁用 PII 检查', () => {
      globalThis.lspConfig = { enforcePiiChecks: false };
      assert.equal(shouldEnforcePii(), false);
    });

    it('LSP 配置应优先于环境变量 ENFORCE_PII', () => {
      process.env.ENFORCE_PII = 'true';
      globalThis.lspConfig = { enforcePiiChecks: false };
      assert.equal(shouldEnforcePii(), false, 'LSP 配置 false 应覆盖环境变量 true');

      globalThis.lspConfig = { enforcePiiChecks: true };
      process.env.ENFORCE_PII = 'false';
      assert.equal(shouldEnforcePii(), true, 'LSP 配置 true 应覆盖环境变量 false');
    });

    it('LSP 配置应优先于环境变量 ASTER_ENFORCE_PII', () => {
      process.env.ASTER_ENFORCE_PII = 'true';
      globalThis.lspConfig = { enforcePiiChecks: false };
      assert.equal(shouldEnforcePii(), false, 'LSP 配置 false 应覆盖 ASTER_ENFORCE_PII true');
    });

    it('LSP 配置未定义 enforcePiiChecks 时应回退到环境变量', () => {
      globalThis.lspConfig = {}; // enforcePiiChecks 未定义
      process.env.ENFORCE_PII = 'true';
      assert.equal(shouldEnforcePii(), true, '应回退到环境变量');
    });
  });

  // 优先级 2: 环境变量
  describe('优先级 2: 环境变量', () => {
    it('ENFORCE_PII=true 应启用 PII 检查', () => {
      process.env.ENFORCE_PII = 'true';
      assert.equal(shouldEnforcePii(), true);
    });

    it('ASTER_ENFORCE_PII=true 应启用 PII 检查', () => {
      process.env.ASTER_ENFORCE_PII = 'true';
      assert.equal(shouldEnforcePii(), true);
    });

    it('ENFORCE_PII 优先于 ASTER_ENFORCE_PII（|| 短路逻辑）', () => {
      process.env.ENFORCE_PII = 'true';
      process.env.ASTER_ENFORCE_PII = 'false';
      assert.equal(shouldEnforcePii(), true, 'ENFORCE_PII=true 应优先');

      clearAllConfig();
      process.env.ENFORCE_PII = 'false';
      process.env.ASTER_ENFORCE_PII = 'true';
      // ENFORCE_PII='false' 是 truthy 字符串，所以不会回退到 ASTER_ENFORCE_PII
      // 但 toLowerCase() === 'true' 检查会失败
      assert.equal(shouldEnforcePii(), false, 'ENFORCE_PII=false 优先，且不等于 true');
    });

    it('大小写不敏感匹配 TRUE/True/TRUE', () => {
      process.env.ENFORCE_PII = 'TRUE';
      assert.equal(shouldEnforcePii(), true, 'TRUE 应匹配');

      clearAllConfig();
      process.env.ENFORCE_PII = 'True';
      assert.equal(shouldEnforcePii(), true, 'True 应匹配');

      clearAllConfig();
      process.env.ASTER_ENFORCE_PII = 'TRUE';
      assert.equal(shouldEnforcePii(), true, 'ASTER_ENFORCE_PII=TRUE 应匹配');
    });

    it('非 true 值应禁用 PII 检查', () => {
      process.env.ENFORCE_PII = 'false';
      assert.equal(shouldEnforcePii(), false, 'false 应禁用');

      clearAllConfig();
      process.env.ENFORCE_PII = '1';
      assert.equal(shouldEnforcePii(), false, '1 应禁用（不等于 true）');

      clearAllConfig();
      process.env.ENFORCE_PII = 'yes';
      assert.equal(shouldEnforcePii(), false, 'yes 应禁用（不等于 true）');

      clearAllConfig();
      process.env.ENFORCE_PII = '';
      assert.equal(shouldEnforcePii(), false, '空字符串应禁用');
    });
  });

  // 优先级 3: 默认值
  describe('优先级 3: 默认禁用', () => {
    it('无任何配置时应默认禁用 PII 检查', () => {
      // clearAllConfig() 已在 beforeEach 中执行
      assert.equal(shouldEnforcePii(), false);
    });

    it('globalThis.lspConfig 为 undefined 且无环境变量时应禁用', () => {
      assert.equal(globalThis.lspConfig, undefined);
      assert.equal(process.env.ENFORCE_PII, undefined);
      assert.equal(process.env.ASTER_ENFORCE_PII, undefined);
      assert.equal(shouldEnforcePii(), false);
    });
  });

  // 边界情况
  describe('边界情况', () => {
    it('globalThis.lspConfig 存在但 enforcePiiChecks 为 undefined', () => {
      globalThis.lspConfig = { someOtherConfig: 'value' } as typeof globalThis.lspConfig;
      assert.equal(shouldEnforcePii(), false, '应回退到默认值');
    });

    it('环境变量为空字符串时应禁用', () => {
      process.env.ENFORCE_PII = '';
      process.env.ASTER_ENFORCE_PII = '';
      assert.equal(shouldEnforcePii(), false);
    });

    it('环境变量为空格时应禁用', () => {
      process.env.ENFORCE_PII = '   ';
      assert.equal(shouldEnforcePii(), false, '空格不等于 true');
    });

    it('环境变量为 true 加空格时应禁用', () => {
      process.env.ENFORCE_PII = ' true ';
      // toLowerCase() === 'true' 检查会失败，因为有空格
      assert.equal(shouldEnforcePii(), false, '" true " 不等于 "true"');
    });
  });
});
