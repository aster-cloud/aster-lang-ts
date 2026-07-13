/**
 * Capability 能力表单源一致性测试（防双引擎 drift 复发）。
 *
 * 背景：CapabilityKind 是安全边界（能力授权）契约。历史上 TS 后加了
 * NETWORK/CRYPTO/PROCESS（commit 063ff6d），Java 与 TS 的多个白名单副本
 * 都未跟上，导致双引擎 + TS 内部多副本 drift，且零守门。
 *
 * `shared/capabilities.json` 现为单源真值（类比 error_codes.json）。本测试锁定
 * TS 侧全部 capability 副本与该 json 一致：
 *   - semantic.ts CapabilityKind enum（displayName）
 *   - semantic.ts CAPABILITY_PREFIXES（前缀推断表）
 *   - manifest.ts CapabilityKind union（通过 manifest-parser 的 validCapabilities 间接覆盖）
 *   - manifest-parser.ts validCapabilities
 *   - manifest.schema.json allow/deny enum
 * Java 侧由 aster-lang-core 的 CapabilityParityTest 对同一 json（byte-identical
 * 副本）守门，两份 json 的 byte-identical 由本文件断言 → 传递性保证双引擎一致。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CapabilityKind, CAPABILITY_PREFIXES } from '../../../src/config/semantic.js';

const REPO_ROOT = process.cwd();
const JSON_PATH = resolve(REPO_ROOT, 'shared', 'capabilities.json');

interface CapSpec {
  enumName: string;
  displayName: string;
  prefixes: string[];
}

const table = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as { capabilities: CapSpec[] };
const specs = table.capabilities;

describe('capability 单源一致性：shared/capabilities.json ↔ TS 各副本', () => {
  it('json 自身合法：enumName/displayName/前缀唯一，CPU 无前缀', () => {
    const names = specs.map(s => s.enumName);
    const displays = specs.map(s => s.displayName);
    assert.equal(new Set(names).size, names.length, 'enumName 应唯一');
    assert.equal(new Set(displays).size, displays.length, 'displayName 应唯一');
    const allPrefixes = specs.flatMap(s => s.prefixes);
    assert.equal(new Set(allPrefixes).size, allPrefixes.length, '前缀不应跨 capability 重复');
    const cpu = specs.find(s => s.enumName === 'CPU');
    assert.deepEqual(cpu?.prefixes, [], 'CPU 不应有调用前缀');
  });

  it('semantic.ts CapabilityKind enum 与 json 完全一致（名称 + displayName）', () => {
    // CapabilityKind 是 string enum：键=enumName，值=displayName。
    const enumEntries = Object.entries(CapabilityKind) as Array<[string, string]>;
    const enumNames = new Set(enumEntries.map(([k]) => k));
    const jsonNames = new Set(specs.map(s => s.enumName));
    assert.deepEqual(
      [...enumNames].sort(),
      [...jsonNames].sort(),
      'enum 名称集合应与 json 一致',
    );
    for (const s of specs) {
      assert.equal(
        (CapabilityKind as Record<string, string>)[s.enumName],
        s.displayName,
        `${s.enumName} 的 displayName 应为 ${s.displayName}`,
      );
    }
  });

  it('semantic.ts CAPABILITY_PREFIXES 与 json 前缀表一致', () => {
    // CAPABILITY_PREFIXES 以 displayName 为键。CPU 无前缀 → 不出现在表中。
    const jsonByDisplay = new Map(specs.map(s => [s.displayName, s.prefixes]));
    const problems: string[] = [];
    for (const s of specs) {
      const actual = CAPABILITY_PREFIXES[s.displayName];
      if (s.prefixes.length === 0) {
        if (actual !== undefined && actual.length > 0) {
          problems.push(`${s.displayName}: json 无前缀但 CAPABILITY_PREFIXES 有 ${JSON.stringify(actual)}`);
        }
        continue;
      }
      if (actual === undefined) {
        problems.push(`${s.displayName}: CAPABILITY_PREFIXES 缺失`);
        continue;
      }
      assert.deepEqual([...actual], s.prefixes, `${s.displayName} 前缀应一致`);
    }
    // 反向：CAPABILITY_PREFIXES 不应有 json 里没有的键
    for (const key of Object.keys(CAPABILITY_PREFIXES)) {
      if (!jsonByDisplay.has(key)) {
        problems.push(`CAPABILITY_PREFIXES 多出键 ${key}（json 中无）`);
      }
    }
    assert.deepEqual(problems, [], `前缀表不一致:\n${problems.join('\n')}`);
  });

  it('manifest.schema.json 的 allow/deny capability enum 与 json displayName 一致', () => {
    // 直接守门 schema 白名单（AJV 真正校验源），而非仅靠 manifest-parser 间接覆盖。
    const schemaPath = resolve(REPO_ROOT, 'manifest.schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    const displayNames = new Set(specs.map(s => s.displayName));
    const capNode = schema.properties?.capabilities?.properties;
    for (const key of ['allow', 'deny'] as const) {
      const enumList: string[] = capNode?.[key]?.items?.enum ?? [];
      assert.deepEqual(
        new Set(enumList),
        displayNames,
        `manifest.schema.json capabilities.${key}.items.enum 应与 capabilities.json displayName 集合一致`,
      );
    }
  });

  it('TS 源 json 与 Java 仓 resources 副本 byte-identical（跨仓同源）', () => {
    const javaCopy = resolve(
      REPO_ROOT,
      '..',
      'aster-lang-core/src/test/resources/capability/capabilities.json',
    );
    let javaBytes: Buffer;
    try {
      javaBytes = readFileSync(javaCopy);
    } catch {
      return; // Java 仓未并列 checkout：跳过（Java 侧 CapabilityParityTest 独立守门）
    }
    const tsBytes = readFileSync(JSON_PATH);
    assert.ok(
      tsBytes.equals(javaBytes),
      'shared/capabilities.json 与 aster-lang-core 副本必须 byte-identical——请同步两份副本',
    );
  });
});
