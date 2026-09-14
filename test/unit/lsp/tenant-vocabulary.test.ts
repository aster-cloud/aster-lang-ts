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
import { applyTenantInitOptions, resolveTenantContext } from '../../../src/lsp/tenant-init.js';

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
 * 本测试两半都锁：
 *   · 第 2 半——同一段源码在**传/不传**租户上下文时的行为差异（canonicalizer 契约）
 *   · 第 1 半——`applyTenantInitOptions` 是否真的把词汇注册进去
 *
 * ★为什么第 1 半非补不可：原先它只由 `server.ts` 承担，而那个模块顶层就
 * `createConnection()`，单测无法 import。实测把 server.ts 整段注册逻辑改成
 * `if (false)`，本文件 6 条用例**仍然全绿**——契约证明"canonicalizer 会用
 * 租户词汇"，证明不了"LSP 真的注册了"。已把决策点抽成无副作用的
 * `src/lsp/tenant-init.ts`（与 aster-lang-ts#162 同一修法）。
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

/**
 * 第 1 半：initializationOptions → registerCustom 的接线。
 *
 * ★这一块此前无人守卫——server.ts 无法单测，于是「LSP 到底注册没注册」
 * 完全靠人肉阅读保证。抽成 tenant-init.ts 后才有了可断言的决策点。
 */
describe('租户上下文注册（applyTenantInitOptions）', () => {
  const T = 'tenant-init-test';
  /** 与生产同形的最小词汇表（字段形状照抄本文件上方的 VOCAB）。 */
  const vocabOf = (id: string) => ({
    id, name: '接线测试', locale: 'zh-CN', version: '1.0.0',
    structs: [], fields: [],
    functions: [{ canonical: 'premium', localized: '保费', kind: 'function' }],
  });

  it('★完整上下文：词汇被注册，返回 tenantId 与 domain', () => {
    const r = applyTenantInitOptions({ tenantId: T, domainVocabularies: [vocabOf('vi.a')] });

    assert.equal(r.tenantId, T);
    assert.equal(r.domain, 'vi.a');
    assert.equal(r.registered, 1);
    // 真的进了注册表——而不只是返回了对象
    assert.ok(vocabularyRegistry.getWithCustom(T, 'vi.a', 'zh-CN'),
      '词汇应当能从 registry 查回来');
  });

  it('★缺 tenantId：整块忽略（半套参数查不到任何东西）', () => {
    const r = applyTenantInitOptions({ domainVocabularies: [vocabOf('vi.b')] });

    assert.equal(r.tenantId, undefined);
    assert.equal(r.registered, 0);
  });

  it('★缺 domainVocabularies：整块忽略', () => {
    const r = applyTenantInitOptions({ tenantId: T });

    assert.equal(r.tenantId, undefined);
    assert.equal(r.registered, 0);
  });

  it('★无效词汇表被跳过，但不中断整批（缺几项 ≠ LSP 起不来）', () => {
    const r = applyTenantInitOptions({
      tenantId: T,
      domainVocabularies: [{ id: 'bad' }, vocabOf('vi.c')],
    });

    assert.equal(r.registered, 1, '合法的那份仍应注册成功');
    assert.equal(r.skipped.length, 1, '无效的那份应被记录');
    // ★domain 取第一个**成功注册**的，而非数组首项——
    //   首项若校验失败还拿它当 domain，后续查询会全部落空。
    assert.equal(r.domain, 'vi.c');
  });

  it('★全部无效时不留 tenantId（避免构造出查不到东西的 options）', () => {
    const r = applyTenantInitOptions({
      tenantId: T, domainVocabularies: [{ id: 'bad1' }, { id: 'bad2' }],
    });

    assert.equal(r.tenantId, undefined, '一个都没注册成功就不该带 tenantId');
    assert.equal(r.skipped.length, 2);
  });

  it('★从 InitializeParams **整体**取 initializationOptions（接线本身）', () => {
    // ★这条锁的是 server.ts 里「把 params.initializationOptions 喂进去」那一步。
    //   实测：把那行改成 applyTenantInitOptions(undefined)，全量 1819 条仍全绿——
    //   抽出被调用方只证明函数内部对，证明不了它被正确调用
    //   （「抽纯函数要抽到底」/「验连线不只验对象」）。
    const r = resolveTenantContext({
      initializationOptions: { tenantId: T, domainVocabularies: [vocabOf('vi.wire')] },
    });

    assert.equal(r.tenantId, T);
    assert.equal(r.domain, 'vi.wire');
    assert.equal(r.registered, 1);
  });

  it('★取错字段即失效（反向守卫：证明上一条不是恒真）', () => {
    // 把同样的内容放在**别的**字段名下，必须拿不到租户上下文。
    const r = resolveTenantContext({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initOptions: { tenantId: T, domainVocabularies: [vocabOf('vi.wrong')] },
    } as any);

    assert.equal(r.tenantId, undefined);
    assert.equal(r.registered, 0);
  });

  it('★registered 必须是**计数**而非布尔（两个都合法时应为 2）', () => {
    // 原夹具最多只有 1 个有效项，于是 registered 取值域退化成 {0,1}，
    // `registered++` 改成 `registered = 1` 也全绿（夹具维度塌缩）。
    const r = applyTenantInitOptions({
      tenantId: T, domainVocabularies: [vocabOf('vi.two-a'), vocabOf('vi.two-b')],
    });

    assert.equal(r.registered, 2, 'registered 应是数量，不是布尔');
    assert.equal(r.domain, 'vi.two-a', 'domain 取第一个成功注册的');
    assert.ok(vocabularyRegistry.getWithCustom(T, 'vi.two-a', 'zh-CN'));
    assert.ok(vocabularyRegistry.getWithCustom(T, 'vi.two-b', 'zh-CN'));
  });

  it('undefined 入参安全返回空结果', () => {
    const r = applyTenantInitOptions(undefined);
    assert.equal(r.tenantId, undefined);
    assert.equal(r.registered, 0);
  });
});
