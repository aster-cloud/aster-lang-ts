/**
 * 测试工具函数
 */

/**
 * 创建 mock 函数
 */
export function createMock<T extends (...args: any[]) => any>(): T & {
  calls: any[][];
  resetCalls: () => void;
} {
  const calls: any[][] = [];
  const mockFn = ((...args: any[]) => {
    calls.push(args);
  }) as any;

  mockFn.calls = calls;
  mockFn.resetCalls = () => {
    calls.length = 0;
  };

  return mockFn;
}

/**
 * 延迟执行（用于测试异步逻辑）
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 深度克隆对象（避免测试间状态污染）
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
