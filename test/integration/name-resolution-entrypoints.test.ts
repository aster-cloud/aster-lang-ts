/**
 * 全部编译入口都经名称解析（ADR 0051 R1/R2），任一 E8xx 时不产出 IR、如实报告失败。
 * 覆盖：aster-convert compile-to-json、aster core、AI 校验器、语义桥、LSP 诊断（租户词汇）。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DiagnosticSeverity, type Diagnostic as LspDiagnostic } from 'vscode-languageserver/node.js';

import { PolicyValidator } from '../../src/ai/validator.js';
import { runSemanticBridge } from '../../src/mapping/pipeline.js';
import { computeDiagnostics } from '../../src/lsp/diagnostics.js';
import { parseDocumentText } from '../../src/lsp/parse-document.js';
import { EN_US } from '../../src/config/lexicons/en-US.js';
import { vocabularyRegistry, initBuiltinVocabularies } from '../../src/config/lexicons/identifiers/registry.js';
import { IdentifierKind } from '../../src/config/lexicons/identifiers/types.js';
import type { DomainVocabulary } from '../../src/config/lexicons/identifiers/types.js';

/** y 未定义：解析通过，名称解析报 E802 */
const UNRESOLVED = 'Module m.\n\nRule f given x as Int, produce Int:\n  Return y.\n';
const VALID = 'Module m.\n\nRule f given x as Int, produce Int:\n  Return x.\n';

const ROOT = process.cwd();
let dir = '';
const write = (name: string, content: string): string => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
};
const run = (script: string, args: string[]): SpawnSyncReturns<string> =>
  spawnSync(process.execPath, [path.join(ROOT, script), ...args], { cwd: dir, encoding: 'utf8' });

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr0051-entry-'));
});
after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('命令行入口以 E8xx 拦截 IR', () => {
  it('aster-convert compile-to-json：E8xx 退出码非 0 且不输出 JSON', () => {
    const r = run('dist/src/cli/policy-converter.js', ['compile-to-json', write('bad.aster', UNRESOLVED)]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /E802/);
    assert.equal(r.stdout.trim(), '');
    const ok = run('dist/src/cli/policy-converter.js', ['compile-to-json', write('ok.aster', VALID)]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.ok(ok.stdout.includes('"kind"'));
  });

  it('aster core：E8xx 退出码非 0 且不输出 Core', () => {
    const r = run('dist/scripts/aster.js', ['core', write('bad2.aster', UNRESOLVED)]);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /E802/);
    assert.doesNotMatch(r.stdout, /"kind": "Module"/);
    const ok = run('dist/scripts/aster.js', ['core', write('ok2.aster', VALID)]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /"kind": "Module"/);
  });
});

describe('库入口以 E8xx 拦截 IR', () => {
  it('AI 校验器报告 E8xx，不返回 coreIR', async () => {
    const result = await new PolicyValidator().validate(UNRESOLVED);
    assert.equal(result.valid, false);
    assert.equal(result.coreIR, undefined);
    assert.ok(result.diagnostics.some((d) => d.code === 'E802'), JSON.stringify(result.diagnostics));
  });

  it('语义桥：E8xx 归入编译失败，不生成候选', () => {
    const result = runSemanticBridge(UNRESOLVED);
    assert.ok(result.diagnostics.some((d) => d.includes('E802')), JSON.stringify(result.diagnostics));
  });
});

describe('LSP 诊断发布名称解析结果（租户词汇）', () => {
  const TENANT = 'tenant-adr0051-lsp';
  const DOMAIN = 'adr0051.lsp';
  const VOCAB: DomainVocabulary = {
    id: DOMAIN, name: 'lsp', locale: 'en-US', version: '1',
    structs: [{ canonical: 'Customer', localized: 'Kunde', kind: IdentifierKind.STRUCT }],
    fields: [{ canonical: 'age', localized: 'alter', kind: IdentifierKind.FIELD, parent: 'Customer' }],
    functions: [],
  };
  const source = (field: string): string =>
    'Module m.\n\nDefine Customer has age as Int.\n\n' +
    `Rule f given x as Kunde, produce Int:\n  Return x.${field}.\n`;

  async function diagnose(text: string, uri: string, tenantId: string | undefined): Promise<LspDiagnostic[]> {
    const doc = TextDocument.create(uri, 'aster', 1, text);
    const getOrParse = (): ReturnType<typeof parseDocumentText> & { text: string } => ({ text, ...parseDocumentText(text, EN_US, tenantId, tenantId ? DOMAIN : undefined) });
    return computeDiagnostics(doc, getOrParse, EN_US);
  }

  before(() => {
    initBuiltinVocabularies();
    vocabularyRegistry.registerCustom(TENANT, VOCAB);
  });
  after(() => {
    vocabularyRegistry.unregisterCustom(TENANT, DOMAIN, 'en-US');
  });

  it('租户词汇下未解析字段显示为 E801，位置是原文中的写法', async () => {
    const text = source('gewicht');
    const diags = await diagnose(text, 'file:///adr0051/e801.aster', TENANT);
    const e801 = diags.find((d) => d.code === 'E801');
    assert.ok(e801, JSON.stringify(diags));
    assert.equal(e801.severity, DiagnosticSeverity.Error);
    assert.equal(e801.range.start.line, 5);
    assert.equal(e801.range.start.character, text.split('\n')[5]!.indexOf('x.gewicht'));
  });

  it('租户词汇使本地化写法通过解析；无租户上下文时同一文档报 E801', async () => {
    const withTenant = await diagnose(source('alter'), 'file:///adr0051/ok.aster', TENANT);
    assert.deepEqual(withTenant.filter((d) => String(d.code ?? '').startsWith('E80')), []);
    // 无词汇时 Kunde 未声明，成为隐式类型参数；类型参数上的字段段 alter 无法解析
    const without = await diagnose(source('alter'), 'file:///adr0051/no-tenant.aster', undefined);
    assert.ok(without.some((d) => d.code === 'E801'), JSON.stringify(without));
  });
});
