/**
 * 错误码单源一致性测试（防 drift 复发）。
 *
 * 背景：`shared/error_codes.json` 是错误码「码表数据」（code / category /
 * severity / message / help）的唯一真源。历史上 aster-lang-ts 与 aster-lang-core
 * 拆分为独立仓后，两端 error_codes.ts / ErrorCode.java 被各自手改，导致码表 drift
 * （E102 语义碰撞、E103/E210/E211 单边、DUPLICATE_SYMBOL 归属分歧），且长期无测试守门。
 *
 * 本测试锁定 ts 侧生成物 ERROR_METADATA 与 shared/error_codes.json 逐字段一致，
 * 从此任何一方漂移都会立刻红灯。Java 侧由 aster-lang-core 的 ErrorCodeParityTest
 * 对同一份 json（byte-identical 副本）做结构校验，两份 json 的 checksum 相等由
 * ts 侧 error-codes-json-checksum 断言保证——传递性上确保 ts ↔ Java 码表一致。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ERROR_METADATA } from '../../../src/diagnostics/error_codes.js';
import {
  MESSAGES_BY_LEXICON,
  HELP_BY_LEXICON,
} from '../../../src/config/lexicons/diagnostic-messages.js';

// 用 repo 根定位固定资源，避免 src/ 与 dist/ 编译深度不同导致相对层级错位
// （测试可能从 dist/ 运行）。npm test 的 cwd 即 aster-lang-ts 仓根。
const REPO_ROOT = process.cwd();
const JSON_PATH = resolve(REPO_ROOT, 'shared', 'error_codes.json');

interface JsonSpec {
  code: string;
  category: string;
  severity: string;
  message: string;
  help: string;
}

const table = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as Record<string, JsonSpec>;

describe('error_codes 单源一致性：ts ERROR_METADATA ↔ shared/error_codes.json', () => {
  it('两侧的错误码名称集合完全一致', () => {
    const jsonNames = Object.keys(table).sort();
    // ERROR_METADATA 的键在运行时是 ErrorCode 的字符串值（码），需按名称映射还原。
    // 直接以 json 名称集合逐个断言存在，避免 const enum 键在编译期被内联导致的
    // 反向枚举困难——见下方逐条比对。
    const metaCodes = new Set(
      Object.values(ERROR_METADATA).map(m => m.code as string),
    );
    const jsonCodes = new Set(jsonNames.map(n => table[n]!.code));
    const onlyJson = [...jsonCodes].filter(c => !metaCodes.has(c));
    const onlyMeta = [...metaCodes].filter(c => !jsonCodes.has(c));
    assert.deepEqual(onlyJson, [], `json 有但 ts 缺的码: ${onlyJson.join(', ')}`);
    assert.deepEqual(onlyMeta, [], `ts 有但 json 缺的码: ${onlyMeta.join(', ')}`);
    assert.equal(metaCodes.size, jsonNames.length, '码数量应相等');
  });

  it('每个错误码的 code / category / severity / message / help 逐字段一致', () => {
    // 以码为主键把 ERROR_METADATA 建索引（ERROR_METADATA 值里含权威 code 字段）。
    const metaByCode = new Map<string, JsonSpec>();
    for (const m of Object.values(ERROR_METADATA)) {
      metaByCode.set(m.code as string, {
        code: m.code as string,
        category: m.category as string,
        severity: m.severity as string,
        message: m.message,
        help: m.help,
      });
    }

    const mismatches: string[] = [];
    for (const [name, spec] of Object.entries(table)) {
      const meta = metaByCode.get(spec.code);
      if (!meta) {
        mismatches.push(`${name}(${spec.code}): ts ERROR_METADATA 缺失`);
        continue;
      }
      for (const field of ['category', 'severity', 'message', 'help'] as const) {
        if (meta[field] !== spec[field]) {
          mismatches.push(
            `${name}(${spec.code}).${field}: json=${JSON.stringify(spec[field])} vs ts=${JSON.stringify(meta[field])}`,
          );
        }
      }
    }
    assert.deepEqual(mismatches, [], `字段不一致:\n${mismatches.join('\n')}`);
  });

  it('码集无重复 code（每个 code 唯一映射一个名称）', () => {
    const codes = Object.values(table).map(s => s.code);
    const seen = new Set<string>();
    const dup = codes.filter(c => (seen.has(c) ? true : (seen.add(c), false)));
    assert.deepEqual(dup, [], `重复 code: ${dup.join(', ')}`);
  });

  it('ts ERROR_METADATA 自身 code 唯一且数量与 json 相等（防以 code 建索引时静默覆盖）', () => {
    const metaCodes = Object.values(ERROR_METADATA).map(m => m.code as string);
    const seen = new Set<string>();
    const dup = metaCodes.filter(c => (seen.has(c) ? true : (seen.add(c), false)));
    assert.deepEqual(dup, [], `ts ERROR_METADATA 重复 code: ${dup.join(', ')}`);
    assert.equal(metaCodes.length, Object.keys(table).length, 'ERROR_METADATA 条目数应等于 json');
  });

  it('用户裁决落地：E102=MULTIPLE_ENTRY_RULES, E103=IMPORT_SYMBOL_CONFLICT, E104=DUPLICATE_SYMBOL', () => {
    assert.equal(table['MULTIPLE_ENTRY_RULES']?.code, 'E102', 'MULTIPLE_ENTRY_RULES 应为 E102');
    assert.equal(table['IMPORT_SYMBOL_CONFLICT']?.code, 'E103', 'IMPORT_SYMBOL_CONFLICT 应为 E103');
    assert.equal(table['DUPLICATE_SYMBOL']?.code, 'E104', 'DUPLICATE_SYMBOL 应为 E104');
    assert.equal(table['EFFECT_VAR_UNDECLARED']?.code, 'E210');
    assert.equal(table['EFFECT_VAR_UNRESOLVED']?.code, 'E211');
  });

  it('本地化 overlay 的 code-key 不残留孤儿码，占位符与 json 规范一致', () => {
    // overlay（diagnostic-messages.ts）按 code 字符串 key 存本地化消息/帮助。
    // 拆分历史证明：码表重排（如 E102 语义迁移）时 overlay 极易残留旧语义。
    // 本用例强制：① overlay 里每个 code 都是 json 中真实存在的 code（无孤儿）；
    // ② overlay message 的占位符集合与 json 规范消息一致（防旧翻译占位符漂移）。
    const codeToSpec = new Map<string, JsonSpec>();
    for (const spec of Object.values(table)) codeToSpec.set(spec.code, spec);

    const placeholders = (s: string): Set<string> =>
      new Set([...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]!));

    const problems: string[] = [];
    for (const [lex, overlay] of Object.entries(MESSAGES_BY_LEXICON)) {
      for (const [code, msg] of Object.entries(overlay)) {
        const spec = codeToSpec.get(code);
        if (!spec) {
          problems.push(`MESSAGES[${lex}].${code}: json 中无此 code（孤儿/残留）`);
          continue;
        }
        const overlayPh = placeholders(msg as string);
        const canonPh = placeholders(spec.message);
        for (const p of overlayPh) {
          if (!canonPh.has(p)) {
            problems.push(
              `MESSAGES[${lex}].${code}: 占位符 {${p}} 不在 json 规范消息中（旧翻译漂移？）`,
            );
          }
        }
      }
    }
    for (const [lex, overlay] of Object.entries(HELP_BY_LEXICON)) {
      for (const code of Object.keys(overlay)) {
        if (!codeToSpec.has(code)) {
          problems.push(`HELP[${lex}].${code}: json 中无此 code（孤儿/残留）`);
        }
      }
    }
    assert.deepEqual(problems, [], `overlay 一致性问题:\n${problems.join('\n')}`);
  });

  it('本地化 overlay 的 E102/E104 语义符合裁决（防旧 DUPLICATE_SYMBOL 语义回滚到 E102）', () => {
    // 钉死裁决：E102 归 MULTIPLE_ENTRY_RULES（关于 @entry），E104 归 DUPLICATE_SYMBOL。
    // 仅测 orphan code 不够——必须显式断言语义，否则把 E102 help 回滚成旧文案仍会绿。
    const help = HELP_BY_LEXICON['zh-CN'] ?? {};
    if (help['E102'] !== undefined) {
      assert.match(help['E102']!, /@entry/, 'E102 help 应关于 @entry Rule（MULTIPLE_ENTRY_RULES）');
      assert.doesNotMatch(help['E102']!, /选择不同的名称/, 'E102 不应残留旧 DUPLICATE_SYMBOL 语义');
    }
    if (help['E104'] !== undefined) {
      assert.match(help['E104']!, /重复/, 'E104 help 应关于重复符号（DUPLICATE_SYMBOL）');
    }
  });

  it('ts 源 json 与 Java 仓 resources 副本 byte-identical（跨仓同源）', () => {
    // 依赖 aster-lang-ts 与 aster-lang-core 并列 checkout；若 Java 仓不在旁则跳过
    // （CI 单仓场景不误报，跨仓 checkout 时强制两份 json 逐字节一致）。
    const javaCopy = resolve(
      REPO_ROOT,
      '..',
      'aster-lang-core/src/test/resources/diagnostics/error_codes.json',
    );
    let javaBytes: Buffer;
    try {
      javaBytes = readFileSync(javaCopy);
    } catch {
      // Java 仓未并列 checkout：跳过跨仓校验（Java 侧 ErrorCodeParityTest 仍会独立守门）。
      return;
    }
    const tsBytes = readFileSync(JSON_PATH);
    assert.ok(
      tsBytes.equals(javaBytes),
      'shared/error_codes.json 与 aster-lang-core 副本必须 byte-identical——请同步两份副本',
    );
  });
});
