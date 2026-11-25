/**
 * 名字转义（ADR 0064）两引擎共享夹具 shared/escape_parity.json（§10 F1–F7）：词法与 E902、IR 中性、规范化不透明、
 * 关键词判定排除、§4 例子、E808 / W802 / E901 诊断与附录 A。
 *
 * 夹具与 aster-lang-core src/test/resources/diagnostics/escape_parity.json 逐字节相同，core EscapeParityTest 按同一夹具断言。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from '../../../src/browser.js';
import { CompileFailure, compileSource, positionFreeSha256 } from '../../../src/policy-package/compile-source.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import { HI_IN } from '../../../src/config/lexicons/hi-IN.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';

interface EscapeCase {
  readonly name: string;
  readonly group: string;
  readonly lexicon: string;
  readonly source: string;
  readonly aliasSet?: Readonly<Record<string, readonly string[]>>;
  readonly reject?: readonly [string, number];
  readonly column?: number;
  readonly params?: Readonly<Record<string, string>>;
  readonly message?: string;
  readonly names?: readonly string[];
  readonly samePf?: string;
  readonly behavesAs?: string;
  readonly warnings?: readonly (readonly [string, number])[];
}

const REPO_ROOT = process.cwd();
const FIXTURE = resolve(REPO_ROOT, 'shared', 'escape_parity.json');
const DATA = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { readonly cases: readonly EscapeCase[] };
const LEXICONS: Readonly<Record<string, Lexicon>> = { 'en-US': EN_US, 'zh-CN': ZH_CN, 'de-DE': DE_DE, 'hi-IN': HI_IN };

interface FirstDiagnostic {
  readonly code: string;
  readonly line: number;
  readonly column: number;
  readonly params: Readonly<Record<string, unknown>>;
  readonly message: string;
}

/** 编译结果：成功时 ir 非空，失败时 first 为第一条诊断（与 core InProcessCnlParser 的第一条诊断对应）。 */
function compileCase(source: string, c: EscapeCase): { ir?: string; first?: FirstDiagnostic } {
  try {
    return {
      ir: compileSource(source, {
        locale: c.lexicon,
        ...(c.aliasSet ? { aliasSet: c.aliasSet as Record<string, string[]>, allowStructural: true } : {}),
      }),
    };
  } catch (e) {
    if (!(e instanceof CompileFailure)) throw e;
    const raw = e.diagnostics[0] ?? '';
    let d: { code?: string; span?: { start?: { line?: number; col?: number } }; params?: Record<string, unknown>; data?: Record<string, unknown>; message?: string };
    try {
      d = JSON.parse(raw);
    } catch {
      return { first: { code: 'unparsed', line: 0, column: 0, params: {}, message: raw } };
    }
    return {
      first: {
        code: String(d.code),
        line: d.span?.start?.line ?? 0,
        column: d.span?.start?.col ?? 0,
        params: d.params ?? d.data ?? {},
        message: String(d.message ?? ''),
      },
    };
  }
}

describe('名字转义共享夹具（ts 侧，ADR 0064 §10）', () => {
  it('共享夹具共 121 例，F1–F7 七组都有', () => {
    assert.equal(DATA.cases.length, 121);
    assert.deepEqual([...new Set(DATA.cases.map((c) => c.group))].sort(), ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7']);
  });

  for (const c of DATA.cases) {
    it(`${c.group} ${c.name}`, () => {
      const out = compileCase(c.source, c);
      if (c.reject) {
        assert.equal(out.ir, undefined, '应拒绝');
        if (c.reject[0] === 'forged') return;
        assert.ok(out.first);
        assert.deepEqual([out.first.code, out.first.line], [...c.reject]);
        if (c.column !== undefined) assert.equal(out.first.column, c.column);
        if (c.params) assert.deepEqual(out.first.params, c.params);
        if (c.message && c.lexicon === 'en-US') assert.equal(out.first.message, c.message);
        return;
      }
      if (c.behavesAs !== undefined) {
        const other = compileCase(c.behavesAs, c);
        assert.equal(out.ir === undefined, other.ir === undefined, '两份源码同为通过或同为失败');
        if (out.ir !== undefined) {
          assert.equal(positionFreeSha256(out.ir), positionFreeSha256(other.ir!));
        } else {
          assert.deepEqual([out.first?.code, out.first?.line], [other.first?.code, other.first?.line]);
        }
        return;
      }
      assert.ok(out.ir !== undefined, `应编译通过：${JSON.stringify(out.first)}`);
      for (const n of c.names ?? []) assert.ok(out.ir.includes(`"${n}"`), `Core IR 含名字 ${n}`);
      if (c.samePf !== undefined) {
        const other = compileCase(c.samePf, c);
        assert.ok(other.ir !== undefined, `对照源码应编译通过：${JSON.stringify(other.first)}`);
        assert.equal(positionFreeSha256(out.ir), positionFreeSha256(other.ir));
      }
      if (c.warnings) {
        const lexicon = LEXICONS[c.lexicon]!;
        const result = compile(c.source, { lexicon });
        const warnings = (result.resolutionDiagnostics ?? [])
          .filter((d) => d.code === 'W802')
          .map((d) => [d.code, d.span?.start.line ?? 0]);
        assert.deepEqual(warnings, c.warnings);
      }
    });
  }

  it('ts 夹具与 aster-lang-core 副本 byte-identical（跨仓同源）', () => {
    // 与 keyword-name-parity 同口径：CI 中兄弟仓必须存在（fail-closed），本地未并列 checkout 时跳过。
    const RELATIVE = 'src/test/resources/diagnostics/escape_parity.json';
    const candidates = [resolve(REPO_ROOT, '..', 'aster-lang-core', RELATIVE), resolve(REPO_ROOT, 'aster-lang-core', RELATIVE)];
    const inCi =
      process.env.CI === 'true' ||
      process.env.GITHUB_ACTIONS === 'true' ||
      process.env.ASTER_ERROR_CODES_PARITY_REQUIRED === 'true';
    let javaBytes: Buffer | undefined;
    for (const candidate of candidates) {
      try {
        javaBytes = readFileSync(candidate);
        break;
      } catch {
        // 试下一个候选路径
      }
    }
    if (!javaBytes) {
      if (inCi) assert.fail(`CI 中必须 checkout aster-lang-core 才能校验 parity 夹具同源：\n${candidates.join('\n')}`);
      return;
    }
    assert.ok(readFileSync(FIXTURE).equals(javaBytes), 'escape_parity.json 与 aster-lang-core 副本必须 byte-identical');
  });
});
