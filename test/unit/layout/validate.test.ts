/**
 * validatePolicyLayout（ADR 0058 §7.5）：每个错误码一正一反。
 * layout_structural_hides_value：《静夜思》通过、《斑点带子案》因「揪出真凶」被拒。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EN_US } from '../../../src/config/lexicons/en-US.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import { SemanticTokenKind as K } from '../../../src/config/token-kind.js';
import { compileAndTypecheck } from '../../../src/browser.js';
import { toCanonical, validatePolicyLayout } from '../../../src/layout/index.js';
import { ROLE_PROBE_BUDGET } from '../../../src/layout/value-tokens.js';
import type { LayoutValidation, PolicyLayout } from '../../../src/layout/index.js';
import {
  JINGYESI_ALIASES,
  JINGYESI_LAYOUT,
  JINGYESI_LEX,
  SHERLOCK_ALIASES,
  SHERLOCK_LAYOUT,
  SHERLOCK_LEX,
  asterSource,
} from './fixtures.js';

function failure(r: LayoutValidation): Exclude<LayoutValidation, { ok: true }> {
  assert.equal(r.ok, false, '应校验失败');
  return r as Exclude<LayoutValidation, { ok: true }>;
}

/** 由 spans 构造 layout，并以其 canonical 作为 source 校验 */
function check(spans: PolicyLayout['spans'], lexicon = EN_US, aliasSet?: Record<string, string[]>): LayoutValidation {
  const layout: PolicyLayout = { v: 1, spans };
  return validatePolicyLayout(layout, toCanonical(layout), lexicon, aliasSet);
}

/** 源码能编译且无类型错误（确认测试用的布局对应合法策略） */
function compiles(source: string, lexicon = EN_US): boolean {
  const r = compileAndTypecheck(source, { lexicon });
  return r.success && !(r.typeErrors ?? []).some((e) => e.severity === 'error');
}

/** 可编译的最小策略：`Return x.`；基线解析无诊断，关键词角色按 AST 判定（片段源码会按 R12 闭锁为值） */
const RET_X_HEAD = 'Module m.\n\nRule f given x as Int, produce Int:\n  Return x';
const RET_X = RET_X_HEAD + '.\n';

describe('示例', () => {
  it('《静夜思》通过全部规则（词法表带别名，或以 aliasSet 冻结别名）', () => {
    const source = asterSource('examples/jingyesi/jingyesi.aster');
    assert.deepEqual(validatePolicyLayout(JINGYESI_LAYOUT, source, JINGYESI_LEX), { ok: true });
    assert.deepEqual(validatePolicyLayout(JINGYESI_LAYOUT, source, ZH_CN, JINGYESI_ALIASES), { ok: true });
  });

  it('《斑点带子案》因结构 span 里的函数名「揪出真凶」被拒（layout_structural_hides_value）', () => {
    const source = asterSource('examples/sherlock/sherlock.aster');
    for (const r of [
      validatePolicyLayout(SHERLOCK_LAYOUT, source, SHERLOCK_LEX),
      validatePolicyLayout(SHERLOCK_LAYOUT, source, ZH_CN, SHERLOCK_ALIASES),
    ]) {
      const f = failure(r);
      assert.equal(f.code, 'layout_structural_hides_value');
      assert.equal(f.offset, source.indexOf('揪出真凶'));
    }
  });
});

describe('layout_invalid_format', () => {
  it('反：结构不合 §7.3 → 拒绝', () => {
    const bad = { v: 1, spans: [{ text: 'x', extra: 1 }] } as unknown as PolicyLayout;
    assert.equal(failure(validatePolicyLayout(bad, 'x', EN_US)).code, 'layout_invalid_format');
    assert.equal(failure(validatePolicyLayout({ v: 1, spans: [] }, '', EN_US)).code, 'layout_invalid_format');
    assert.equal(
      failure(validatePolicyLayout({ v: 1, spans: [{ text: 'x' }, { canonical: '', display: 'y' }] }, 'x', EN_US)).code,
      'layout_invalid_format',
    );
  });
  it('正：合法结构通过', () => {
    assert.deepEqual(check([{ text: RET_X_HEAD }, { canonical: '.', display: '' }, { text: '\n' }]), { ok: true });
  });
});

describe('layout_too_large', () => {
  it('反：源码超过 sourceBytes → 拒绝，并报出是哪个上限', () => {
    const f = failure(check([{ text: 'x'.repeat(12289) }]));
    assert.equal(f.code, 'layout_too_large');
    assert.equal(f.limit, 'sourceBytes');
  });
  it('正：上限内通过', () => {
    assert.deepEqual(check([{ text: 'x'.repeat(12288) }]), { ok: true });
  });
});

describe('layout_roundtrip_mismatch', () => {
  it('反：toCanonical(layout) !== source → 拒绝并报第一个不一致的偏移', () => {
    const layout: PolicyLayout = { v: 1, spans: [{ text: 'Return x' }, { canonical: '.', display: '' }] };
    const f = failure(validatePolicyLayout(layout, 'Return y.', EN_US));
    assert.equal(f.code, 'layout_roundtrip_mismatch');
    assert.equal(f.offset, 7);
    // 前缀关系：偏移为较短者的长度
    assert.equal(failure(validatePolicyLayout(layout, 'Return x.\n', EN_US)).offset, 9);
    assert.equal(failure(validatePolicyLayout(layout, 'Return x', EN_US)).offset, 8);
  });
  it('正：逐字节一致通过', () => {
    const layout: PolicyLayout = { v: 1, spans: [{ text: RET_X_HEAD }, { canonical: '.', display: '' }, { text: '\n' }] };
    assert.deepEqual(validatePolicyLayout(layout, RET_X, EN_US), { ok: true });
  });
});

describe('layout_structural_hides_value', () => {
  const hides = (r: LayoutValidation): number | undefined => {
    const f = failure(r);
    assert.equal(f.code, 'layout_structural_hides_value');
    return f.offset;
  };

  it('反：标识符、数字、字符串、布尔与结构 span 重叠 → 拒绝（偏移指向值的起点）', () => {
    const ret = (type: string, param = ''): string => `Module m.\n\nRule f${param ? ` given ${param}` : ''}, produce ${type}:\n  Return `;
    const at = (head: string, hidden: string): number => hides(check([{ text: head }, { canonical: hidden, display: '' }, { text: '.\n' }]))!;
    const total = ret('Int', 'total as Int');
    assert.equal(at(total, 'total'), total.length);
    assert.equal(at(ret('Int'), '42'), ret('Int').length);
    assert.equal(at(ret('Text'), '"secret"'), ret('Text').length);
    assert.equal(at(ret('Bool'), 'true'), ret('Bool').length);
    // 只盖住值的一部分也算重叠
    assert.equal(hides(check([{ text: total + 'to' }, { canonical: 'tal', display: '' }, { text: '.\n' }])), total.length);
  });

  it('反：zh 字符串字面量（源码用直引号，规范化后为「」）与结构 span 重叠', () => {
    const head = '模块 m。\n\n规则 f 给定 甲 作为 布尔，产出 文本：\n  如果 甲 那么 返回 ';
    const r = check([{ text: head }, { canonical: '"乙"', display: '' }, { text: '。\n  返回 "丙"。\n' }], ZH_CN);
    assert.equal(hides(r), head.length);
  });

  it('反：别名未冻结时，别名词只是普通标识符 → 拒绝；冻结进 aliasSet 后通过', () => {
    const spans: PolicyLayout['spans'] = [{ canonical: '探案笔记 ', display: '《' }, { text: '斑点带子案' }, { canonical: '。', display: '》' }];
    assert.equal(hides(check(spans, ZH_CN)), 0);
    assert.deepEqual(check(spans, ZH_CN, { [K.MODULE_DECL]: ['探案笔记'] }), { ok: true });
  });

  it('反：值与冠词同形（`Return a a plus 1.` 的首个 a 是冠词）时，结构 span 盖住真正的值 → 拒绝', () => {
    const head = 'Module m.\n\nRule f given a as Int, produce Int:\n';
    const r = check([{ text: head + '  Return a ' }, { canonical: 'a', display: '2' }, { text: ' plus 1.\n' }]);
    assert.equal(hides(r), head.length);
  });

  it('反：值与冠词同形且紧贴句号（`Return a a.`）时，结构 span 盖住真正的值 → 拒绝', () => {
    const head = 'Module m.\n\nRule f given a: Int, produce Int:\n';
    const r = check([{ text: head + '  Return a ' }, { canonical: 'a', display: '' }, { text: '.\n' }]);
    assert.equal(hides(r), head.length);
  });

  it('反：值与关键词同形（参数名 `return`，`Return return.` 的第二个是参数引用）→ 按解析器角色认作值并拒绝', () => {
    const head = 'Module m.\n\nRule f given return as Int, produce Int:\n';
    const r = check([{ text: head + '  Return ' }, { canonical: 'return', display: '' }, { text: '.\n' }]);
    assert.equal(hides(r), head.length + '  Return '.length);
  });

  it('反：源码解析不完整（`Return return +`）时，判不了角色的关键词同形词按值计，不依赖保存路径先编译', () => {
    // 首个 `Return` 同样判不了角色、按值计（整行），所以只断言被拒，不断言偏移
    const r = check([{ text: 'Return ' }, { canonical: 'return', display: '' }, { text: ' +' }]);
    assert.ok(hides(r)! <= 7);
  });

  it('反：zh 源码里与英文规范关键词同形的参数名（`返回 return。`）→ 拒绝', () => {
    const head = '模块 m。\n\n规则 f 给定 return 作为 整数 产出 整数：\n';
    const r = check([{ text: head + '  返回 ' }, { canonical: 'return', display: '' }, { text: '。\n' }], ZH_CN);
    assert.equal(hides(r), head.length + '  返回 '.length);
  });

  it('反：de 参数名与关键词同形（`gegeben` 在 AST 里被译作 given）→ 拒绝', () => {
    const head = 'Modul m.\n\nRegel f gegeben gegeben als Ganzzahl, liefert Ganzzahl:\n';
    const r = check([{ text: head + '  Gib zurück ' }, { canonical: 'gegeben', display: '' }, { text: '.\n' }], DE_DE);
    assert.equal(hides(r), head.length + '  Gib zurück '.length);
  });

  it('反：含连字符的字符串字面量与结构 span 重叠 → 拒绝（找回原文位置时不抛正则错误）', () => {
    const head = 'Module m.\n\nRule f, produce Text:\n  Return ';
    assert.equal(hides(check([{ text: head }, { canonical: '"truck-driver"', display: '' }, { text: '.\n' }])), head.length);
  });

  it('正：运算符关键词（AST 里是 Name 节点 `and`）仍是关键词，可以在结构 span 里', () => {
    const head = 'Module m.\n\nRule f given x as Bool, y as Bool, produce Bool:\n  Return x';
    assert.deepEqual(check([{ text: head }, { canonical: ' and ', display: ' && ' }, { text: 'y.\n' }]), { ok: true });
  });

  it('正：上限内的大源码（约 1,700 个 `and` 运算符）加一个结构 span，校验在 1 秒内完成', () => {
    const head = 'Module m.\n\nRule f given x as Bool, produce Bool:\n';
    const line = '  Let y be x and x and x and x and x and x and x and x and x and x and x and x and x.\n';
    const tail = '  Return x.\n';
    let body = '';
    while (Buffer.byteLength(head + body + line + tail) < 12200) body += line;
    const source = head + body + tail;
    const t0 = performance.now();
    const r = check([{ text: source.slice(0, -2) }, { canonical: '.\n', display: ';' }]);
    const ms = performance.now() - t0;
    assert.deepEqual(r, { ok: true });
    assert.ok(ms < 1000, `耗时 ${ms.toFixed(0)}ms`);
  });

  it('正：每行缩进都是结构 span 时，中缀与前缀运算符不逐个重解析，仍通过且在 1 秒内完成', () => {
    const head = 'Module m.\n\nRule f given x as Bool, produce Bool:\n';
    const spans: PolicyLayout['spans'] = [{ text: head }];
    let bytes = head.length;
    for (let n = 0; bytes < 11500; n++) {
      const text = `Let y${n} be x and not x and x or x and x and not x and x and x or x.\n`;
      spans.push({ canonical: '  ', display: '' }, { text });
      bytes += 2 + text.length;
    }
    spans.push({ canonical: '  ', display: '' }, { text: 'Return x.\n' });
    const t0 = performance.now();
    const r = check(spans);
    const ms = performance.now() - t0;
    assert.deepEqual(r, { ok: true });
    assert.ok(ms < 1000, `耗时 ${ms.toFixed(0)}ms`);
  });

  it('正：结构 span 只含缩进时，同形于关键词的词不与之重叠，不花重解析也不被拒（可编译源码）', () => {
    // 参数名 `be` 让每个关键词 `be` 在基线 AST 里都判不了；它们精确位置不碰缩进，故一次重解析都不该花
    const head = 'Module m.\n\nRule f given x as Bool, be as Bool, produce Bool:\n';
    const spans: PolicyLayout['spans'] = [{ text: head }];
    for (let n = 0; n < 40; n++) spans.push({ canonical: '  ', display: '' }, { text: `Let y${n} be be.\n` });
    spans.push({ canonical: '  ', display: '' }, { text: 'Return x.\n' });
    const source = toCanonical({ v: 1, spans });
    assert.equal(compiles(source), true);
    const t0 = performance.now();
    assert.deepEqual(check(spans), { ok: true });
    assert.ok(performance.now() - t0 < 1000);
  });

  it(`反：与结构 span 精确重叠、须重解析判定的词超过 ${ROLE_PROBE_BUDGET} 个时，超出预算的一律按值计（宁可多拒）`, () => {
    // 每行的关键词 `be` 都在结构 span 里；前 ROLE_PROBE_BUDGET 个经重解析判为关键词，其后的按值计
    const head = 'Module m.\n\nRule f given x as Bool, be as Bool, produce Bool:\n';
    const lines = (n: number): PolicyLayout['spans'] => {
      const spans: PolicyLayout['spans'] = [{ text: head }];
      for (let k = 0; k < n; k++) {
        spans.push({ text: `  Let y${k}` }, { canonical: ' be ', display: ' = ' }, { text: 'x.\n' });
      }
      spans.push({ text: '  Return x.\n' });
      return spans;
    };
    assert.equal(compiles(toCanonical({ v: 1, spans: lines(ROLE_PROBE_BUDGET + 4) })), true);
    assert.deepEqual(check(lines(ROLE_PROBE_BUDGET)), { ok: true });
    const t0 = performance.now();
    const r = check(lines(ROLE_PROBE_BUDGET + 4));
    assert.ok(performance.now() - t0 < 1000);
    const f = failure(r);
    assert.equal(f.code, 'layout_structural_hides_value');
    const source = toCanonical({ v: 1, spans: lines(ROLE_PROBE_BUDGET + 4) });
    assert.equal(f.offset, source.indexOf(`y${ROLE_PROBE_BUDGET} be`) + `y${ROLE_PROBE_BUDGET} `.length);
  });

  it('正：关键词（含多词关键词）、标点、空白、注释可以在结构 span 里', () => {
    assert.deepEqual(
      check([
        { canonical: 'Rule ', display: '' }, { text: 'f' }, { canonical: ' given ', display: '(' }, { text: 'x' },
        { canonical: ', produce:\n  ', display: '): ' },
        { canonical: 'If ', display: 'when ' }, { text: 'x' }, { canonical: ' greater than ', display: ' > ' }, { text: '1' },
        { canonical: ' then ', display: ' → ' }, { text: 'Return x' }, { canonical: '.\n  // note\n  ', display: '; ' },
        { text: 'Return 0' }, { canonical: '.', display: '' },
      ]),
      { ok: true },
    );
  });

  it('正：zh 全角标点与换行缩进在结构 span 里', () => {
    assert.deepEqual(
      check([
        { text: '模块 m。\n\n规则 f 给定 甲 作为 布尔，产出 文本：\n  如果 甲 那么 返回 「乙」' }, { canonical: '。\n  ', display: '' },
        { text: '返回 「丙」' }, { canonical: '。', display: '' }, { text: '\n' },
      ], ZH_CN),
      { ok: true },
    );
  });
});

describe('layout_content_parity', () => {
  it('反：没有非空内容 span → 拒绝', () => {
    // 只有注释与空白：没有任何值 token，hides_value 通过，落到 content_parity
    const f = failure(check([{ canonical: '// note', display: '' }, { text: ' ' }, { canonical: '\n', display: '' }]));
    assert.equal(f.code, 'layout_content_parity');
  });
  it('反：结构 span 的 canonical 含引号（注释里，不构成值 token）→ 拒绝', () => {
    const f = failure(check([{ text: 'Return x.' }, { canonical: '\n// "x"', display: '' }]));
    assert.equal(f.code, 'layout_content_parity');
  });
  it('正：有非空内容 span、结构 span 不含引号', () => {
    assert.deepEqual(check([{ text: 'Return x.' }, { canonical: '\n// note', display: '' }]), { ok: true });
  });
});
