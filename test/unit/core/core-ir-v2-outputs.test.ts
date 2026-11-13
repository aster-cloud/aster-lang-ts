/**
 * Core IR v2 的读写出口与消费方（ADR 0055 §5；实施计划 Task T3）：
 * compile().coreJson、CLI 写出的 IR 文件、解释器与治理检查读 v2 IR。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compile, compileAndTypecheck } from '../../../src/browser.js';
import { prepareTruffleCoreJson } from '../../../src/cli/utils/core-ir-file.js';
import { Core as CoreIR } from '../../../src/core/core_ir.js';
import { evaluate } from '../../../src/core/interpreter.js';
import { CoreIrFormatError, readCoreIr } from '../../../src/core/read-core-ir.js';
import { serializeCoreIr } from '../../../src/core/serialize-core-ir.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { ErrorCode } from '../../../src/diagnostics/error_codes.js';
import { checkGovernance, controls, ruleId } from '../../../src/typecheck/governance.js';
import type { Core } from '../../../src/types.js';

const COLOR = 'Module m.\n\nDefine Color as one of Red, Green.\n\n'
  + 'Rule f given c as Color, produce Int:\n  Match c:\n    When Red, Return 1.\n    When Green, Return 2.\n';

function core(source: string): Core.Module {
  const r = compile(source, {});
  assert.equal(r.success, true, JSON.stringify(r.parseErrors ?? r.resolutionDiagnostics));
  return r.core!;
}

describe('compile().coreJson', () => {
  it('compile returns coreJson equal to serializeCoreIr(core)', () => {
    const r = compile(COLOR, {});
    assert.equal(r.success, true);
    assert.equal(r.coreJson, serializeCoreIr(r.core!));
    assert.deepEqual(readCoreIr(r.coreJson!), r.core);
    const t = compileAndTypecheck(COLOR, {});
    assert.equal(t.coreJson, serializeCoreIr(t.core!));
  });

  it('编译失败时不产出 coreJson', () => {
    const r = compile('Module m.\n\nRule f given x as Int, produce Int:\n  Return y.\n', {});
    assert.equal(r.success, false);
    assert.equal(r.coreJson, undefined);
  });
});

describe('解释器读 v2 IR', () => {
  it('interpreter evaluates v2 PatCtor zero-arg variant', () => {
    const m = core(COLOR);
    assert.equal(evaluate(m, 'f', { c: 'Green' }).value, 2);
    // 读回的 JSON IR（无任何旁路表）同样可求值
    const fromJson = readCoreIr(serializeCoreIr(m));
    assert.equal(evaluate(fromJson, 'f', { c: 'Red' }).value, 1);
  });

  it('中文枚举成员（无大小写）经 0 参 PatCtor 正确匹配', () => {
    const src = '模块 探针.样例。\n\n定义 状态 为以下之一 待处理、进行中。\n\n'
      + '规则 描述 给定 s 作为 状态，产出 整数：\n  匹配于 s：\n    当 待处理，返回 1。\n    当 进行中，返回 2。\n';
    const r = compile(src, { lexicon: ZH_CN });
    assert.equal(r.success, true);
    assert.equal(evaluate(readCoreIr(r.coreJson!), '描述', { s: '进行中' }).value, 2);
  });

  it('PatName 只绑定：手写 IR 中的大写 PatName 也是绑定，不再当作变体', () => {
    const body = CoreIR.Block([CoreIR.Match(CoreIR.Name('c'), [
      CoreIR.Case(CoreIR.PatName('Red'), CoreIR.Return(CoreIR.Int(1))),
    ])]);
    const fn = CoreIR.Func('f', [], [CoreIR.Param('c', CoreIR.TypeName('Text'))], CoreIR.TypeName('Int'), [], body);
    const m = CoreIR.Module('m', [fn]);
    assert.equal(evaluate(m, 'f', { c: 'anything' }).value, 1);
  });

  it('Double 字面量的规范十进制串在运行时解析为浮点数', () => {
    assert.equal(evaluate(core('Module m.\n\nRule f, produce Double:\n  Return 0.25.\n'), 'f', {}).value, 0.25);
  });
});

describe('治理检查读 v2 注解', () => {
  it('governance reads $0 from args', () => {
    const m = core('Module m.\n\n@id("R1")\n@control("EU_AI_ACT:ART14")\nRule decide given x as Int, produce Verdict:\n  Return Verdict.allow().\n');
    const f = m.decls.find((d): d is Core.Func => d.kind === 'Func')!;
    assert.deepEqual(f.annotations.map((a) => a.args), [[{ name: '$0', value: 'R1' }], [{ name: '$0', value: 'EU_AI_ACT:ART14' }]]);
    assert.equal(ruleId(f), 'R1');
    assert.deepEqual(controls(f), ['EU_AI_ACT:ART14']);
    const codes = checkGovernance(m).map((d) => d.code);
    assert.equal(codes.includes(ErrorCode.GOV_VERDICT_RULE_MISSING_ID), false);
  });

  it('$0 不是字符串时报 E702', () => {
    const m = core('Module m.\n\n@id(42)\nRule decide given x as Int, produce Verdict:\n  Return Verdict.allow().\n');
    assert.ok(checkGovernance(m).some((d) => d.code === ErrorCode.GOV_ANNOTATION_ARG_INVALID));
  });
});

describe('与 Java 解析面的对照（T3 审查复核）', () => {
  it('重复的效应名在 IR 中按首次出现去重（与 Java LinkedHashSet 一致），输出能被严格读回', () => {
    const r = compile('Module m.\n\nRule f given x as Int, produce Int. It performs io and io and cpu:\n  Return x.\n', {});
    assert.equal(r.success, true);
    assert.deepEqual((r.core!.decls[0] as Core.Func).effects, ['io', 'cpu']);
    readCoreIr(r.coreJson!);
  });

  it('注解参数名与值可以是软关键词（与 Java structKeywordName 一致）', () => {
    const m = core('Module m.\n\n@x(return: "a", to)\nRule f given x as Int, produce Int:\n  Return x.\n');
    const f = m.decls[0] as Core.Func;
    assert.deepEqual(f.annotations[0]!.args, [{ name: 'return', value: 'a' }, { name: '$0', value: 'to' }]);
  });
});

describe('CLI 的 IR 文件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-core-ir-v2-'));

  it('cli truffle writes canonical v2', () => {
    const input = path.join(dir, 'color.aster');
    fs.writeFileSync(input, COLOR);
    const out = prepareTruffleCoreJson(input, path.join(dir, 'build'));
    const bytes = fs.readFileSync(out, 'utf8');
    assert.equal(bytes, compile(COLOR, {}).coreJson);
    assert.equal(serializeCoreIr(readCoreIr(bytes)), bytes);
  });

  it('truffle 的 .json 输入先严格读入：v1 形状（无 schemaVersion）被拒收', () => {
    const v1 = path.join(dir, 'old.json');
    fs.writeFileSync(v1, JSON.stringify({ kind: 'Module', name: 'm', decls: [] }));
    assert.throws(() => prepareTruffleCoreJson(v1), (e: unknown) => e instanceof CoreIrFormatError && e.code === 'unsupported_schema_version');
    const ok = path.join(dir, 'ok.json');
    fs.writeFileSync(ok, compile(COLOR, {}).coreJson!);
    assert.equal(prepareTruffleCoreJson(ok), ok);
  });

  it('aster-convert compile-to-json 输出规范字节，json-to-cnl 拒收 v1 IR', () => {
    const input = path.join(dir, 'conv.aster');
    fs.writeFileSync(input, COLOR);
    const cli = path.join(process.cwd(), 'dist', 'src', 'cli', 'policy-converter.js');
    const compiled = spawnSync(process.execPath, [cli, 'compile-to-json', input], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr);
    assert.equal(compiled.stdout.trim(), compile(COLOR, {}).coreJson);
    const v1 = path.join(dir, 'conv-old.json');
    fs.writeFileSync(v1, JSON.stringify({ version: '1.0', module: { kind: 'Module', name: 'm', decls: [] } }));
    const back = spawnSync(process.execPath, [cli, 'json-to-cnl', v1], { encoding: 'utf8' });
    assert.notEqual(back.status, 0);
    assert.match(back.stderr, /schemaVersion/);
  });
});
