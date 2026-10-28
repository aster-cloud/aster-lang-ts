/**
 * 语法不完整时诊断的降级（ADR 0051 Review Focus 1）：只对解析器恢复出的部分运行 R1，跳过 R2，
 * 不从未完成代码级联出 E8xx / W8xx；语法完整时 R2 照常报告。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeDiagnostics } from '../../../src/lsp/diagnostics.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DECLS, docOf, getOrParseWith } from './resolution-fixture.js';

async function codesOf(lines: readonly string[]): Promise<string[]> {
  const doc = docOf(lines);
  const diags = await computeDiagnostics(doc.document, getOrParseWith(ZH_CN) as never, ZH_CN);
  return diags.map((d) => String(d.code ?? ''));
}

const isResolution = (code: string) => /^[EW]8\d\d$/.test(code);

const GOOD = ['规则 检查 给定 x 作为 司机，产出 整数：', '  返回 x.alter。', ''];

describe('诊断：语法不完整时降级', () => {
  it('★各种半行输入都不产生 E8xx / W8xx', async () => {
    const tails = [
      '  返回 x.',
      '  返回 x.al',
      '  返回 x.alter',
      '  令 y 定义为 司机 包含 alter 将 设为',
      '  令 y 定义为 司机 包含 al',
      '  返回 Ho',
      '  返回 检',
      '规则 坏 给定 h 作为 车',
      '定义 车主 包含 jah',
      '  如果 x.alter',
    ];
    for (const tail of tails) {
      const codes = await codesOf([...DECLS, ...GOOD, '规则 坏 给定 x 作为 司机，产出 整数：', tail, '']);
      assert.ok(codes.some((c) => !isResolution(c)), `夹具应含语法错误：${tail}`);
      assert.deepEqual(codes.filter(isResolution), [], `半行 "${tail}" 级联出了名称解析诊断`);
    }
  });

  it('★语法不完整时，完整部分的本地化路径不被误报（R2 跳过，也不拿未解析的 Core 做类型检查）', async () => {
    const codes = await codesOf([...DECLS, ...GOOD, '规则 坏 给定 h 作为 车主，产出 整数：', '  返回 h.fahrer.al', '']);
    assert.deepEqual(codes.filter((c) => /^E8|^W8|^E0/.test(c) && c !== ''), [], `实际：${codes}`);
  });

  it('★正在编辑的声明被解析器丢弃时，引用它的完整部分不报 E800 / E802', async () => {
    const codes = await codesOf([
      '模块 m。',
      '',
      '定义 Kunde 包含 nam',
      '',
      '规则 g 给定 k 作为 Kunde，产出 Kunde：',
      '  返回 k。',
      '',
      '规则 hilfe 产出 整数：',
      '  返回 1 加',
      '',
      '规则 h 产出 整数：',
      '  令 f 定义为 hilfe。',
      '  返回 1。',
      '',
    ]);
    assert.ok(codes.some((c) => !isResolution(c)), '夹具应含语法错误');
    assert.deepEqual(codes.filter(isResolution), [], `被丢弃的声明级联出了名称解析诊断：${codes}`);
  });

  it('语法完整时 R2 照常报告：未知字段 E801', async () => {
    const codes = await codesOf([...DECLS, '规则 检查 给定 x 作为 司机，产出 整数：', '  返回 x.unbekannt。', '']);
    assert.ok(codes.includes('E801'), `实际：${codes}`);
  });

  it('语法完整且全部可解析时无名称解析诊断', async () => {
    assert.deepEqual((await codesOf([...DECLS, ...GOOD])).filter(isResolution), []);
  });
});
