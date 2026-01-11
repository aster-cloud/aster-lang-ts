/**
 * @module config/effects
 *
 * 效果和能力配置（向后兼容导出）。
 *
 * **更新说明**：
 * - IO_PREFIXES 和 CPU_PREFIXES 现在从 effect_config.ts 动态生成，支持配置文件覆盖
 * - CAPABILITY_PREFIXES 继续从 semantic.ts 导出
 * - 保持现有导入路径 './config/effects.js' 向后兼容
 *
 * **新代码建议**：
 * - 使用 getIOPrefixes()/getCPUPrefixes() 从 './effect_config.js' 获取最新配置
 * - 使用 CAPABILITY_PREFIXES 从 './semantic.js' 导入
 */

import { getIOPrefixes, getCPUPrefixes } from './effect_config.js';

/**
 * IO 效果前缀列表（向后兼容）。
 *
 * 从配置文件或默认配置动态生成。
 * 等价于原 semantic.ts 中的硬编码 IO_PREFIXES。
 */
export const IO_PREFIXES = getIOPrefixes();

/**
 * CPU 效果前缀列表（向后兼容）。
 *
 * 从配置文件或默认配置动态生成。
 * 等价于原 semantic.ts 中的硬编码 CPU_PREFIXES。
 */
export const CPU_PREFIXES = getCPUPrefixes();

/**
 * Capability 前缀映射（继续从 semantic.ts 导出）。
 */
export { CAPABILITY_PREFIXES } from './semantic.js';
