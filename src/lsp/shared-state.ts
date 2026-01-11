/**
 * Shared state for LSP modules
 *
 * This module provides shared state that doesn't depend on the LSP connection.
 * This allows diagnostics and other modules to be imported independently for testing.
 */

// 预热完成 Promise，用于等待后台预热完成
let warmupPromise: Promise<void> | null = null;

/**
 * 设置预热 Promise
 */
export function setWarmupPromise(promise: Promise<void> | null): void {
  warmupPromise = promise;
}

/**
 * 获取预热 Promise，用于等待后台预热完成
 */
export function getWarmupPromise(): Promise<void> | null {
  return warmupPromise;
}
