#!/usr/bin/env node
/**
 * manifest 的 `io` / `cpu` 类别键按 shared/capabilities.json 的 `class` 字段展开（ADR 0056 §4.1、aster-lang-ts#320），
 * 与 core ManifestReader 一致；此前 io 是硬编码的 6 项（漏 Network / Process / Payment / Inventory），cpu 只有 Cpu。
 */
import { readFileSync } from 'node:fs';
import { capabilitiesOfEffectClass, normalizeManifest } from '../../../src/effects/capabilities.js';
import { CapabilityKind } from '../../../src/config/semantic.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** 单一真相源：shared/capabilities.json 里某个 class 的能力（按 displayName）。 */
function sharedClass(effectClass: 'io' | 'cpu'): string[] {
  const shared = JSON.parse(readFileSync(new URL('../../../../shared/capabilities.json', import.meta.url), 'utf8')) as {
    capabilities: Array<{ displayName: string; class: string }>;
  };
  return shared.capabilities.filter((c) => c.class === effectClass).map((c) => c.displayName).sort();
}

function testEffectClassExpansion(): void {
  for (const cls of ['io', 'cpu'] as const) {
    const caps = capabilitiesOfEffectClass(cls).map(String).sort();
    assert(JSON.stringify(caps) === JSON.stringify(sharedClass(cls)), `${cls} 展开应与 capabilities.json 一致：${caps}`);
  }
  assert(capabilitiesOfEffectClass('io').includes(CapabilityKind.NETWORK), 'io 应含 Network');
  assert(capabilitiesOfEffectClass('cpu').includes(CapabilityKind.CRYPTO), 'cpu 应含 Crypto');
  console.log('✓ io / cpu 按 capabilities.json 的 class 展开');
}

function testNormalizeClassKeys(): void {
  const raw = { allow: { io: ['*'], cpu: ['demo.*'] }, deny: { io: ['demo.secret'] } };
  const manifest = normalizeManifest(raw);
  for (const cap of capabilitiesOfEffectClass('io')) {
    assert(manifest.allow[cap] === raw.allow.io, `allow.io 应展开到 ${cap}`);
    assert(manifest.deny?.[cap] === raw.deny.io, `deny.io 应展开到 ${cap}`);
  }
  for (const cap of capabilitiesOfEffectClass('cpu')) {
    assert(manifest.allow[cap] === raw.allow.cpu, `allow.cpu 应展开到 ${cap}`);
  }
  console.log('✓ normalizeManifest 展开 io / cpu 类别键');
}

function testSpecificKeyWinsOverClassKey(): void {
  // 具体能力键覆盖类别键，结果不依赖键顺序
  const before = normalizeManifest({ allow: { [CapabilityKind.HTTP]: ['a.*'], io: ['*'] } });
  const after = normalizeManifest({ allow: { io: ['*'], [CapabilityKind.HTTP]: ['a.*'] } });
  assert(JSON.stringify(before.allow[CapabilityKind.HTTP]) === '["a.*"]', '具体键应覆盖类别键（具体键在前）');
  assert(JSON.stringify(after.allow[CapabilityKind.HTTP]) === '["a.*"]', '具体键应覆盖类别键（具体键在后）');
  assert(JSON.stringify(before.allow[CapabilityKind.SQL]) === '["*"]', '其余 io 能力仍取类别键');
  console.log('✓ 具体能力键覆盖类别键');
}

function testNormalizeFineGrainedManifest(): void {
  const raw = { allow: { [CapabilityKind.HTTP]: ['*'] } };
  const manifest = normalizeManifest(raw);
  assert(manifest.allow[CapabilityKind.HTTP] === raw.allow[CapabilityKind.HTTP], 'normalizeManifest 应保留细粒度 capability');
  assert(manifest.allow[CapabilityKind.SQL] === undefined, '未列出的能力不应被允许');
  console.log('✓ normalizeManifest 保留细粒度 capability 配置');
}

function main(): void {
  console.log('Running capability manifest tests...\n');
  testEffectClassExpansion();
  testNormalizeClassKeys();
  testSpecificKeyWinsOverClassKey();
  testNormalizeFineGrainedManifest();
  console.log('\nAll capability manifest tests passed.');
}

main();
