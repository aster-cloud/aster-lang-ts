#!/usr/bin/env node
import { normalizeManifest, parseLegacyCapability } from '../../../src/effects/capabilities.js';
import { CapabilityKind } from '../../../src/config/semantic.js';

function assertArrayEqual(
  actual: readonly CapabilityKind[],
  expected: readonly CapabilityKind[],
  message: string
): void {
  if (actual.length !== expected.length || actual.some((v, i) => v !== expected[i])) {
    throw new Error(`${message}：实际=[${actual.join(', ')}], 期望=[${expected.join(', ')}]`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function testParseLegacyIo(): void {
  const caps = parseLegacyCapability('io');
  const expected = [
    CapabilityKind.HTTP,
    CapabilityKind.SQL,
    CapabilityKind.TIME,
    CapabilityKind.FILES,
    CapabilityKind.SECRETS,
    CapabilityKind.AI_MODEL,
  ];
  assertArrayEqual(caps, expected, 'parseLegacyCapability(io) 结果不符');
  console.log('✓ parseLegacyCapability("io") 返回 6 个 IO 能力（包含 AI_MODEL）');
}

function testParseLegacyCpu(): void {
  const caps = parseLegacyCapability('cpu');
  assertArrayEqual(caps, [CapabilityKind.CPU], 'parseLegacyCapability(cpu) 结果不符');
  console.log('✓ parseLegacyCapability("cpu") 返回 CPU 能力');
}

function testNormalizeLegacyManifest(): void {
  const raw = { allow: { io: ['*'] } };
  const manifest = normalizeManifest(raw);
  const ioCaps = [
    CapabilityKind.HTTP,
    CapabilityKind.SQL,
    CapabilityKind.TIME,
    CapabilityKind.FILES,
    CapabilityKind.SECRETS,
    CapabilityKind.AI_MODEL,
  ];
  for (const cap of ioCaps) {
    assert(
      manifest.allow[cap] === raw.allow.io,
      `normalizeManifest 未将 legacy io 映射到 ${cap}`
    );
  }
  assert(
    manifest.allow[CapabilityKind.CPU] === undefined,
    'normalizeManifest 不应为 legacy io 添加 CPU'
  );
  console.log('✓ normalizeManifest 展开 legacy io allow 配置（包含 AI_MODEL）');
}

function testNormalizeFineGrainedManifest(): void {
  const raw = { allow: { [CapabilityKind.HTTP]: ['*'] } };
  const manifest = normalizeManifest(raw);
  assert(
    manifest.allow[CapabilityKind.HTTP] === raw.allow[CapabilityKind.HTTP],
    'normalizeManifest 应保留细粒度 capability'
  );
  console.log('✓ normalizeManifest 保留细粒度 capability 配置');
}

function main(): void {
  console.log('Running capability compatibility tests...\n');
  testParseLegacyIo();
  testParseLegacyCpu();
  testNormalizeLegacyManifest();
  testNormalizeFineGrainedManifest();
  console.log('\nAll capability compatibility tests passed.');
}

main();
