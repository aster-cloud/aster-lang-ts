/**
 * 语言特定的诊断消息翻译（overlay 模式）
 *
 * 不修改 @generated 的 lexicon 文件，而是通过 attach 函数
 * 在运行时将翻译附加到 Lexicon 对象上。
 *
 * 规则数据来源优先级：
 * 1. 从语言包 JSON overlay 加载（通过 registerOverlay*）
 * 2. 内联 fallback 常量（当 JSON overlay 尚未接入时使用）
 */

import type { Lexicon } from './types.js';
import type { OverlayData } from './overlay-loader.js';
import { loadDiagnosticMessages, loadDiagnosticHelp } from './overlay-loader.js';

/** 内联 fallback：中文诊断消息 */
const ZH_CN_MESSAGES: Readonly<Partial<Record<string, string>>> = {
  E008: 'If分支返回类型不一致: then分支 {thenType} vs else分支 {elseType}',
  E013: '构造 {type} 缺少必需字段 \'{field}\'',
  E070: '禁止将 PII 数据赋给较低等级目标: {source} -> {target}',
  E072: 'PII 等级 {level} 数据未脱敏即输出到 {sinkKind}',
  E073: 'PII 参数类型不匹配: 期望 {expected}, 实际 {actual}',
  E205: '函数 \'{func}\' 缺少 @io 效果声明，推断要求 IO。',
  E206: '函数 \'{func}\' 缺少 @cpu 效果声明，推断要求 CPU（或 @io）。',
  E207: '函数 \'{func}\' 声明了 @io，但推断未发现 IO 副作用。',
  E208: '函数 \'{func}\' 声明了 @cpu，但推断未发现 CPU 副作用。',
  E209: '函数 \'{func}\' 同时声明 @cpu 和 @io；由于需要 @io，@cpu 可移除。',
  E210: '效应变量 {var} 未声明',
  E211: '效应变量 {vars} 无法推断出具体效果',
  W071: '检测到隐式 PII 等级提升: {source} -> {target}',
  W074: '可能有 PII 数据流向 {sinkKind} 但缺少注解',
  W105: 'Workflow retry 配置可能不合理: {reason}',
  W106: 'Workflow timeout 配置可能不合理: {reason}',
};

/** 内联 fallback：中文帮助文本 */
const ZH_CN_HELP: Readonly<Partial<Record<string, string>>> = {
  E001: '检查类型标注与表达式的推断结果是否一致。',
  E002: '确认变量先前绑定的类型与当前赋值结果一致。',
  E003: '检查函数返回语句与声明的返回类型是否一致。',
  E004: '在函数签名的 of 子句中显式声明使用到的类型变量。',
  E005: '移除未使用的类型参数，避免造成误导。',
  E006: '对于看起来像类型变量的名称，务必在 of 子句中声明。',
  E007: '确认类型推断的多个使用点产出相同的具体类型。',
  E008: '确保 if 两个分支返回类型保持一致。',
  E009: '检查 match 每个分支的返回类型是否统一。',
  E010: '仅在 Int 类型的匹配表达式中使用整数模式。',
  E011: '检查构造体或数据类型的字段名称是否正确。',
  E012: '校验字段初始化表达式的类型是否匹配声明。',
  E013: '为数据构造提供声明中的所有必需字段。',
  E014: '调整 not 调用的参数数量为 1。',
  E015: '仅对 Maybe 或 Result 类型调用 await。',
  E016: '移除重复的枚举分支，保持匹配语句简洁。',
  E017: '为 Maybe 匹配补齐 null 与非 null 分支。',
  E018: '补充所有未覆盖的枚举分支，或添加通配符。',
  E019: '统一互操作调用的参数数值类型，避免隐式装箱与拓宽。',
  E020: '确保列表字面量中的所有元素类型一致。',
  E021: '传入 Maybe/Option 类型或显式包装值。',
  E022: '确保补偿块返回 Result<Unit, E>，其中 E 为 step 错误类型。',
  E023: '为包含 IO 副作用的 step 提供 compensate 块以便回滚。',
  E024: '设置 retry.maxAttempts 为正整数。',
  E025: '配置 timeout 秒数为正值，确保补偿逻辑可被触发。',
  E026: '在函数头部添加 @io 效果声明，否则编译器拒绝 workflow 语句。',
  E027: '在函数头部列出实际使用到的能力。',
  E028: 'Compensate 只能重复主体已使用的能力。',
  E029: '仅引用当前 workflow 中已声明的步骤名称，或修正依赖拼写。',
  E030: '移除或重构循环依赖，确保步骤可拓扑排序执行。',
  E070: '使用脱敏函数或为目标变量声明匹配的 @pii 等级。',
  E072: '在输出前调用 redact() 或 tokenize() 以降低敏感度。',
  E073: '检查函数签名，确保 PII 等级与类别一致。',
  E100: '为不同的导入使用唯一别名，避免覆盖。',
  E101: '在使用变量前先声明并初始化。',
  E102: '选择不同的名称或检查是否存在意外的重复声明。',
  E200: '为具有 IO 行为的函数声明 @io 效果。',
  E201: '为 CPU 密集型函数声明 @cpu 或 @io 效果。',
  E202: '若函数仅执行 CPU 工作，可移除多余的 @io 声明。',
  E203: '确认是否需要 @io；若无 IO 行为可移除。',
  E204: '移除多余的 @cpu 声明或增加相应的 CPU 工作。',
  E205: '根据推断结果为函数添加 @io 效果。',
  E206: '根据推断结果补齐 @cpu 或 @io 效果。',
  E207: '确认是否需要保留 @io 声明。',
  E208: '若无 CPU 副作用，可删除 @cpu 声明。',
  E209: '保留 @io 即可满足需求，移除多余的 @cpu。',
  E210: '在函数签名的效果参数列表中添加效应类型参数。',
  E211: '参考调用或声明补充明确的效果（pure/cpu/io/workflow），或移除未使用的效应变量。',
  E300: '更新能力清单或修改函数实现以符合限制。',
  E301: '在函数头部声明实际使用到的能力。',
  E302: '移除未使用的能力声明以保持清晰。',
  E303: '在函数头部声明 @io 效果，或移除相关调用保持纯度。',
  E304: '为函数添加 @cpu 或 @io 效果以覆盖 CPU 能力。',
  E400: '使用加密通道（HTTPS）或脱敏处理后再传输 PII 数据。',
  E401: '为敏感数据添加 @pii 标注以便跟踪。',
  E402: '调整数据的敏感级别或更新流程要求。',
  E403: '在处理 PII 数据前调用 checkConsent() 或添加 @consent_required 注解。',
  E500: '对启动的异步任务调用 wait，确保执行完毕。',
  E501: '确认 wait 的任务名称在 Start 中正确出现。',
  E502: '避免重复启动同名任务，可复用已有任务或改用新名称。',
  E503: '确保每个任务仅等待一次，或使用单独的同步机制。',
  E504: '在 wait for 之前先执行 start，并确保两者位于兼容的控制路径。',
  W071: '为等级变化添加显式类型注解以便审计。',
  W074: '为数据增加 @pii 注解以追踪敏感数据流。',
  W105: '检查 retry 总等待时间、maxAttempts 与 backoff 策略的组合是否合理。',
  W106: '检查 timeout 值是否过大或过小。',
};

const MESSAGES_BY_LEXICON: Record<string, Readonly<Partial<Record<string, string>>>> = {
  'zh-CN': ZH_CN_MESSAGES,
};

const HELP_BY_LEXICON: Record<string, Readonly<Partial<Record<string, string>>>> = {
  'zh-CN': ZH_CN_HELP,
};

/**
 * 从 JSON overlay 数据注册诊断消息翻译（覆盖内联 fallback）。
 */
export function registerOverlayDiagnosticMessages(lexiconId: string, overlay: NonNullable<OverlayData['diagnosticMessages']>): void {
  MESSAGES_BY_LEXICON[lexiconId] = loadDiagnosticMessages(overlay);
}

/**
 * 从 JSON overlay 数据注册诊断帮助文本翻译（覆盖内联 fallback）。
 */
export function registerOverlayDiagnosticHelp(lexiconId: string, overlay: NonNullable<OverlayData['diagnosticHelp']>): void {
  HELP_BY_LEXICON[lexiconId] = loadDiagnosticHelp(overlay);
}

/** 为 lexicon 附加诊断消息翻译（不修改原对象） */
export function attachDiagnosticMessages(lexicon: Lexicon): Lexicon {
  if (lexicon.diagnosticMessages && lexicon.diagnosticHelp) return lexicon;
  const messages = lexicon.diagnosticMessages ?? MESSAGES_BY_LEXICON[lexicon.id];
  const help = lexicon.diagnosticHelp ?? HELP_BY_LEXICON[lexicon.id];
  return {
    ...lexicon,
    ...(messages !== undefined && { diagnosticMessages: messages }),
    ...(help !== undefined && { diagnosticHelp: help }),
  };
}
