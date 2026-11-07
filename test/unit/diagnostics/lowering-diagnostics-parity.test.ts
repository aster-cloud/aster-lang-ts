/**
 * lowering 诊断码 E600–E606 双引擎 parity（ts 侧，aster-lang-ts#302）。
 *
 * 共享夹具 shared/lowering_diagnostics_parity.json 与 aster-lang-core 的
 * src/test/resources/diagnostics/lowering_diagnostics_parity.json byte-identical；core 侧
 * LoweringDiagnosticsParityTest 对同一夹具做渲染 parity。lowering 错误是 AST 不变量守卫，
 * 源码无法直接触发：这里按夹具 trigger 把合法 AST 的一个节点改成未知种类再交给 lowering。
 * 判定规则写在夹具的 description 里。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parseWithLexicon } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { compile, compileAndTypecheck } from '../../../src/browser.js';
import { DiagnosticError } from '../../../src/diagnostics/diagnostics.js';
import { toLoweringDiagnostic } from '../../../src/diagnostics/lowering.js';
import { ERROR_METADATA, ErrorCode } from '../../../src/diagnostics/error_codes.js';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import type { Func, Match, Module, Return } from '../../../src/types.js';

type Trigger =
  | 'unknown-decl-kind'
  | 'unknown-effect'
  | 'unknown-stmt-kind'
  | 'unknown-expr-kind'
  | 'unknown-pattern-kind'
  | 'unknown-type-kind'
  | 'internal-error';

interface ParityCase {
  readonly name: string;
  readonly lexicon?: string;
  readonly only?: 'ts' | 'core';
  readonly trigger: Trigger;
  readonly value?: string;
  readonly source: string;
  readonly codes: readonly (readonly [string, number])[];
  readonly params: Readonly<Record<string, string>>;
  readonly message?: string;
}

const REPO_ROOT = process.cwd();
const FIXTURE = resolve(REPO_ROOT, 'shared', 'lowering_diagnostics_parity.json');
const CASES = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: ParityCase[] }).cases;
const LEXICONS: Readonly<Record<string, Lexicon>> = { 'en-US': EN_US, 'zh-CN': ZH_CN, 'de-DE': DE_DE };
const LOWERING_CODES = Object.values(ERROR_METADATA)
  .filter((m) => m.category === 'lowering')
  .map((m) => m.code as string)
  .sort();

function parseClean(c: ParityCase): Module {
  const lexicon = LEXICONS[c.lexicon ?? 'en-US'];
  assert.ok(lexicon, `未知 lexicon ${c.lexicon}`);
  const parsed = parseWithLexicon(lex(canonicalize(c.source, lexicon), lexicon), lexicon);
  assert.deepEqual(parsed.diagnostics, [], `${c.name}: 夹具源码必须能无诊断解析`);
  return parsed.ast;
}

/** 把合法 AST 的一个节点改成未知种类（保留其 span），其余结构不变。 */
function mutate(ast: Module, trigger: Trigger, value: string): Module {
  const func = ast.decls[0] as Func;
  const [match, ret] = func.body!.statements as [Match, Return];
  const unknown = <T extends object>(node: T): T => ({ ...node, kind: value }) as T;
  const withFunc = (f: Func): Module => ({ ...ast, decls: [f, ...ast.decls.slice(1)] });
  const withStatements = (statements: readonly unknown[]): Module =>
    withFunc({ ...func, body: { ...func.body!, statements } } as Func);
  switch (trigger) {
    case 'unknown-decl-kind':
      return withFunc(unknown(func));
    case 'unknown-effect':
      return withFunc({ ...func, effects: [...func.effects, value] });
    case 'unknown-stmt-kind':
      return withStatements([unknown(match), ret]);
    case 'unknown-expr-kind':
      return withStatements([match, { ...ret, expr: unknown(ret.expr) }]);
    case 'unknown-pattern-kind':
      return withStatements([{ ...match, cases: [{ ...match.cases[0]!, pattern: unknown(match.cases[0]!.pattern) }] }, ret]);
    case 'unknown-type-kind':
      return withFunc({ ...func, params: [{ ...func.params[0]!, type: unknown(func.params[0]!.type) }] });
    default:
      throw new Error(`夹具 trigger 不受支持：${trigger}`);
  }
}

function assertParams(actual: Readonly<Record<string, unknown>> | undefined, expected: Readonly<Record<string, string>>, name: string): void {
  assert.ok(actual, `${name}: params`);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${name}: params 键`);
  for (const [k, v] of Object.entries(expected)) if (v !== '*') assert.equal(actual[k], v, `${name}: params.${k}`);
}

describe('lowering 诊断码 E600–E606 双引擎 parity 夹具（ts 侧）', () => {
  for (const c of CASES.filter((x) => x.only !== 'core' && x.trigger !== 'internal-error')) {
    it(c.name, () => {
      const ast = mutate(parseClean(c), c.trigger, c.value!);
      let thrown: unknown;
      try {
        lowerModule(ast);
      } catch (e) {
        thrown = e;
      }
      assert.ok(thrown instanceof DiagnosticError, `${c.name}: lowering 应抛 DiagnosticError，实际 ${String(thrown)}`);
      const d = thrown.diagnostic;
      assert.deepEqual([[d.code, d.span.start.line]], c.codes);
      assertParams(d.params, c.params, c.name);
      assert.equal(d.message, c.message);
      assert.equal(ERROR_METADATA[d.code as ErrorCode]?.category, 'lowering');
    });
  }

  for (const c of CASES.filter((x) => x.trigger === 'internal-error')) {
    it(c.name, () => {
      // lowering 阶段的非诊断异常经 toLoweringDiagnostic 统一成 E606（compile() 只对 resolveAndLower 调用做此转换）
      const d = toLoweringDiagnostic(new Error('boom'));
      assert.ok(d, 'E606');
      assert.deepEqual([[d.code, d.span?.start.line ?? 0]], c.codes);
      assertParams(d.data as Record<string, unknown>, c.params, c.name);
      assert.match(d.message, /^Internal error during lowering: .+/);
      assert.equal(d.help, ERROR_METADATA[ErrorCode.LOWER_INTERNAL_ERROR].help);
    });
  }

  it('E600–E606 每个码至少一例，且 lowering 码恰为这 7 个', () => {
    const covered = new Set(CASES.flatMap((c) => c.codes.map(([code]) => code)));
    assert.deepEqual(LOWERING_CODES, ['E600', 'E601', 'E602', 'E603', 'E604', 'E605', 'E606']);
    assert.deepEqual(LOWERING_CODES.filter((code) => !covered.has(code)), []);
    for (const lexicon of ['zh-CN', 'de-DE']) {
      const perLexicon = new Set(CASES.filter((c) => c.lexicon === lexicon).flatMap((c) => c.codes.map(([code]) => code)));
      assert.deepEqual(['E600', 'E601', 'E602', 'E603', 'E604', 'E605'].filter((code) => !perLexicon.has(code)), [], `${lexicon} 缺例`);
    }
  });

  it('夹具中的 lowering 诊断都带命名参数，且 message 与码表模板按参数渲染一致', () => {
    for (const c of CASES.filter((x) => x.message !== undefined)) {
      const template = ERROR_METADATA[c.codes[0]![0] as ErrorCode]?.message;
      assert.ok(template, c.name);
      const rendered = template.replace(/\{(\w+)\}/g, (_, k: string) => c.params[k] ?? `{${k}}`);
      assert.equal(rendered, c.message, `${c.name}: 模板渲染`);
    }
  });

  it('ts 夹具与 aster-lang-core 副本 byte-identical（跨仓同源）', () => {
    // 与 parse-diagnostics-parity 同口径：CI 中兄弟仓必须存在（fail-closed），本地未并列 checkout 时跳过。
    const RELATIVE = 'src/test/resources/diagnostics/lowering_diagnostics_parity.json';
    const candidates = [
      resolve(REPO_ROOT, '..', 'aster-lang-core', RELATIVE),
      resolve(REPO_ROOT, 'aster-lang-core', RELATIVE),
    ];
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
    assert.ok(readFileSync(FIXTURE).equals(javaBytes), 'lowering_diagnostics_parity.json 与 aster-lang-core 副本必须 byte-identical');
  });
});

describe('compile() 的 lowering 诊断（aster-lang-ts#302）', () => {
  const unknownEffect = new DiagnosticError({
    severity: 'error' as never,
    code: ErrorCode.LOWER_UNKNOWN_EFFECT,
    params: { effect: 'teleport', valid: 'io, cpu, pure' },
    message: "Unknown effect 'teleport', valid values: io, cpu, pure",
    span: { start: { line: 3, col: 1 }, end: { line: 3, col: 1 } },
  });

  it('toLoweringDiagnostic：lowering 码的 DiagnosticError 转为带 data/help/span 的结构化诊断', () => {
    const d = toLoweringDiagnostic(unknownEffect);
    assert.ok(d);
    assert.equal(d.severity, 'error');
    assert.equal(d.code, ErrorCode.LOWER_UNKNOWN_EFFECT);
    assert.equal(d.message, unknownEffect.message);
    assert.deepEqual(d.data, { effect: 'teleport', valid: 'io, cpu, pure' });
    assert.deepEqual(d.span, unknownEffect.diagnostic.span);
    assert.equal(d.help, ERROR_METADATA[ErrorCode.LOWER_UNKNOWN_EFFECT].help);
  });

  it('toLoweringDiagnostic：解析码的 DiagnosticError 不属于 lowering，返回 undefined', () => {
    const parse = new DiagnosticError({ ...unknownEffect.diagnostic, code: ErrorCode.PARSE_EXPECTED, params: { token: 'kw.rule' } });
    assert.equal(toLoweringDiagnostic(parse), undefined);
  });

  it('toLoweringDiagnostic：普通异常转为 E606，detail 为异常消息', () => {
    const d = toLoweringDiagnostic(new TypeError('boom'));
    assert.ok(d);
    assert.equal(d.code, ErrorCode.LOWER_INTERNAL_ERROR);
    assert.equal(d.message, 'Internal error during lowering: boom');
    assert.deepEqual(d.data, { detail: 'boom' });
    assert.equal(d.span, undefined);
    const s = toLoweringDiagnostic('plain');
    assert.deepEqual(s?.data, { detail: 'plain' });
  });

  it('前置阶段（规范化 / 解析）的非诊断异常保持原行为：只给裸 loweringErrors，不标为 E606', () => {
    const result = compile(42 as unknown as string);
    assert.equal(result.success, false);
    assert.equal(result.loweringDiagnostics, undefined, '前置阶段异常不是 lowering 诊断');
    assert.equal(result.parseErrors, undefined);
    assert.equal(result.loweringErrors?.length, 1);
    assert.match(result.loweringErrors![0]!, /^(?!Internal error during lowering)/);
    const typed = compileAndTypecheck(42 as unknown as string);
    assert.deepEqual(typed.typeErrors, []);
    assert.equal(typed.loweringDiagnostics, undefined);
  });

  it('解析期 DiagnosticError 仍走 parseErrors，不进 loweringDiagnostics', () => {
    const result = compile('Module m.\n\nRule f given x as Int, produce Int:\n  Return "abc.\n');
    assert.equal(result.success, false);
    assert.equal(result.parseErrors?.[0]?.code, ErrorCode.PARSE_UNTERMINATED_STRING);
    assert.equal(result.loweringDiagnostics, undefined);
    assert.equal(result.loweringErrors, undefined);
  });

  it('正常源码不产生 loweringDiagnostics', () => {
    const ok = compile('Module m.\n\nRule f given x as Int, produce Int:\n  Return x.\n');
    assert.equal(ok.success, true);
    assert.equal(ok.loweringDiagnostics, undefined);
  });
});
