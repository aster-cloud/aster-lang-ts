/**
 * 工具链分量版本常量（ADR 0051 §7）
 *
 * cloud 据此组装 toolchainId：
 * `abi=<CORE_IR_ABI>;core=<engine>;validator=<v>;resolver=<RESOLVER_VERSION>;casefold=<CASEFOLD_VERSION>;build=<b>`
 * 任一分量变化都会使已封存 envelope 失配，因此这些值只能随对应变更递增。
 */

/** 名称解析算法版本；名称解析规则发生变更时递增 */
export const RESOLVER_VERSION = 1;

/** 标识符折叠表（foldKey）所用的 Unicode 版本；升级折叠数据时必须同步更新 */
export const CASEFOLD_VERSION = '15.1';

/**
 * Core IR 工具链 ABI 版本；与 Core IR 序列化格式（core_ir_json 的 envelope version）独立。
 * 升级 casefold 时需同步递增，并触发全量重编译。
 */
export const CORE_IR_ABI = '1.1';
