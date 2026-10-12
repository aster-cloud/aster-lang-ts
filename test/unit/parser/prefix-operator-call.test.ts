/**
 * 前缀运算符调用 `<op>(a, b)`：与 Java AsterParser.operatorCall 对齐。
 * 降为与中缀写法相同的 Call(Name(规范符号), [a, b])，`=` 与中缀一样规范为 `==`；恰好 2 个参数。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { lex } from '../../../src/frontend/lexer.js';
import { parse, parseWithLexicon } from '../../../src/parser.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule } from '../../../src/typecheck.js';
import type { Core } from '../../../src/types.js';

function toCore(source: string): Core.Module {
  const result = parse(lex(canonicalize(source)));
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((d) => `${d.code} ${d.message}`).join('\n'));
  return lowerModule(result.ast);
}

function zhToCore(source: string): Core.Module {
  const result = parseWithLexicon(lex(canonicalize(source, ZH_CN), ZH_CN), ZH_CN);
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((d) => `${d.code} ${d.message}`).join('\n'));
  return lowerModule(result.ast);
}

function stripOrigins(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(stripOrigins);
  if (!o || typeof o !== 'object') return o;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k !== 'origin') out[k] = stripOrigins(v);
  }
  return out;
}

function ruleReturning(expr: string, ret: string): string {
  return `Module m.\n\nRule r given x as Int, y as Int, produce ${ret}:\n  Return ${expr}.\n`;
}

// [前缀运算符, 等价中缀写法, 返回类型]
const CASES: ReadonlyArray<readonly [string, string, string]> = [
  ['<', 'x < y', 'Bool'],
  ['>', 'x > y', 'Bool'],
  ['<=', 'x <= y', 'Bool'],
  ['>=', 'x >= y', 'Bool'],
  ['!=', 'x != y', 'Bool'],
  ['==', 'x == y', 'Bool'],
  ['=', 'x = y', 'Bool'],
  ['+', 'x + y', 'Int'],
  ['-', 'x - y', 'Int'],
  ['*', 'x * y', 'Int'],
  ['/', 'x / y', 'Int'],
];

describe('前缀运算符调用', () => {
  for (const [op, infix, ret] of CASES) {
    test(`${op}(x, y) 与 ${infix} 的 Core IR 相同`, () => {
      const prefix = toCore(ruleReturning(`${op}(x, y)`, ret));
      assert.deepEqual(stripOrigins(prefix), stripOrigins(toCore(ruleReturning(infix, ret))));
      assert.deepEqual(typecheckModule(prefix).filter((d) => d.severity === 'error'), []);
    });
  }

  test('= 规范为 ==', () => {
    const func = toCore(ruleReturning('=(x, y)', 'Bool')).decls[0] as Core.Func;
    const ret = func.body.statements[0] as Core.Return;
    assert.equal(((ret.expr as Core.Call).target as Core.Name).name, '==');
  });

  test('实参可为任意表达式，且前缀调用可作中缀操作数', () => {
    assert.deepEqual(
      stripOrigins(toCore(ruleReturning('>=(x plus 1, y) and =(x, 2)', 'Bool'))),
      stripOrigins(toCore(ruleReturning('x plus 1 at least y and x = 2', 'Bool'))));
  });

  test('参数个数不是 2 时报错（与 Java 同一消息）', () => {
    assert.throws(() => toCore(ruleReturning('+(x, y, x)', 'Int')), /前缀操作符调用需要 2 个参数，但实际为 3/);
    assert.throws(() => toCore(ruleReturning('>=(x)', 'Bool')), /前缀操作符调用需要 2 个参数，但实际为 1/);
  });
});

// 以下各组与 aster-lang-core 实测一致（Canonicalizer + AsterParser + AstBuilder）。
function boolRule(expr: string): string {
  return `Module m.\n\nRule r given a as Bool, b as Bool, x as Int, y as Int, produce Bool:\n  Return ${expr}.\n`;
}

function zhRule(expr: string): string {
  return `模块 m。\n\n规则 评估 给定 甲，乙，产出：\n  返回 ${expr}。\n`;
}

const WORD_CALL_REJECTED = /运算符词 '([a-z ]+)' 不能用作前缀调用/;

describe('运算符词前缀调用（en-US）：Java operatorCall 只认符号', () => {
  // [源码表达式, 报错中的运算符词]
  const REJECTED: ReadonlyArray<readonly [string, string]> = [
    ['and(a, b)', 'and'],
    ['or(a, b)', 'or'],
    ['and(a)', 'and'],
    ['plus(x, y) > 0', 'plus'],
    ['minus(x, y) > 0', 'minus'],
    ['times(x, y) > 0', 'times'],
    ['modulo(x, y) > 0', 'modulo'],
  ];
  for (const [expr, word] of REJECTED) {
    test(`${expr} 被拒绝`, () => {
      assert.throws(
        () => toCore(boolRule(expr)),
        new RegExp(`运算符词 '${word}' 不能用作前缀调用；只有符号运算符 < > <= >= != == = \\+ - \\* / 可以写成 op\\(a, b\\)`),
      );
    });
  }

  // 多词运算符原本就被两引擎拒绝（TS 报通用语法错误），锁定现状
  const MULTI_WORD_REJECTED: ReadonlyArray<readonly [string, RegExp]> = [
    ['divided by(x, y) > 0', WORD_CALL_REJECTED],
    ['integer divided by(x, y) > 0', WORD_CALL_REJECTED],
    ['less than(x, y)', WORD_CALL_REJECTED],
    ['greater than(x, y)', WORD_CALL_REJECTED],
    ['more than(x, y)', WORD_CALL_REJECTED],
    ['at least(x, y)', WORD_CALL_REJECTED],
    ['at most(x, y)', WORD_CALL_REJECTED],
    ['equals to(x, y)', WORD_CALL_REJECTED],
    ['not equal to(x, y)', /Expected '\.' at end of statement/],
    ['less than or equal to(x, y)', /Expected '\.' at end of statement/],
    ['is less than(x, y)', /Expected '\)' after expression/],
    ['not(a, b)', /Expected '\)' after expression/],
  ];
  for (const [expr, message] of MULTI_WORD_REJECTED) {
    test(`${expr} 被拒绝`, () => {
      assert.throws(() => toCore(boolRule(expr)), message);
    });
  }

  test('中缀 and/or 不受影响', () => {
    assert.doesNotThrow(() => toCore(boolRule('a and b or a')));
  });

  test('not(a) 是一元 not 作用于括号表达式，与 not a 相同', () => {
    assert.deepEqual(stripOrigins(toCore(boolRule('not(a)'))), stripOrigins(toCore(boolRule('not a'))));
  });

  test('en-US 下 under/over 是软关键词：under(x, y) 是普通函数调用', () => {
    for (const word of ['under', 'over']) {
      const func = toCore(boolRule(`${word}(x, y)`)).decls[0] as Core.Func;
      const call = (func.body.statements[0] as Core.Return).expr as Core.Call;
      assert.equal((call.target as Core.Name).name, word);
    }
  });

  test('大小写不同的同名标识符是普通函数调用（Java lexer 区分大小写）', () => {
    for (const name of ['Plus', 'pLus', 'And']) {
      const func = toCore(boolRule(`${name}(x, y)`)).decls[0] as Core.Func;
      const call = (func.body.statements[0] as Core.Return).expr as Core.Call;
      assert.equal((call.target as Core.Name).name, name);
    }
  });
});

describe('运算符词前缀调用（非英语词法表）：Java Canonicalizer 把可映射的运算符词翻成符号', () => {
  // [中文运算符词或英文关键词, 对应符号]
  const ACCEPTED: ReadonlyArray<readonly [string, string]> = [
    ['加上', '+'],
    ['减去', '-'],
    ['乘以', '*'],
    ['除以', '/'],
    ['小于', '<'],
    ['大于', '>'],
    ['多于', '>'],
    ['等于', '=='],
    ['至少', '>='],
    ['至多', '<='],
    ['不足', '<'],
    ['超过', '>'],
    ['plus', '+'],
    ['under', '<'],
  ];
  for (const [word, symbol] of ACCEPTED) {
    test(`${word}(甲，乙) 与 ${symbol}(甲，乙) 的 Core IR 相同`, () => {
      assert.deepEqual(
        stripOrigins(zhToCore(zhRule(`${word}(甲，乙)`))),
        stripOrigins(zhToCore(zhRule(`${symbol}(甲，乙)`))));
    });
  }

  // 报错里的运算符词按作者 locale 拼写呈现（parseWithLexicon 回译规范关键词）。
  // 作者在 zh 源码里直接写英文 and/modulo 时，同样显示 zh 词表的规范拼写。
  const REJECTED: ReadonlyArray<readonly [string, string]> = [
    ['并且(真值，假值)', '并且'],
    ['或者(真值，假值)', '或者'],
    ['取模(甲，乙)', '取模'],
    ['整除(甲，乙)', '整除'],
    ['and(真值，假值)', '并且'],
    ['modulo(甲，乙)', '取模'],
  ];
  for (const [expr, word] of REJECTED) {
    test(`${expr} 被拒绝`, () => {
      assert.throws(() => zhToCore(zhRule(expr)), new RegExp(`运算符词 '${word}' 不能用作前缀调用`));
    });
  }

  test('参数个数不是 2 时报与符号前缀调用相同的错误', () => {
    assert.throws(() => zhToCore(zhRule('加上(甲)')), /前缀操作符调用需要 2 个参数，但实际为 1/);
  });

  test('不是(真值) 仍是一元 not', () => {
    assert.deepEqual(stripOrigins(zhToCore(zhRule('不是(真值)'))), stripOrigins(zhToCore(zhRule('不是 真值'))));
  });
});
