import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/browser.js';
import { evaluate } from '../../src/core/interpreter.js';

// Date.* 合规原语（Stable v1）：epoch-day Int + 纯整数 proleptic Gregorian + 禁 today()。
// fixture 取自 Codex 设计清单（session 019f12c6），双引擎须逐位一致（同 fixture 进 truffle）。
function run(body: string): unknown {
  const c = compile(`Module probe.\n${body}\n`);
  assert.ok(c.core, `compile: ${JSON.stringify((c as { parseErrors?: unknown }).parseErrors ?? [])}`);
  const ev = evaluate(c.core!, 'main', { seed: 0 });
  assert.ok(ev.success, `eval: ${ev.error ?? ''}`);
  return ev.value;
}
const RI = (expr: string): string => `Rule main given seed as Int, produce Int:\n  Return ${expr}.`;
function evalErr(body: string): string {
  const c = compile(`Module probe.\n${body}\n`);
  assert.ok(c.core);
  const ev = evaluate(c.core!, 'main', { seed: 0 });
  return ev.success ? '<no error>' : String(ev.error);
}

describe('Date.* builtin — fromISO (epoch-day)', () => {
  it('1970-01-01 == 0', () => assert.equal(run(RI('Date.fromISO("1970-01-01")')), 0));
  it('1970-01-02 == 1', () => assert.equal(run(RI('Date.fromISO("1970-01-02")')), 1));
  it('1969-12-31 == -1', () => assert.equal(run(RI('Date.fromISO("1969-12-31")')), -1));
  it('2026-06-29 == 20633', () => assert.equal(run(RI('Date.fromISO("2026-06-29")')), 20633));
  it('2000-02-29 == 11016', () => assert.equal(run(RI('Date.fromISO("2000-02-29")')), 11016));
  it('0001-01-01 == -719162', () => assert.equal(run(RI('Date.fromISO("0001-01-01")')), -719162));
  it('9999-12-31 == 2932896', () => assert.equal(run(RI('Date.fromISO("9999-12-31")')), 2932896));
});

describe('Date.* builtin — leap year validation', () => {
  it('2000-02-29 ok', () => assert.equal(run(RI('Date.day(Date.fromISO("2000-02-29"))')), 29));
  it('2400-02-29 ok', () => assert.equal(run(RI('Date.day(Date.fromISO("2400-02-29"))')), 29));
  it('2024-02-29 ok', () => assert.equal(run(RI('Date.day(Date.fromISO("2024-02-29"))')), 29));
  it('1900-02-29 errors (÷100 非闰)', () => assert.match(evalErr(RI('Date.fromISO("1900-02-29")')), /Date\.InvalidISODate/));
  it('2100-02-29 errors', () => assert.match(evalErr(RI('Date.fromISO("2100-02-29")')), /Date\.InvalidISODate/));
  it('2023-02-29 errors', () => assert.match(evalErr(RI('Date.fromISO("2023-02-29")')), /Date\.InvalidISODate/));
});

describe('Date.* builtin — daysBetween / addDays', () => {
  it('same day == 0', () => assert.equal(run(RI('Date.daysBetween(Date.fromISO("1970-01-01"), Date.fromISO("1970-01-01"))')), 0));
  it('1 day forward', () => assert.equal(run(RI('Date.daysBetween(Date.fromISO("1970-01-01"), Date.fromISO("1970-01-02"))')), 1));
  it('1 day backward (negative)', () => assert.equal(run(RI('Date.daysBetween(Date.fromISO("1970-01-02"), Date.fromISO("1970-01-01"))')), -1));
  it('leap-year span 2024-02-28→03-01 == 2', () => assert.equal(run(RI('Date.daysBetween(Date.fromISO("2024-02-28"), Date.fromISO("2024-03-01"))')), 2));
  it('non-leap span 2023-02-28→03-01 == 1', () => assert.equal(run(RI('Date.daysBetween(Date.fromISO("2023-02-28"), Date.fromISO("2023-03-01"))')), 1));
  it('addDays +30', () => assert.equal(run(RI('Date.daysBetween(Date.fromISO("1970-01-01"), Date.addDays(Date.fromISO("1970-01-01"), 30))')), 30));
  it('addDays crosses leap day 2024-02-28 +1 == 02-29', () => assert.equal(run(RI('Date.day(Date.addDays(Date.fromISO("2024-02-28"), 1))')), 29));
});

describe('Date.* builtin — year/month/day extractors', () => {
  it('year', () => assert.equal(run(RI('Date.year(Date.fromISO("2026-06-29"))')), 2026));
  it('month', () => assert.equal(run(RI('Date.month(Date.fromISO("2026-06-29"))')), 6));
  it('day', () => assert.equal(run(RI('Date.day(Date.fromISO("2026-06-29"))')), 29));
  it('year 0001-01-01 == 1', () => assert.equal(run(RI('Date.year(Date.fromISO("0001-01-01"))')), 1));
  it('month 9999-12-31 == 12', () => assert.equal(run(RI('Date.month(Date.fromISO("9999-12-31"))')), 12));
});

describe('Date.* builtin — strict format rejection', () => {
  for (const bad of ['', '2026-2-03', '2026-02-3', '2026-02-30', '2026-13-01', '2026-00-01', '2026-01-00',
    ' 2026-01-01', '2026-01-01 ', '2026-01-01T00:00:00Z', '0000-01-01', '10000-01-01']) {
    it(`rejects ${JSON.stringify(bad)}`, () => assert.match(evalErr(RI(`Date.fromISO(${JSON.stringify(bad)})`)), /Date\.InvalidISODate/));
  }
});

describe('Date.* builtin — 合规业务场景 (评估日期作输入)', () => {
  // "申请日期距评估日期 ≥ 30 天" — 用 epoch-day Int 直接比较，无需 isBefore builtin。
  const consentRule = `Rule main given seed as Int, produce Bool:
  Let evalDay be Date.fromISO("2026-06-29").
  Let consentDay be Date.fromISO("2026-05-30").
  Return Date.daysBetween(consentDay, evalDay) at least 30.`;
  it('consent 30 days ago → at least 30 = true', () => {
    const c = compile(`Module probe.\n${consentRule}\n`);
    assert.ok(c.core);
    const ev = evaluate(c.core!, 'main', { seed: 0 });
    assert.ok(ev.success, ev.error ?? '');
    assert.equal(ev.value, true);
  });
});
