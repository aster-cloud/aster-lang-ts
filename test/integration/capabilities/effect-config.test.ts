#!/usr/bin/env node
/**
 * 效果推断配置系统测试
 *
 * 测试配置加载、深度合并、类型验证和降级机制。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadEffectConfig, getIOPrefixes, getCPUPrefixes, resetConfigForTesting } from '../../../src/config/effect_config.js';
import { ConfigService } from '../../../src/config/config-service.js';

const TEST_DIR = '/tmp/aster-effect-config-test';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

function assertArrayEqual(actual: readonly string[], expected: readonly string[], message: string): void {
  if (
    actual.length !== expected.length ||
    actual.some((v, i) => v !== expected[i])
  ) {
    throw new Error(`${message}\n实际: [${actual.join(', ')}]\n期望: [${expected.join(', ')}]`);
  }
}

function assertArrayContains(
  actual: readonly string[],
  expected: readonly string[],
  message: string
): void {
  const missing = expected.filter((item) => !actual.includes(item));
  if (missing.length > 0) {
    throw new Error(`${message}\n缺失元素: [${missing.join(', ')}]`);
  }
}

function setup(): void {
  // 创建测试目录
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
}

function teardown(): void {
  // 清理测试文件
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  // 清除环境变量
  delete process.env.ASTER_EFFECT_CONFIG;
  // 重置配置缓存和单例
  resetConfigForTesting();
  ConfigService.resetForTesting();
}

function writeTestConfig(filename: string, content: string): string {
  const filepath = path.join(TEST_DIR, filename);
  fs.writeFileSync(filepath, content, 'utf8');
  return filepath;
}

// ============================================================
// 测试用例
// ============================================================

function testDefaultConfig(): void {
  setup();
  process.env.ASTER_EFFECT_CONFIG = '/nonexistent/config.json';

  const prefixes = getIOPrefixes();
  assertArrayContains(
    prefixes,
    ['IO.', 'Http.', 'Db.', 'UUID.randomUUID'],
    '默认配置应包含所有标准前缀'
  );

  teardown();
  console.log('✓ 配置文件不存在时正确降级到默认配置');
}

async function testFullConfig(): Promise<void> {
  setup();
  const config = {
    patterns: {
      io: {
        http: ['MyHttp.', 'CustomClient.'],
        sql: ['MyDb.'],
        files: ['MyFs.'],
        secrets: ['MyVault.'],
        time: ['MyClock.'],
      },
      cpu: ['MyCpu.'],
      ai: ['MyAI.'],
    },
  };

  const filepath = writeTestConfig('full-config.json', JSON.stringify(config, null, 2));
  process.env.ASTER_EFFECT_CONFIG = filepath;

  // 重置配置缓存以重新读取配置文件
  resetConfigForTesting();
  ConfigService.resetForTesting();

  const prefixes = getIOPrefixes();
  assertArrayContains(
    prefixes,
    ['MyHttp.', 'CustomClient.', 'MyDb.', 'MyFs.', 'MyVault.', 'MyClock.'],
    '完整配置应包含所有自定义前缀'
  );

  teardown();
  console.log('✓ 完整配置加载成功');
}

async function testPartialConfig(): Promise<void> {
  setup();
  // 只提供 io.http，其他字段应从默认配置填充
  const config = {
    patterns: {
      io: {
        http: ['PartialClient.'],
      },
    },
  };

  const filepath = writeTestConfig('partial-config.json', JSON.stringify(config));
  process.env.ASTER_EFFECT_CONFIG = filepath;

  // 重置配置缓存以重新读取配置文件
  resetConfigForTesting();
  ConfigService.resetForTesting();

  const prefixes = getIOPrefixes();
  assert(prefixes.includes('PartialClient.'), '应包含自定义 http 前缀');
  assert(prefixes.includes('Db.'), '应保留默认 sql 前缀 Db.');
  assert(prefixes.includes('UUID.randomUUID'), '应保留默认 secrets 前缀');

  teardown();
  console.log('✓ 部分配置正确合并默认值');
}

async function testEmptyConfig(): Promise<void> {
  setup();
  const filepath = writeTestConfig('empty-config.json', '{}');
  process.env.ASTER_EFFECT_CONFIG = filepath;

  // 重置配置缓存以重新读取配置文件
  resetConfigForTesting();
  ConfigService.resetForTesting();

  const prefixes = getIOPrefixes();
  assertArrayContains(
    prefixes,
    ['IO.', 'Http.', 'Db.'],
    '空配置应完全降级到默认配置'
  );

  teardown();
  console.log('✓ 空配置正确降级到默认配置');
}

async function testInvalidArrayType(): Promise<void> {
  setup();
  // http 字段是字符串而非数组
  const config = {
    patterns: {
      io: {
        http: 'InvalidString',
      },
    },
  };

  const filepath = writeTestConfig('invalid-type.json', JSON.stringify(config));
  process.env.ASTER_EFFECT_CONFIG = filepath;

  // 重置配置缓存以重新读取配置文件
  resetConfigForTesting();
  ConfigService.resetForTesting();

  const prefixes = getIOPrefixes();
  // 应该降级到默认的 http 前缀
  assertArrayContains(
    prefixes,
    ['IO.', 'Http.'],
    '无效类型应降级到默认值'
  );

  teardown();
  console.log('✓ 无效数组类型正确降级到默认值');
}

async function testMixedArrayElements(): Promise<void> {
  setup();
  // 数组包含非字符串元素
  const config = {
    patterns: {
      io: {
        http: ['ValidPrefix.', 123, null, 'AnotherValid.', { invalid: true }],
      },
    },
  };

  const filepath = writeTestConfig('mixed-array.json', JSON.stringify(config));
  process.env.ASTER_EFFECT_CONFIG = filepath;

  // 重置配置缓存以重新读取配置文件
  resetConfigForTesting();
  ConfigService.resetForTesting();

  const prefixes = getIOPrefixes();
  assert(prefixes.includes('ValidPrefix.'), '应保留有效字符串');
  assert(prefixes.includes('AnotherValid.'), '应保留所有有效字符串');
  assert(!prefixes.includes('123' as any), '应过滤非字符串元素');

  teardown();
  console.log('✓ 混合数组元素正确过滤非字符串');
}

async function testMalformedJSON(): Promise<void> {
  setup();
  const filepath = writeTestConfig('malformed.json', '{invalid json}');
  process.env.ASTER_EFFECT_CONFIG = filepath;

  // 重置配置缓存以重新读取配置文件
  resetConfigForTesting();
  ConfigService.resetForTesting();

  const prefixes = getIOPrefixes();
  assertArrayContains(
    prefixes,
    ['IO.', 'Http.', 'Db.'],
    'JSON解析失败应降级到默认配置'
  );

  teardown();
  console.log('✓ 格式错误的JSON正确降级到默认配置');
}

// ============================================================
// 运行所有测试
// ============================================================

async function runTests(): Promise<void> {
  console.log('开始测试效果推断配置系统...\n');

  try {
    testDefaultConfig();
    await testFullConfig();
    await testPartialConfig();
    await testEmptyConfig();
    await testInvalidArrayType();
    await testMixedArrayElements();
    await testMalformedJSON();

    console.log('\n✅ 所有测试通过！');
  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    process.exit(1);
  }
}

runTests();
