/**
 * 按位置角色的悬停（ADR 0051 §5「LSP」与 Review Focus 1）。
 *
 * 悬停在本地化写法上显示 `写法 → 规范名（角色 · 父名）`，角色与父名来自 R1 的 resolved 与
 * R2 的解析结果；写法等于规范名时不追加任何内容。语法不完整时只用 R1 结果，R2 跳过，不抛异常。
 * 走真实的 registerHoverHandler 接线（stub connection 捕获回调）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerHoverHandler } from '../../../src/lsp/navigation/hover.js';
import { resolveDocument } from '../../../src/lsp/resolution.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DE_DE } from '../../../src/config/lexicons/de-DE.js';
import type { Lexicon } from '../../../src/config/lexicons/types.js';
import { DECLS, docOf, documentsOf, getOrParseWith, posOf } from './resolution-fixture.js';
import type { Doc } from './resolution-fixture.js';

type HoverFn = (params: unknown) => Promise<{ contents: { value: string } } | null>;

function hoverAt(doc: Doc, pos: { line: number; character: number }, lexicon: Lexicon = ZH_CN) {
  let handler: HoverFn | undefined;
  const connection = { onHover: (fn: HoverFn) => { handler = fn; } };
  registerHoverHandler(connection as never, documentsOf(doc), getOrParseWith(lexicon) as never, () => lexicon);
  assert.ok(handler, 'onHover 未注册');
  return handler!({ textDocument: { uri: doc.uri }, position: pos }).then((h) => h?.contents.value ?? null);
}

const PROGRAM = docOf([
  ...DECLS,
  '规则 检查 给定 x 作为 司机，产出 整数：',
  '  返回 x.alter。',
  '',
  '规则 级别 给定 x 作为 司机，产出 等级：',
  '  返回 Hoch。',
  '',
  '规则 g 给定 h 作为 车主，产出 整数：',
  '  返回 h.fahrer.alter。',
  '',
]);

describe('按角色悬停', () => {
  it('★字段声明 alter：alter → age（字段 · Driver）', async () => {
    const text = await hoverAt(PROGRAM, posOf(PROGRAM, 2, 'alter', 1));
    assert.ok(text?.includes('alter → age（字段 · Driver）'), `实际：${text}`);
  });

  it('★点分路径 x.alter 的字段段（R2）：alter → age（字段 · Driver）', async () => {
    const text = await hoverAt(PROGRAM, posOf(PROGRAM, 9, 'alter', 2));
    assert.ok(text?.includes('alter → age（字段 · Driver）'), `实际：${text}`);
  });

  it('★多段路径 h.fahrer.alter：各段按前一段的类型取父名', async () => {
    const fahrer = await hoverAt(PROGRAM, posOf(PROGRAM, 15, 'fahrer', 1));
    const alter = await hoverAt(PROGRAM, posOf(PROGRAM, 15, 'alter', 1));
    assert.ok(fahrer?.includes('fahrer → driver（字段 · Owner）'), `实际：${fahrer}`);
    assert.ok(alter?.includes('alter → age（字段 · Driver）'), `实际：${alter}`);
  });

  it('★枚举成员：声明与期望枚举下的裸名都显示 Hoch → High（枚举成员 · Level）', async () => {
    const decl = await hoverAt(PROGRAM, posOf(PROGRAM, 6, 'Hoch', 1));
    const ref = await hoverAt(PROGRAM, posOf(PROGRAM, 12, 'Hoch', 1));
    assert.ok(decl?.includes('Hoch → High（枚举成员 · Level）'), `实际：${decl}`);
    assert.ok(ref?.includes('Hoch → High（枚举成员 · Level）'), `实际：${ref}`);
  });

  it('类型与函数：司机 → Driver（类型）、检查 → check（函数）', async () => {
    const type = await hoverAt(PROGRAM, posOf(PROGRAM, 8, '司机', 1));
    const func = await hoverAt(PROGRAM, posOf(PROGRAM, 8, '检查', 1));
    assert.ok(type?.includes('司机 → Driver（类型）'), `实际：${type}`);
    assert.ok(func?.includes('检查 → check（函数）'), `实际：${func}`);
  });

  it('★写法等于规范名时不追加解析行，原有悬停保持不变', async () => {
    const param = await hoverAt(PROGRAM, posOf(PROGRAM, 8, 'x', 0));
    const name = await hoverAt(PROGRAM, posOf(PROGRAM, 2, 'name', 1));
    assert.ok(param && !param.includes('→'), `实际：${param}`);
    assert.ok(param.startsWith('参数'), `原有参数悬停丢失：${param}`);
    assert.ok(name && !name.includes('→'), `实际：${name}`);
  });

  it('文案随文档 lexicon 本地化：英文界面为 alter → age (field · Driver)', async () => {
    const doc = docOf(['Modul m.', '', 'Definiere Driver hat alter als Ganzzahl.', '']);
    const text = await hoverAt(doc, posOf(doc, 2, 'alter', 1), DE_DE);
    assert.ok(text?.includes('alter → age (field · Driver)'), `实际：${text}`);
  });
});

describe('语法不完整时的降级（Review Focus 1）', () => {
  const BROKEN = docOf([
    ...DECLS,
    '规则 检查 给定 x 作为 司机，产出 整数：',
    '  返回 x.alter。',
    '',
    '规则 坏 给定 h 作为 车主，产出 整数：',
    '  返回 h.fahrer.al',
    '',
  ]);

  it('★R2 跳过，仍保留 R1 可得的解析位置', () => {
    const parsed = getOrParseWith(ZH_CN)(BROKEN.document);
    assert.ok(parsed.parseDiagnostics.some((d) => d.severity === 'error'), '夹具应含语法错误');
    const res = resolveDocument(parsed);
    assert.equal(res.complete, false);
    assert.equal(res.core, undefined, '语法不完整时不应运行 lower/R2');
    assert.ok(res.sites.some((s) => s.role === 'FIELD_DECL' && s.canonical === 'age'), 'R1 的字段声明位置应保留');
  });

  it('★R1 位置照常悬停；R2 位置不悬停解析行；均不抛异常', async () => {
    const decl = await hoverAt(BROKEN, posOf(BROKEN, 2, 'alter', 1));
    assert.ok(decl?.includes('alter → age（字段 · Driver）'), `实际：${decl}`);
    const path = await hoverAt(BROKEN, posOf(BROKEN, 9, 'alter', 2));
    assert.ok(!path?.includes('→'), `R2 已跳过，不应有字段段解析行：${path}`);
    await hoverAt(BROKEN, posOf(BROKEN, 12, 'al', 1));
  });

  it('半行输入的各种形态都不抛异常', async () => {
    const tails = ['  返回 h.', '  令 y 定义为 司机 包含 alter 将 设为', '规则 坏 给定 h 作为 车', '  返回 Ho', '定义 车主 包含 jah'];
    for (const tail of tails) {
      const doc = docOf([...DECLS, '规则 坏 给定 h 作为 车主，产出 整数：', tail, '']);
      await hoverAt(doc, { line: DECLS.length + 1, character: tail.length - 1 });
    }
  });
});
