/**
 * 包管理系统配置文件加载器
 *
 * 支持从 .asterrc.json 加载自定义配置，提供默认配置回退。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface PackageConfig {
  registry: {
    url: string;
    token?: string;
    timeout: number;
  };
  cache: {
    dir: string;
    ttl: number;
    maxSize?: number;
  };
  concurrency?: number;
}

const DEFAULT_CONFIG: PackageConfig = {
  registry: {
    url: 'https://api.github.com',
    timeout: 30000
  },
  cache: {
    dir: '.aster/cache',
    ttl: 86400000  // 1 天
  },
  concurrency: 5
};

/**
 * 加载包管理系统配置
 *
 * 从当前工作目录的 .asterrc.json 文件加载配置，如果文件不存在则使用默认配置。
 * 用户配置会与默认配置合并。
 *
 * @returns 合并后的配置对象
 */
export function loadConfig(): PackageConfig {
  const configPath = join(process.cwd(), '.asterrc.json');

  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const userConfig = JSON.parse(content) as Partial<PackageConfig>;

    // 深度合并配置
    const mergedConfig: PackageConfig = {
      registry: {
        ...DEFAULT_CONFIG.registry,
        ...userConfig.registry
      },
      cache: {
        ...DEFAULT_CONFIG.cache,
        ...userConfig.cache
      }
    };

    if (userConfig.concurrency !== undefined) {
      mergedConfig.concurrency = userConfig.concurrency;
    } else if (DEFAULT_CONFIG.concurrency !== undefined) {
      mergedConfig.concurrency = DEFAULT_CONFIG.concurrency;
    }

    return mergedConfig;
  } catch {
    // 配置文件解析失败，使用默认配置
    return DEFAULT_CONFIG;
  }
}
