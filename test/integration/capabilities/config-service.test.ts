/**
 * ConfigService 单元测试
 *
 * 测试配置管理服务的核心功能：
 * - 单例模式
 * - 环境变量读取
 * - 默认值处理
 * - 测试环境重置
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigService } from '../../../src/config/config-service.js';
import { LogLevel } from '../../../src/utils/logger.js';

describe('ConfigService', () => {
  beforeEach(() => {
    // 每次测试前重置单例
    ConfigService.resetForTesting();
  });

  describe('单例模式', () => {
    it('应该返回相同的实例', () => {
      const instance1 = ConfigService.getInstance();
      const instance2 = ConfigService.getInstance();
      assert.equal(instance1, instance2, '应该返回相同的单例实例');
    });

    it('重置后应该创建新实例', () => {
      const instance1 = ConfigService.getInstance();
      ConfigService.resetForTesting();
      const instance2 = ConfigService.getInstance();
      assert.notEqual(instance1, instance2, '重置后应该创建新实例');
    });
  });

  describe('配置读取', () => {
    it('应该正确读取 effectsEnforce 默认值', () => {
      delete process.env.ASTER_CAP_EFFECTS_ENFORCE;
      const config = ConfigService.getInstance();
      assert.equal(config.effectsEnforce, true, 'effectsEnforce 默认应为 true');
    });

    it('应该正确读取 effectsEnforce=0 时的值', () => {
      process.env.ASTER_CAP_EFFECTS_ENFORCE = '0';
      const config = ConfigService.getInstance();
      assert.equal(config.effectsEnforce, false, '设置为 0 时应为 false');
    });

    it('应该正确读取 effectsEnforce=1 时的值', () => {
      process.env.ASTER_CAP_EFFECTS_ENFORCE = '1';
      const config = ConfigService.getInstance();
      assert.equal(config.effectsEnforce, true, '设置为 1 时应为 true');
    });

    it('应该正确读取 effectConfigPath 默认值', () => {
      delete process.env.ASTER_EFFECT_CONFIG;
      const config = ConfigService.getInstance();
      assert.equal(config.effectConfigPath, '.aster/effects.json', 'effectConfigPath 默认应为 .aster/effects.json');
    });

    it('应该正确读取自定义 effectConfigPath', () => {
      process.env.ASTER_EFFECT_CONFIG = '/custom/path/effects.json';
      const config = ConfigService.getInstance();
      assert.equal(config.effectConfigPath, '/custom/path/effects.json', '应该使用自定义路径');
    });

    it('应该正确读取 logLevel 默认值', () => {
      delete process.env.LOG_LEVEL;
      const config = ConfigService.getInstance();
      assert.equal(config.logLevel, LogLevel.INFO, 'logLevel 默认应为 INFO');
    });

    it('应该正确解析 LOG_LEVEL=DEBUG', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      const config = ConfigService.getInstance();
      assert.equal(config.logLevel, LogLevel.DEBUG, 'LOG_LEVEL=DEBUG 应解析为 LogLevel.DEBUG');
    });

    it('应该正确解析 LOG_LEVEL=WARN', () => {
      process.env.LOG_LEVEL = 'WARN';
      const config = ConfigService.getInstance();
      assert.equal(config.logLevel, LogLevel.WARN, 'LOG_LEVEL=WARN 应解析为 LogLevel.WARN');
    });

    it('应该正确解析 LOG_LEVEL=ERROR', () => {
      process.env.LOG_LEVEL = 'ERROR';
      const config = ConfigService.getInstance();
      assert.equal(config.logLevel, LogLevel.ERROR, 'LOG_LEVEL=ERROR 应解析为 LogLevel.ERROR');
    });

    it('应该忽略无效的 LOG_LEVEL 值', () => {
      process.env.LOG_LEVEL = 'INVALID';
      const config = ConfigService.getInstance();
      assert.equal(config.logLevel, LogLevel.INFO, '无效值应使用默认 INFO');
    });

    it('应该正确读取 capsManifestPath 默认值', () => {
      delete process.env.ASTER_CAPS;
      const config = ConfigService.getInstance();
      assert.equal(config.capsManifestPath, null, 'capsManifestPath 默认应为 null');
    });

    it('应该正确读取自定义 capsManifestPath', () => {
      process.env.ASTER_CAPS = '/path/to/capabilities.json';
      const config = ConfigService.getInstance();
      assert.equal(config.capsManifestPath, '/path/to/capabilities.json', '应该使用自定义路径');
    });

    it('应该正确读取 debugTypes 默认值', () => {
      delete process.env.ASTER_DEBUG_TYPES;
      const config = ConfigService.getInstance();
      assert.equal(config.debugTypes, false, 'debugTypes 默认应为 false');
    });

    it('应该正确读取 debugTypes=1 时的值', () => {
      process.env.ASTER_DEBUG_TYPES = '1';
      const config = ConfigService.getInstance();
      assert.equal(config.debugTypes, true, '设置为 1 时应为 true');
    });

    it('应该正确读取 debugTypes=0 时的值', () => {
      process.env.ASTER_DEBUG_TYPES = '0';
      const config = ConfigService.getInstance();
      assert.equal(config.debugTypes, false, '设置为 0 时应为 false');
    });
  });

  describe('配置不可变性', () => {
    it('配置值应该只读（编译时保护）', () => {
      const config = ConfigService.getInstance();

      // TypeScript 通过 readonly 提供编译时保护
      // 在运行时，readonly 不会阻止赋值（JavaScript 限制）
      // 这里我们验证 TypeScript 定义包含 readonly
      const initialValue = config.effectsEnforce;

      // @ts-expect-error - 测试 TypeScript 编译时保护
      config.effectsEnforce = !initialValue;

      // 在 JavaScript 运行时，由于没有 Object.freeze，赋值会成功
      // 但编译时已经通过 readonly 提供了保护
      // 验证编译时类型系统正确标记为 readonly
      assert.equal(typeof config.effectsEnforce, 'boolean', 'effectsEnforce 应该是 boolean 类型');
    });
  });
});
