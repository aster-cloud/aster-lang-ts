/**
 * @module tokens
 *
 * Token kinds 和关键字定义（向后兼容导出）。
 *
 * **注意**：KW 和 Effect 现在从 config/semantic.ts 导出，此文件保持向后兼容。
 * 新代码应该直接从 types.js（TokenKind）和 config/semantic.js（KW, Effect）导入。
 */

import { TokenKind } from '../types.js';
import { KW, Effect } from '../config/semantic.js';

export { TokenKind, KW, Effect };
