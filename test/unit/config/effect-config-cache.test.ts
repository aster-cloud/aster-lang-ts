import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadEffectConfig,
  reloadEffectConfig,
  resetConfigForTesting,
} from '../../../src/config/effect_config.js';
import { ConfigService } from '../../../src/config/config-service.js';

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

function createTempJsonFile(data: unknown): { path: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'effect-config-cache-'));
  const filePath = path.join(dir, 'effects.json');
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
  return {
    path: filePath,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

beforeEach(() => {
  restoreEnv();
  ConfigService.resetForTesting();
  resetConfigForTesting();
});

afterEach(() => {
  restoreEnv();
  ConfigService.resetForTesting();
  resetConfigForTesting();
});

describe('effect_config 缓存快照', () => {
  it('应该在文件时间戳变更时重新加载配置', () => {
    const temp = createTempJsonFile({
      patterns: {
        io: {
          http: ['InitialHttp.'],
        },
      },
    });

    try {
      setEnv('ASTER_EFFECT_CONFIG', temp.path);

      const first = loadEffectConfig();
      const cached = loadEffectConfig();

      assert.strictEqual(first, cached);
      assert.deepStrictEqual(first.patterns.io.http, ['InitialHttp.']);

      const future = new Date(Date.now() + 5_000);
      fs.writeFileSync(
        temp.path,
        JSON.stringify({
          patterns: {
            io: {
              http: ['UpdatedHttp.'],
            },
          },
        }),
        'utf8'
      );
      fs.utimesSync(temp.path, future, future);

      const reloaded = loadEffectConfig();

      assert.notStrictEqual(reloaded, first);
      assert.deepStrictEqual(reloaded.patterns.io.http, ['UpdatedHttp.']);
    } finally {
      temp.cleanup();
    }
  });

  it('应该在强制刷新时忽略快照缓存', () => {
    const initialContent = {
      patterns: {
        io: {
          http: ['ForceOne.'],
        },
        cpu: [],
        ai: [],
      },
    };
    const temp = createTempJsonFile(initialContent);

    try {
      setEnv('ASTER_EFFECT_CONFIG', temp.path);

      const first = loadEffectConfig();
      assert.deepStrictEqual(first.patterns.io.http, ['ForceOne.']);

      first.patterns.io.http.push('ForceMutation.');

      const stillCached = reloadEffectConfig();
      assert.strictEqual(stillCached.patterns.io.http.includes('ForceMutation.'), true);

      const forced = reloadEffectConfig(true);
      assert.deepStrictEqual(forced.patterns.io.http, ['ForceOne.']);
    } finally {
      temp.cleanup();
    }
  });

  it('应该在效果配置路径变更时重新加载配置', () => {
    const first = createTempJsonFile({
      patterns: {
        io: {
          http: ['EnvPathOne.'],
        },
      },
    });
    const second = createTempJsonFile({
      patterns: {
        io: {
          http: ['EnvPathTwo.'],
        },
      },
    });

    try {
      setEnv('ASTER_EFFECT_CONFIG', first.path);

      const initial = reloadEffectConfig(true);
      assert.strictEqual(initial.patterns.io.http[0], 'EnvPathOne.');

      setEnv('ASTER_EFFECT_CONFIG', second.path);

      const reloaded = loadEffectConfig();
      assert.strictEqual(reloaded.patterns.io.http[0], 'EnvPathTwo.');
    } finally {
      first.cleanup();
      second.cleanup();
    }
  });
});
