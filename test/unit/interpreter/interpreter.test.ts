import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../../../src/core/interpreter.js';
import type { Core } from '../../../src/types.js';

// ============================================================================
// 辅助函数：构造 Core IR 节点
// ============================================================================

function mkModule(decls: Core.Declaration[]): Core.Module {
  return { kind: 'Module', name: 'test', decls };
}

function mkFunc(
  name: string,
  params: Core.Parameter[],
  body: Core.Statement[],
): Core.Func {
  return {
    kind: 'Func',
    name,
    typeParams: [],
    params,
    ret: { kind: 'TypeName', name: 'Int' },
    effects: [],
    effectCaps: [],
    effectCapsExplicit: false,
    body: { kind: 'Block', statements: body },
  };
}

function mkParam(name: string): Core.Parameter {
  return { name, type: { kind: 'TypeName', name: 'Int' } };
}

function mkInt(value: number): Core.Int {
  return { kind: 'Int', value };
}

function mkDouble(value: number): Core.Double {
  return { kind: 'Double', value };
}

function mkBool(value: boolean): Core.Bool {
  return { kind: 'Bool', value };
}

function mkStr(value: string): Core.String {
  return { kind: 'String', value };
}

function mkName(name: string): Core.Name {
  return { kind: 'Name', name };
}

function mkCall(op: string, args: Core.Expression[]): Core.Call {
  return { kind: 'Call', target: mkName(op), args };
}

function mkReturn(expr: Core.Expression): Core.Return {
  return { kind: 'Return', expr };
}

function mkLet(name: string, expr: Core.Expression): Core.Let {
  return { kind: 'Let', name, expr };
}

function mkIf(
  cond: Core.Expression,
  thenStmts: Core.Statement[],
  elseStmts: Core.Statement[] | null,
): Core.If {
  return {
    kind: 'If',
    cond,
    thenBlock: { kind: 'Block', statements: thenStmts },
    elseBlock: elseStmts ? { kind: 'Block', statements: elseStmts } : null,
  };
}

function mkConstruct(
  typeName: string,
  fields: { name: string; expr: Core.Expression }[],
): Core.Construct {
  return { kind: 'Construct', typeName, fields };
}

// ============================================================================
// 测试
// ============================================================================

describe('Core IR 解释器', () => {
  describe('字面量求值', () => {
    it('返回整数字面量', () => {
      const mod = mkModule([mkFunc('f', [], [mkReturn(mkInt(42))])]);
      const result = evaluate(mod, 'f', {});
      assert.ok(result.success);
      assert.equal(result.value, 42);
    });

    it('返回浮点数字面量', () => {
      const mod = mkModule([mkFunc('f', [], [mkReturn(mkDouble(3.14))])]);
      const result = evaluate(mod, 'f', {});
      assert.ok(result.success);
      assert.equal(result.value, 3.14);
    });

    it('返回布尔字面量', () => {
      const mod = mkModule([mkFunc('f', [], [mkReturn(mkBool(true))])]);
      const result = evaluate(mod, 'f', {});
      assert.ok(result.success);
      assert.equal(result.value, true);
    });

    it('返回字符串字面量', () => {
      const mod = mkModule([mkFunc('f', [], [mkReturn(mkStr('hello'))])]);
      const result = evaluate(mod, 'f', {});
      assert.ok(result.success);
      assert.equal(result.value, 'hello');
    });

    it('返回 null', () => {
      const mod = mkModule([mkFunc('f', [], [mkReturn({ kind: 'Null' })])]);
      const result = evaluate(mod, 'f', {});
      assert.ok(result.success);
      assert.equal(result.value, null);
    });
  });

  describe('算术运算', () => {
    it('加法', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('a'), mkParam('b')], [
          mkReturn(mkCall('+', [mkName('a'), mkName('b')])),
        ]),
      ]);
      const result = evaluate(mod, 'f', { a: 10, b: 20 });
      assert.ok(result.success);
      assert.equal(result.value, 30);
    });

    it('减法', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('a'), mkParam('b')], [
          mkReturn(mkCall('-', [mkName('a'), mkName('b')])),
        ]),
      ]);
      const result = evaluate(mod, 'f', { a: 50, b: 20 });
      assert.ok(result.success);
      assert.equal(result.value, 30);
    });

    it('乘法', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('a'), mkParam('b')], [
          mkReturn(mkCall('*', [mkName('a'), mkName('b')])),
        ]),
      ]);
      const result = evaluate(mod, 'f', { a: 6, b: 7 });
      assert.ok(result.success);
      assert.equal(result.value, 42);
    });

    it('除法', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('a'), mkParam('b')], [
          mkReturn(mkCall('/', [mkName('a'), mkName('b')])),
        ]),
      ]);
      const result = evaluate(mod, 'f', { a: 100, b: 4 });
      assert.ok(result.success);
      assert.equal(result.value, 25);
    });

    it('除以零返回错误', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('a')], [
          mkReturn(mkCall('/', [mkName('a'), mkInt(0)])),
        ]),
      ]);
      const result = evaluate(mod, 'f', { a: 10 });
      assert.ok(!result.success);
      assert.ok(result.error?.includes('Division by zero'));
    });

    it('字符串拼接', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('a'), mkParam('b')], [
          mkReturn(mkCall('+', [mkName('a'), mkName('b')])),
        ]),
      ]);
      const result = evaluate(mod, 'f', { a: 'Hello, ', b: 'World' });
      assert.ok(result.success);
      assert.equal(result.value, 'Hello, World');
    });
  });

  describe('比较运算', () => {
    it('大于', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('a')], [
          mkReturn(mkCall('>', [mkName('a'), mkInt(100)])),
        ]),
      ]);
      assert.equal(evaluate(mod, 'f', { a: 150 }).value, true);
      assert.equal(evaluate(mod, 'f', { a: 50 }).value, false);
    });

    it('小于', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('a')], [
          mkReturn(mkCall('<', [mkName('a'), mkInt(100)])),
        ]),
      ]);
      assert.equal(evaluate(mod, 'f', { a: 50 }).value, true);
      assert.equal(evaluate(mod, 'f', { a: 150 }).value, false);
    });

    it('大于等于', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('a')], [
          mkReturn(mkCall('>=', [mkName('a'), mkInt(100)])),
        ]),
      ]);
      assert.equal(evaluate(mod, 'f', { a: 100 }).value, true);
      assert.equal(evaluate(mod, 'f', { a: 99 }).value, false);
    });

    it('小于等于', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('a')], [
          mkReturn(mkCall('<=', [mkName('a'), mkInt(100)])),
        ]),
      ]);
      assert.equal(evaluate(mod, 'f', { a: 100 }).value, true);
      assert.equal(evaluate(mod, 'f', { a: 101 }).value, false);
    });

    it('等于', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('a')], [
          mkReturn(mkCall('==', [mkName('a'), mkStr('gold')])),
        ]),
      ]);
      assert.equal(evaluate(mod, 'f', { a: 'gold' }).value, true);
      assert.equal(evaluate(mod, 'f', { a: 'silver' }).value, false);
    });
  });

  describe('逻辑运算', () => {
    it('and 短路求值', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('a'), mkParam('b')], [
          mkReturn(mkCall('and', [
            mkCall('>', [mkName('a'), mkInt(10)]),
            mkCall('>', [mkName('b'), mkInt(20)]),
          ])),
        ]),
      ]);
      assert.equal(evaluate(mod, 'f', { a: 15, b: 25 }).value, true);
      assert.equal(evaluate(mod, 'f', { a: 5, b: 25 }).value, false);
      assert.equal(evaluate(mod, 'f', { a: 15, b: 15 }).value, false);
    });

    it('or 短路求值', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('a'), mkParam('b')], [
          mkReturn(mkCall('or', [
            mkCall('>', [mkName('a'), mkInt(100)]),
            mkCall('>', [mkName('b'), mkInt(100)]),
          ])),
        ]),
      ]);
      assert.equal(evaluate(mod, 'f', { a: 150, b: 0 }).value, true);
      assert.equal(evaluate(mod, 'f', { a: 0, b: 150 }).value, true);
      assert.equal(evaluate(mod, 'f', { a: 0, b: 0 }).value, false);
    });

    it('not', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('a')], [
          mkReturn(mkCall('not', [mkName('a')])),
        ]),
      ]);
      assert.equal(evaluate(mod, 'f', { a: true }).value, false);
      assert.equal(evaluate(mod, 'f', { a: false }).value, true);
    });
  });

  describe('条件分支', () => {
    it('If-then 分支（true）', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('amount')], [
          mkIf(
            mkCall('>', [mkName('amount'), mkInt(100)]),
            [mkReturn(mkCall('*', [mkName('amount'), mkDouble(0.9)]))],
            null,
          ),
          mkReturn(mkName('amount')),
        ]),
      ]);
      const result = evaluate(mod, 'f', { amount: 200 });
      assert.ok(result.success);
      assert.equal(result.value, 180);
    });

    it('If-then 分支（false → 默认 Return）', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('amount')], [
          mkIf(
            mkCall('>', [mkName('amount'), mkInt(100)]),
            [mkReturn(mkCall('*', [mkName('amount'), mkDouble(0.9)]))],
            null,
          ),
          mkReturn(mkName('amount')),
        ]),
      ]);
      const result = evaluate(mod, 'f', { amount: 50 });
      assert.ok(result.success);
      assert.equal(result.value, 50);
    });

    it('If-else 分支', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('x')], [
          mkIf(
            mkCall('>', [mkName('x'), mkInt(0)]),
            [mkReturn(mkStr('positive'))],
            [mkReturn(mkStr('non-positive'))],
          ),
        ]),
      ]);
      assert.equal(evaluate(mod, 'f', { x: 5 }).value, 'positive');
      assert.equal(evaluate(mod, 'f', { x: -1 }).value, 'non-positive');
    });
  });

  describe('Let 绑定', () => {
    it('绑定中间变量并使用', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('a'), mkParam('b')], [
          mkLet('sum', mkCall('+', [mkName('a'), mkName('b')])),
          mkReturn(mkCall('*', [mkName('sum'), mkInt(2)])),
        ]),
      ]);
      const result = evaluate(mod, 'f', { a: 3, b: 4 });
      assert.ok(result.success);
      assert.equal(result.value, 14);
    });
  });

  describe('字段访问（dot notation）', () => {
    it('访问 struct 字段', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('applicant')], [
          mkReturn(mkName('applicant.creditScore')),
        ]),
      ]);
      const result = evaluate(mod, 'f', {
        applicant: { creditScore: 750, income: 50000, age: 30 },
      });
      assert.ok(result.success);
      assert.equal(result.value, 750);
    });

    it('struct 字段用于比较', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('applicant')], [
          mkIf(
            mkCall('<', [mkName('applicant.creditScore'), mkInt(600)]),
            [mkReturn(mkBool(false))],
            null,
          ),
          mkReturn(mkBool(true)),
        ]),
      ]);
      assert.equal(
        evaluate(mod, 'f', { applicant: { creditScore: 500 } }).value,
        false,
      );
      assert.equal(
        evaluate(mod, 'f', { applicant: { creditScore: 700 } }).value,
        true,
      );
    });
  });

  describe('Construct 表达式', () => {
    it('构造 struct 并返回', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('value')], [
          mkReturn(mkConstruct('Quote', [
            { name: 'premium', expr: mkCall('*', [mkName('value'), mkDouble(0.05)]) },
            { name: 'deductible', expr: mkInt(1000) },
          ])),
        ]),
      ]);
      const result = evaluate(mod, 'f', { value: 20000 });
      assert.ok(result.success);
      const obj = result.value as any;
      assert.equal(obj.__type, 'Quote');
      assert.equal(obj.premium, 1000);
      assert.equal(obj.deductible, 1000);
    });
  });

  describe('函数调用（递归）', () => {
    it('调用模块内另一个函数', () => {
      const mod = mkModule([
        mkFunc('helper', [mkParam('x')], [
          mkReturn(mkCall('*', [mkName('x'), mkInt(2)])),
        ]),
        mkFunc('main', [mkParam('a')], [
          mkReturn(mkCall('helper', [mkName('a')])),
        ]),
      ]);
      const result = evaluate(mod, 'main', { a: 21 });
      assert.ok(result.success);
      assert.equal(result.value, 42);
    });
  });

  describe('错误处理', () => {
    it('函数不存在', () => {
      const mod = mkModule([mkFunc('f', [], [mkReturn(mkInt(1))])]);
      const result = evaluate(mod, 'nonexistent', {});
      assert.ok(!result.success);
      assert.ok(result.error?.includes('not found'));
    });

    it('缺少参数', () => {
      const mod = mkModule([mkFunc('f', [mkParam('x')], [mkReturn(mkName('x'))])]);
      const result = evaluate(mod, 'f', {});
      assert.ok(!result.success);
      assert.ok(result.error?.includes("Missing required parameter 'x'"));
    });

    it('未定义变量', () => {
      const mod = mkModule([mkFunc('f', [], [mkReturn(mkName('unknown'))])]);
      const result = evaluate(mod, 'f', {});
      assert.ok(!result.success);
      assert.ok(result.error?.includes("Undefined variable 'unknown'"));
    });

    it('类型不匹配', () => {
      const mod = mkModule([
        mkFunc('f', [mkParam('a')], [
          mkReturn(mkCall('+', [mkName('a'), mkInt(1)])),
        ]),
      ]);
      const result = evaluate(mod, 'f', { a: true });
      assert.ok(!result.success);
      assert.ok(result.error?.includes('Type mismatch'));
    });

    it('返回执行耗时', () => {
      const mod = mkModule([mkFunc('f', [], [mkReturn(mkInt(1))])]);
      const result = evaluate(mod, 'f', {});
      assert.ok(result.success);
      assert.ok(typeof result.executionTimeMs === 'number');
      assert.ok(result.executionTimeMs >= 0);
    });
  });

  describe('端到端：Eligibility Check 场景', () => {
    // 模拟编译后的 Core IR：
    //   Rule checkEligibility given applicant as Applicant, produce Bool:
    //     If applicant.creditScore < 600 Return false.
    //     If applicant.income < 30000 Return false.
    //     If applicant.age < 18 Return false.
    //     Return true.
    it('合格申请人通过', () => {
      const mod = mkModule([
        mkFunc('checkEligibility', [mkParam('applicant')], [
          mkIf(mkCall('<', [mkName('applicant.creditScore'), mkInt(600)]),
            [mkReturn(mkBool(false))], null),
          mkIf(mkCall('<', [mkName('applicant.income'), mkInt(30000)]),
            [mkReturn(mkBool(false))], null),
          mkIf(mkCall('<', [mkName('applicant.age'), mkInt(18)]),
            [mkReturn(mkBool(false))], null),
          mkReturn(mkBool(true)),
        ]),
      ]);

      const goodApplicant = {
        applicant: { creditScore: 750, income: 50000, age: 30 },
      };
      const result = evaluate(mod, 'checkEligibility', goodApplicant);
      assert.ok(result.success);
      assert.equal(result.value, true);
    });

    it('低信用分被拒绝', () => {
      const mod = mkModule([
        mkFunc('checkEligibility', [mkParam('applicant')], [
          mkIf(mkCall('<', [mkName('applicant.creditScore'), mkInt(600)]),
            [mkReturn(mkBool(false))], null),
          mkIf(mkCall('<', [mkName('applicant.income'), mkInt(30000)]),
            [mkReturn(mkBool(false))], null),
          mkIf(mkCall('<', [mkName('applicant.age'), mkInt(18)]),
            [mkReturn(mkBool(false))], null),
          mkReturn(mkBool(true)),
        ]),
      ]);

      const badApplicant = {
        applicant: { creditScore: 400, income: 50000, age: 30 },
      };
      const result = evaluate(mod, 'checkEligibility', badApplicant);
      assert.ok(result.success);
      assert.equal(result.value, false);
    });
  });

  describe('端到端：Pricing + Construct 场景', () => {
    // 模拟：
    //   Rule calculateQuote given vehicle, produce Quote:
    //     If vehicle.year < 2015
    //       Return Quote with premium = vehicle.value * 5 / 100, deductible = 1000.
    //     Return Quote with premium = vehicle.value * 3 / 100, deductible = 500.
    it('旧车辆返回高保费', () => {
      const mod = mkModule([
        mkFunc('calculateQuote', [mkParam('vehicle')], [
          mkIf(mkCall('<', [mkName('vehicle.year'), mkInt(2015)]), [
            mkReturn(mkConstruct('Quote', [
              { name: 'premium', expr: mkCall('/', [
                mkCall('*', [mkName('vehicle.value'), mkInt(5)]),
                mkInt(100),
              ]) },
              { name: 'deductible', expr: mkInt(1000) },
            ])),
          ], null),
          mkReturn(mkConstruct('Quote', [
            { name: 'premium', expr: mkCall('/', [
              mkCall('*', [mkName('vehicle.value'), mkInt(3)]),
              mkInt(100),
            ]) },
            { name: 'deductible', expr: mkInt(500) },
          ])),
        ]),
      ]);

      const result = evaluate(mod, 'calculateQuote', {
        vehicle: { make: 'Toyota', year: 2010, value: 20000 },
      });
      assert.ok(result.success);
      const quote = result.value as any;
      assert.equal(quote.premium, 1000);
      assert.equal(quote.deductible, 1000);
    });

    it('新车辆返回低保费', () => {
      const mod = mkModule([
        mkFunc('calculateQuote', [mkParam('vehicle')], [
          mkIf(mkCall('<', [mkName('vehicle.year'), mkInt(2015)]), [
            mkReturn(mkConstruct('Quote', [
              { name: 'premium', expr: mkCall('/', [
                mkCall('*', [mkName('vehicle.value'), mkInt(5)]),
                mkInt(100),
              ]) },
              { name: 'deductible', expr: mkInt(1000) },
            ])),
          ], null),
          mkReturn(mkConstruct('Quote', [
            { name: 'premium', expr: mkCall('/', [
              mkCall('*', [mkName('vehicle.value'), mkInt(3)]),
              mkInt(100),
            ]) },
            { name: 'deductible', expr: mkInt(500) },
          ])),
        ]),
      ]);

      const result = evaluate(mod, 'calculateQuote', {
        vehicle: { make: 'Tesla', year: 2023, value: 40000 },
      });
      assert.ok(result.success);
      const quote = result.value as any;
      assert.equal(quote.premium, 1200);
      assert.equal(quote.deductible, 500);
    });
  });

  describe('Ok/Err/Some/None 包装', () => {
    it('Ok 包装', () => {
      const mod = mkModule([
        mkFunc('f', [], [mkReturn({ kind: 'Ok', expr: mkInt(42) })]),
      ]);
      const result = evaluate(mod, 'f', {});
      assert.ok(result.success);
      assert.deepEqual(result.value, { __type: 'Ok', value: 42 });
    });

    it('None 返回 null', () => {
      const mod = mkModule([
        mkFunc('f', [], [mkReturn({ kind: 'None' })]),
      ]);
      const result = evaluate(mod, 'f', {});
      assert.ok(result.success);
      assert.equal(result.value, null);
    });
  });
});
