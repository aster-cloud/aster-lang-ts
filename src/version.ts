/**
 * 工具链分量版本常量（ADR 0051 §7）
 *
 * cloud 据此组装 toolchainId：
 * `abi=<CORE_IR_ABI>;core=<engine>;validator=<v>;resolver=<RESOLVER_VERSION>;casefold=<CASEFOLD_VERSION>;build=<b>`
 * 任一分量变化都会使已封存 envelope 失配，因此这些值只能随对应变更递增。
 */

/** 名称解析算法版本；名称解析规则发生变更时递增 */
export const RESOLVER_VERSION = 1;

/** 标识符折叠表（foldKey）所用的 Unicode 版本：取自生成的折叠表本身，数据与版本不可能分离 */
export { CASEFOLD_VERSION } from './config/lexicons/identifiers/casefold-table.generated.js';

/**
 * Core IR 工具链 ABI 版本；与 Core IR 序列化格式（core_ir_json 的 envelope version）独立。
 * 仅当 Core IR 语义或名称解析输出形态变化时递增。casefold 升级只改 CASEFOLD_VERSION，
 * 名称解析规则变化只改 RESOLVER_VERSION，不需要同步改本值。
 */
export const CORE_IR_ABI = '1.1';
