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
