/**
 * 运行时配置：控制安全特性的默认行为
 *
 * ENFORCE_CAPABILITIES: 能力校验开关
 * - 默认: true (启用)
 * - 关闭: 设置环境变量 ASTER_CAP_EFFECTS_ENFORCE=0
 * - 显式开启: 设置环境变量 ASTER_CAP_EFFECTS_ENFORCE=1
 *
 * 注意：为保证生产环境安全，建议保持默认开启
 */
import { ConfigService } from './config-service.js';

export const ENFORCE_CAPABILITIES = ConfigService.getInstance().effectsEnforce;
