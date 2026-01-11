/**
 * LSP Workspace 类型定义
 * 定义索引相关的数据结构
 */

import type { Location, Range } from 'vscode-languageserver-types';

/**
 * 表示索引模块的配置选项。
 */
export interface IndexConfig {
  /**
   * 是否启用索引持久化功能。
   */
  persistEnabled: boolean;
  /**
   * 索引文件的绝对路径，可为空表示使用默认路径。
   */
  indexPath?: string | null;
  /**
   * 自动保存索引的延迟毫秒数。
   */
  autoSaveDelay?: number;
}

/**
 * 描述单个符号的索引信息。
 */
export interface SymbolInfo {
  /**
   * 符号名称。
   */
  name: string;
  /**
   * 符号分类（例如函数、类型、变量等）。
   */
  kind: string;
  /**
   * 符号在文档中的完整范围。
   */
  range: Range;
  /**
   * 可选的精确选择范围（通常对应符号名称）。
   */
  selectionRange?: Range;
  /**
   * 关联引用位置集合，用于重用索引结果。
   */
  references?: Location[];
  /**
   * 额外描述信息，如签名或注释摘要。
   */
  detail?: string;
  /**
   * 符号所属文档的 URI，可用于交叉引用。
   */
  uri?: string;
}

/**
 * 描述单个模块的索引记录。
 */
export interface ModuleIndex {
  /**
   * 文档 URI（通常为 file:// 路径）。
   */
  uri: string;
  /**
   * 模块名称，若无法推断则为 null。
   */
  moduleName: string | null;
  /**
   * 模块内已索引的符号集合。
   */
  symbols: SymbolInfo[];
  /**
   * 该索引最后一次更新的时间戳（毫秒）。
   */
  lastModified: number;
}
