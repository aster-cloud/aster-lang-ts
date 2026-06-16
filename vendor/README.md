# vendor/ — 临时 SLA tarball

## 目的

存放无法通过 npm registry 消费的 sibling 包 tarball。

当前内容：

| Tarball | Source | Reason |
|---------|--------|--------|
| `aster-cloud-aster-lang-test-0.0.3.tgz` | `aster-lang-test/packages/js` | npm token lacks `@aster-cloud` org publish rights；npm registry 仅有 0.0.2 |

## 替代方案为什么不可行

- **link:../aster-lang-test/packages/js**：CI runner 不存在 sibling 仓库
- **github URL**：pnpm 10 build script allowlist 拦截 `prepare` 脚本
- **publish to npm**：需要 `@aster-cloud` org 发布权限（未到位）

## Owner

Owner: @aster/lang-stewards

## 删除条件（Removal Conditions / 临时 SLA）

1. npm token 取得 `@aster-cloud` org publish 权限
2. `cd ../aster-lang-test/packages/js && npm publish` 发布 0.0.3 到 npm registry
3. `aster-lang-ts/package.json` 把 `file:vendor/aster-cloud-aster-lang-test-0.0.3.tgz` 改回 `^0.0.3`
4. 删除 `vendor/aster-cloud-aster-lang-test-0.0.3.tgz`
5. `pnpm install && pnpm test` 验证 + 提交删除 commit

## 重新生成 tarball

```bash
cd ../aster-lang-test/packages/js
pnpm pack --pack-destination ../../../aster-lang-ts/vendor
```

## ⚠️ 版本同步守卫（Version sync guard — #24）

存在版本错位风险：**vendored 0.0.3 / npm published 0.0.2 / source 1.0.2**。

真正的修复需要把 corpus 发布到 npm（见上文“删除条件”），暂不在范围内。
作为临时守卫，`test/unit/corpus-version.test.ts` 会断言**已安装的 corpus 版本**
等于 `EXPECTED_CORPUS_VERSION`（当前 `0.0.3`），并断言 `package.json` 中的
tarball 引用包含该版本。

**重新同步（re-sync）corpus 时必须同时更新以下三处，否则该守卫测试会失败：**

1. `vendor/aster-cloud-aster-lang-test-<新版本>.tgz`（重新 `pnpm pack`）
2. `package.json` 的 `devDependencies["@aster-cloud/aster-lang-test"]`
3. `test/unit/corpus-version.test.ts` 的 `EXPECTED_CORPUS_VERSION`
