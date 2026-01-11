import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigService } from '../../../src/config/config-service.js';
import { LogLevel } from '../../../src/utils/logger.js';

type EffectConfigModule = typeof import('../../../src/config/effect_config.js');

const ENV_KEYS = [
  'ASTER_CAP_EFFECTS_ENFORCE',
  'ASTER_EFFECT_CONFIG',
  'ASTER_CAPS',
  'ASTER_DEBUG_TYPES',
  'LOG_LEVEL',
];

const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
);

const DEFAULT_HTTP_PREFIXES = ['IO.', 'Http.', 'AuthRepo.', 'ProfileSvc.', 'FeedSvc.'];
const DEFAULT_SQL_PREFIXES = ['Db.'];
const DEFAULT_SECRETS_PREFIXES = ['UUID.randomUUID'];

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (typeof value === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function setEnv(key: string, value: string): void {
  process.env[key] = value;
}

function createTempFile(raw: string): { path: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-service-test-'));
  const filePath = path.join(dir, 'effects.json');
  fs.writeFileSync(filePath, raw, 'utf8');
  return {
    path: filePath,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function createTempJsonFile(data: unknown): { path: string; cleanup: () => void } {
  return createTempFile(JSON.stringify(data));
}

async function importEffectModule(cacheBust: string): Promise<EffectConfigModule> {
  const url = new URL('../../../src/config/effect_config.js', import.meta.url);
  url.searchParams.set('cacheBust', cacheBust);
  return import(url.href) as Promise<EffectConfigModule>;
}

beforeEach(() => {
  restoreEnv();
  ConfigService.resetForTesting();
});

afterEach(() => {
  restoreEnv();
  ConfigService.resetForTesting();
});

describe('ConfigService', () => {
  it('应该从环境变量读取效果配置路径', () => {
    setEnv('ASTER_EFFECT_CONFIG', '/tmp/custom-effects.json');

    const instance = ConfigService.getInstance();

    assert.strictEqual(instance.effectConfigPath, '/tmp/custom-effects.json');
  });

  it('应该在未配置时使用默认效果配置路径', () => {
    delete process.env.ASTER_EFFECT_CONFIG;

    const instance = ConfigService.getInstance();

    assert.strictEqual(instance.effectConfigPath, '.aster/effects.json');
  });

  it('应该在禁用环境变量时关闭效果强制检查', () => {
    setEnv('ASTER_CAP_EFFECTS_ENFORCE', '0');

    const instance = ConfigService.getInstance();

    assert.strictEqual(instance.effectsEnforce, false);
  });

  it('应该在非法日志级别时回退到 INFO', () => {
    setEnv('LOG_LEVEL', 'verbose');

    const instance = ConfigService.getInstance();

    assert.strictEqual(instance.logLevel, LogLevel.INFO);
  });
});

describe('effect_config', () => {
  it('应该在配置文件缺失时回退默认配置', async () => {
    const missingPath = path.join(os.tmpdir(), `missing-effects-${Date.now()}.json`);
    setEnv('ASTER_EFFECT_CONFIG', missingPath);

    const mod = await importEffectModule(`missing-${Date.now()}`);
    const config = mod.loadEffectConfig();

    assert.deepStrictEqual(config.patterns.io.http, DEFAULT_HTTP_PREFIXES);
    assert.deepStrictEqual(config.patterns.io.sql, DEFAULT_SQL_PREFIXES);
    assert.deepStrictEqual(config.patterns.io.files, []);
    assert.deepStrictEqual(config.patterns.io.secrets, DEFAULT_SECRETS_PREFIXES);
    assert.deepStrictEqual(config.patterns.io.time, []);
    assert.deepStrictEqual(config.patterns.cpu, []);
  });

  it('应该在 JSON 解析失败时回退默认配置', async () => {
    const temp = createTempFile('{ "patterns": ');
    try {
      setEnv('ASTER_EFFECT_CONFIG', temp.path);

      const mod = await importEffectModule(`invalid-${Date.now()}`);
      const config = mod.loadEffectConfig();

      assert.deepStrictEqual(config.patterns.io.http, DEFAULT_HTTP_PREFIXES);
      assert.deepStrictEqual(config.patterns.cpu, []);
    } finally {
      temp.cleanup();
    }
  });

  it('应该合并部分配置字段并保留默认值', async () => {
    const temp = createTempJsonFile({
      patterns: {
        io: {
          http: ['CustomHttp.'],
        },
        cpu: ['CpuCustom.'],
      },
    });

    try {
      setEnv('ASTER_EFFECT_CONFIG', temp.path);

      const mod = await importEffectModule(`merge-${Date.now()}`);
      const config = mod.loadEffectConfig();

      assert.deepStrictEqual(config.patterns.io.http, ['CustomHttp.']);
      assert.deepStrictEqual(config.patterns.io.sql, DEFAULT_SQL_PREFIXES);
      assert.deepStrictEqual(config.patterns.io.files, []);
      assert.deepStrictEqual(config.patterns.io.secrets, DEFAULT_SECRETS_PREFIXES);
      assert.deepStrictEqual(config.patterns.io.time, []);
      assert.deepStrictEqual(config.patterns.cpu, ['CpuCustom.']);

      const prefixes = mod.getIOPrefixes();
      assert.deepStrictEqual(prefixes, ['CustomHttp.', ...DEFAULT_SQL_PREFIXES, ...DEFAULT_SECRETS_PREFIXES]);
    } finally {
      temp.cleanup();
    }
  });

  it('应该过滤无效字段并使用默认值', async () => {
    const temp = createTempJsonFile({
      patterns: {
        io: {
          http: [42, true],
          sql: [null],
          files: ['ValidFile.'],
          secrets: [],
          time: ['ValidTime.'],
        },
        cpu: [0, 1],
        ai: ['ValidAI.', 123],
      },
    });

    try {
      setEnv('ASTER_EFFECT_CONFIG', temp.path);

      const mod = await importEffectModule(`invalid-field-${Date.now()}`);
      const config = mod.loadEffectConfig();

      assert.deepStrictEqual(config.patterns.io.http, DEFAULT_HTTP_PREFIXES);
      assert.deepStrictEqual(config.patterns.io.sql, DEFAULT_SQL_PREFIXES);
      assert.deepStrictEqual(config.patterns.io.files, ['ValidFile.']);
      assert.deepStrictEqual(config.patterns.io.time, ['ValidTime.']);
      assert.deepStrictEqual(config.patterns.cpu, []);
      assert.deepStrictEqual(config.patterns.ai, ['ValidAI.']);
    } finally {
      temp.cleanup();
    }
  });

  it('应该在文件未变更时使用缓存并在变更后重新加载', async () => {
    const temp = createTempJsonFile({
      patterns: {
        io: {
          http: ['FirstHttp.'],
        },
        cpu: [],
        ai: [],
      },
    });

    try {
      setEnv('ASTER_EFFECT_CONFIG', temp.path);

      const mod = await importEffectModule('cache-behavior');
      const first = mod.loadEffectConfig();
      const cached = mod.loadEffectConfig();

      assert.strictEqual(first, cached);
      fs.writeFileSync(
        temp.path,
        JSON.stringify({
          patterns: {
            io: {
              http: ['SecondHttp.'],
            },
            cpu: [],
            ai: [],
          },
        }),
        'utf8'
      );

      const updatedTime = new Date(Date.now() + 5_000);
      fs.utimesSync(temp.path, updatedTime, updatedTime);

      const second = mod.loadEffectConfig();

      assert.notStrictEqual(second, first);
      assert.deepStrictEqual(second.patterns.io.http, ['SecondHttp.']);
    } finally {
      temp.cleanup();
    }
  });

  it('应该在重置后重新加载新的配置', async () => {
    const firstConfig = createTempJsonFile({
      patterns: {
        io: {
          http: ['InitialHttp.'],
        },
        cpu: [],
        ai: [],
      },
    });
    const secondConfig = createTempJsonFile({
      patterns: {
        io: {
          http: ['UpdatedHttp.'],
        },
        cpu: ['UpdatedCpu.'],
        ai: [],
      },
    });

    try {
      setEnv('ASTER_EFFECT_CONFIG', firstConfig.path);
      ConfigService.resetForTesting();

      const firstModule = await importEffectModule('reload-first');
      const firstResult = firstModule.loadEffectConfig();
      assert.deepStrictEqual(firstResult.patterns.io.http, ['InitialHttp.']);
      assert.deepStrictEqual(firstModule.getCPUPrefixes(), []);

      setEnv('ASTER_EFFECT_CONFIG', secondConfig.path);
      ConfigService.resetForTesting();

      const secondModule = await importEffectModule('reload-second');
      const secondResult = secondModule.loadEffectConfig();
      assert.deepStrictEqual(secondResult.patterns.io.http, ['UpdatedHttp.']);
      assert.deepStrictEqual(secondModule.getCPUPrefixes(), ['UpdatedCpu.']);
    } finally {
      firstConfig.cleanup();
      secondConfig.cleanup();
    }
  });
});
