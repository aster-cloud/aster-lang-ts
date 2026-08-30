import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  vocabularyRegistry,
  initBuiltinVocabularies,
} from '../../../src/config/lexicons/identifiers/registry.js';
import { canonicalize } from '../../../src/frontend/canonicalizer.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import type { DomainVocabulary } from '../../../src/config/lexicons/identifiers/types.js';
import { buildCanonicalizeOptions } from '../../../src/lsp/canonicalize-options.js';

/**
 * 租户领域词汇必须参与 LSP 的解析（issue #161）。
 *
 * ★缺口有**两半**，缺任一半都等于没做：
 *   1. LSP 进程不知道自己在为哪个租户服务 —— 网关的 upgrade 只校验
 *      Origin + 共享 token，不传租户身份。已改为由客户端在 `initialize` 的
 *      `initializationOptions` 里推送 `{ tenantId, domainVocabularies }`。
 *   2. **即便注册了也白搭**：canonicalizer 靠
 *      `getWithCustom(tenantId, domain, locale)` 查自定义词汇，
 *      而 LSP 此前调用的是 `canonicalize(text, lexicon)` —— 只传 lexicon，
 *      那条分支（要求 `opts.domain && opts.locale` 同时存在）根本走不到。
 *
 * 本测试锁住第 2 半（真正决定"能不能用"的那一半）：验证同一段源码在
 * **传/不传租户上下文**时的行为差异。第 1 半（initializationOptions 接线）
 * 由 server.ts 承担，其正确性体现为本测试所依赖的注册确实生效。
 */

const TENANT = 'tenant-vocab-test';
const DOMAIN = 'insurance.vocabtest';

/** 与生产同形的最小领域词汇：把 `保额` 映射到 `coverageAmount`。 */
const VOCAB = {
  id: DOMAIN,
  name: '词汇测试',
  locale: 'zh-CN',
  version: '1.0.0',
  structs: [],
  fields: [],
  functions: [{ canonical: 'coverageAmount', localized: '保额', kind: 'function' }],
} as unknown as DomainVocabulary;

const SRC = '模块 probe。\n\n规则 main 产出 Int：\n  返回 保额()。\n';

describe('租户领域词汇参与解析', () => {
  it('★传租户上下文时，本地化词被规范化', () => {
    initBuiltinVocabularies();
    vocabularyRegistry.registerCustom(TENANT, VOCAB);

    const out = canonicalize(SRC, {
      lexicon: ZH_CN,
      tenantId: TENANT,
      domain: DOMAIN,
      locale: 'zh-CN',
    });

    assert.ok(
      out.includes('coverageAmount'),
      `「保额」应被规范化为 coverageAmount，实际输出：${out.slice(0, 120)}`,
    );
  });

  it('★不传租户上下文时保持原样（反向护栏）', () => {
    initBuiltinVocabularies();
    vocabularyRegistry.registerCustom(TENANT, VOCAB);

    // 没有这一条，把实现写成「无条件查所有租户词汇」也能让上面变绿——
    // 而那会造成**跨租户词汇泄露**：A 租户的术语在 B 租户的文档里生效。
    const out = canonicalize(SRC, ZH_CN);

    assert.ok(
      !out.includes('coverageAmount'),
      `未传租户时不得应用其词汇（跨租户泄露），实际输出：${out.slice(0, 120)}`,
    );
  });

  it('★另一个租户拿不到本租户的词汇（隔离性）', () => {
    initBuiltinVocabularies();
    vocabularyRegistry.registerCustom(TENANT, VOCAB);

    const out = canonicalize(SRC, {
      lexicon: ZH_CN,
      tenantId: 'some-other-tenant',
      domain: DOMAIN,
      locale: 'zh-CN',
    });

    assert.ok(
      !out.includes('coverageAmount'),
      `租户隔离被打破：other-tenant 用到了 ${TENANT} 的词汇`,
    );
  });

  it('无效词汇表被拒绝（registerCustom 有校验，不静默接受）', () => {
    initBuiltinVocabularies();
    // 缺 functions/structs/fields 的畸形词汇——registerCustom 应抛错而非静默存下，
    // 否则损坏的词汇会在解析期以更难定位的方式炸。
    assert.throws(
      () => vocabularyRegistry.registerCustom(TENANT, { id: 'bad', name: 'x' } as unknown as DomainVocabulary),
      /.+/,
    );
  });

  /* ── LSP 侧接线：证明"真的传了"，而不只是"canonicalizer 会用" ────────────
   *
   * ★上面四条只锁 canonicalizer 契约。实测把 LSP 里的租户参数删掉
   * （回到缺陷版）后，那四条**仍然全绿** —— 契约对了不等于调用方传了。
   * 故必须对 LSP 实际构造的参数单独断言。
   */
  it('★有完整租户上下文时，LSP 传的是带 tenantId/domain 的 options', () => {
    const opts = buildCanonicalizeOptions(ZH_CN, TENANT, DOMAIN);
    assert.ok(opts && typeof opts === 'object' && 'tenantId' in opts,
      'LSP 应传 options 对象而非裸 lexicon，否则自定义词汇分支走不到');
    assert.equal((opts as { tenantId: string }).tenantId, TENANT);
    assert.equal((opts as { domain: string }).domain, DOMAIN);
    assert.equal((opts as { locale: string }).locale, ZH_CN.id,
      'locale 必须跟随 lexicon —— canonicalizer 按 (tenant, domain, locale) 三元组查');
  });

  it('★缺任一项即回退裸 lexicon（半套参数会静默走内置，比报错更难查）', () => {
    assert.equal(buildCanonicalizeOptions(ZH_CN, undefined, DOMAIN), ZH_CN, '缺 tenantId 应回退');
    assert.equal(buildCanonicalizeOptions(ZH_CN, TENANT, undefined), ZH_CN, '缺 domain 应回退');
    assert.equal(buildCanonicalizeOptions(undefined, TENANT, DOMAIN), undefined, '无 lexicon 时保持 undefined');
  });
});
