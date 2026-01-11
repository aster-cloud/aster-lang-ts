#!/usr/bin/env node
import { percentile, p50, p95, p99 } from '../../scripts/perf-utils.js';

/**
 * 单元测试: perf-utils.ts 百分位数计算
 * 验证线性插值算法的正确性与边界条件处理
 */

// 测试空数组返回0
const testEmptyArray = (): void => {
  const result = percentile([], 0.5);
  if (result !== 0) {
    throw new Error(`Empty array should return 0, got ${result}`);
  }
  console.log('✓ Empty array returns 0');
};

// 测试单元素数组
const testSingleElement = (): void => {
  const result = p50([42]);
  if (result !== 42) {
    throw new Error(`Single element [42] should return 42, got ${result}`);
  }
  console.log('✓ Single element returns itself');
};

// 测试奇数长度数组的中位数（无需插值）
const testOddLengthMedian = (): void => {
  const result = p50([1, 2, 3]);
  if (result !== 2) {
    throw new Error(`p50([1,2,3]) should return 2, got ${result}`);
  }
  console.log('✓ Odd-length array median (no interpolation)');
};

// 测试偶数长度数组的中位数（线性插值）
const testEvenLengthMedian = (): void => {
  const result = p50([1, 2, 3, 4]);
  if (result !== 2.5) {
    throw new Error(`p50([1,2,3,4]) should return 2.5 via interpolation, got ${result}`);
  }
  console.log('✓ Even-length array median (linear interpolation)');
};

// 测试p50/p95/p99算法一致性
const testConsistencyAcrossPercentiles = (): void => {
  const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  const p50Value = p50(samples);
  const p50Direct = percentile(samples, 0.50);
  if (p50Value !== p50Direct) {
    throw new Error(`p50 should use percentile(0.5). Got p50=${p50Value}, percentile(0.5)=${p50Direct}`);
  }

  const p95Value = p95(samples);
  const p95Direct = percentile(samples, 0.95);
  if (p95Value !== p95Direct) {
    throw new Error(`p95 should use percentile(0.95). Got p95=${p95Value}, percentile(0.95)=${p95Direct}`);
  }

  const p99Value = p99(samples);
  const p99Direct = percentile(samples, 0.99);
  if (p99Value !== p99Direct) {
    throw new Error(`p99 should use percentile(0.99). Got p99=${p99Value}, percentile(0.99)=${p99Direct}`);
  }

  console.log('✓ p50/p95/p99 use consistent percentile algorithm');
};

// 测试p95边界条件
const testP95Boundary = (): void => {
  const samples = [1, 2, 3, 4, 5];
  const result = p95(samples);

  // p95 at index = 0.95 * (5-1) = 3.8
  // lower=3, upper=4, weight=0.8
  // samples[3]=4, samples[4]=5
  // result = 4 * (1-0.8) + 5 * 0.8 = 4 * 0.2 + 5 * 0.8 = 0.8 + 4.0 = 4.8
  const expected = 4.8;
  if (Math.abs(result - expected) > 0.001) {
    throw new Error(`p95([1,2,3,4,5]) should return ${expected}, got ${result}`);
  }

  console.log('✓ p95 boundary interpolation correct');
};

// 测试p99不越界
const testP99NoBoundsOverflow = (): void => {
  const samples = [10, 20, 30];
  const result = p99(samples);

  // p99 at index = 0.99 * (3-1) = 1.98
  // lower=1, upper=2, weight=0.98
  // samples[1]=20, samples[2]=30
  // result = 20 * (1-0.98) + 30 * 0.98 = 20 * 0.02 + 30 * 0.98 = 0.4 + 29.4 = 29.8
  const expected = 29.8;
  if (Math.abs(result - expected) > 0.001) {
    throw new Error(`p99([10,20,30]) should return ${expected}, got ${result}`);
  }

  // 最大值不应超过数组最大值
  const max = Math.max(...samples);
  if (result > max) {
    throw new Error(`p99 result ${result} should not exceed max ${max}`);
  }

  console.log('✓ p99 does not overflow array bounds');
};

// 测试未排序数组（内部应排序）
const testUnsortedArray = (): void => {
  const unsorted = [5, 1, 9, 3, 7];
  const result = p50(unsorted);

  // 排序后 [1, 3, 5, 7, 9]，中位数 = 5
  if (result !== 5) {
    throw new Error(`p50([5,1,9,3,7]) should return 5, got ${result}`);
  }

  console.log('✓ Unsorted array handled correctly (internal sort)');
};

// 测试重复值
const testDuplicateValues = (): void => {
  const duplicates = [1, 2, 2, 3, 3, 3, 4];
  const result = p50(duplicates);

  // 中位数索引 = 0.5 * (7-1) = 3
  // samples[3] = 3
  if (result !== 3) {
    throw new Error(`p50([1,2,2,3,3,3,4]) should return 3, got ${result}`);
  }

  console.log('✓ Duplicate values handled correctly');
};

// 测试大数组性能样本（百分位计算不应改变原数组）
const testOriginalArrayUnmodified = (): void => {
  const original = [5, 1, 9, 3, 7];
  const copy = [...original];

  p50(original);

  if (original.some((val, idx) => val !== copy[idx])) {
    throw new Error('percentile calculation should not modify original array');
  }

  console.log('✓ Original array unmodified by percentile calculation');
};

function main(): void {
  console.log('Running perf-utils unit tests...\n');

  try {
    testEmptyArray();
    testSingleElement();
    testOddLengthMedian();
    testEvenLengthMedian();
    testConsistencyAcrossPercentiles();
    testP95Boundary();
    testP99NoBoundsOverflow();
    testUnsortedArray();
    testDuplicateValues();
    testOriginalArrayUnmodified();

    console.log('\n✅ All perf-utils tests passed!');
  } catch (e) {
    console.error('\n❌ perf-utils test failed:', (e as Error).message);
    process.exit(1);
  }
}

main();
