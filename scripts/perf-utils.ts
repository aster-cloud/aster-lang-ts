#!/usr/bin/env node

/**
 * 性能统计工具函数
 * 提供百分位数计算，用于性能测试脚本
 */

/**
 * 计算数组的百分位数（使用线性插值方法）
 * @param values 数值数组
 * @param p 百分位 (0.0-1.0，例如 0.50 表示中位数)
 * @returns 百分位数值，空数组返回 0
 *
 * 使用线性插值确保 p50 在偶数长度数组中取平均值，
 * 与 p95/p99 使用一致的算法。
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = p * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (upper >= sorted.length) return sorted[sorted.length - 1]!;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

/**
 * 计算中位数 (50th percentile)
 * 使用线性插值，偶数长度数组自动取平均值
 */
export const p50 = (values: number[]): number => percentile(values, 0.50);

/**
 * 计算 95th percentile
 */
export const p95 = (values: number[]): number => percentile(values, 0.95);

/**
 * 计算 99th percentile
 */
export const p99 = (values: number[]): number => percentile(values, 0.99);

