/**
 * Aster包管理清单文件类型定义
 *
 * 定义 manifest.json 的 TypeScript 接口，用于包依赖管理、版本控制和能力声明。
 */

/**
 * 依赖映射表
 * 键：包名称（如 "aster.http"）
 * 值：版本约束（如 "^2.1.0"、"~1.5.3"或 "3.0.0"）
 */
export type DependencyMap = Record<string, string>;

/**
 * 能力配置
 * 声明包需要的系统能力（可选，向后兼容）
 */
export interface CapabilityConfig {
  /** 允许使用的能力列表 */
  allow?: CapabilityKind[];
  /** 禁止使用的能力列表 */
  deny?: CapabilityKind[];
}

/**
 * 系统能力类型枚举
 */
export type CapabilityKind = 'Http' | 'Sql' | 'Time' | 'Files' | 'Secrets' | 'AiModel' | 'Cpu';

/**
 * Aster包清单
 * 描述一个Aster包的元数据、依赖和能力要求
 */
export interface Manifest {
  /** 包名称，使用点号分隔的标识符（如 aster.finance.loan） */
  name?: string;

  /** 包版本，遵循 SemVer 规范（如 "1.0.0"） */
  version?: string;

  /** 生产依赖包及其版本约束 */
  dependencies?: DependencyMap;

  /** 开发依赖包及其版本约束 */
  devDependencies?: DependencyMap;

  /** 该包导出的自定义效果类型（PascalCase标识符） */
  effects?: string[];

  /** 包需要的系统能力（可选，向后兼容） */
  capabilities?: CapabilityConfig;
}

/**
 * 空清单对象，用于默认值和测试
 */
export const EMPTY_MANIFEST: Manifest = {};
