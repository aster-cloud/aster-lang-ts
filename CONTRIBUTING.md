# 贡献指南 · Contributing to aster-lang-ts

感谢你有意为 Aster TypeScript 编译器贡献力量！Thanks for contributing.

## 开始之前 · Before You Start

- 阅读 [README](README.md) 了解本仓职责。
- 遵守 [行为准则](CODE_OF_CONDUCT.md)。
- 安全问题请走 [SECURITY.md](SECURITY.md)（**不要**开公开 issue）。

## 本地验证 · Local Verification

```bash
pnpm install
pnpm run build       # 构建
pnpm test            # 测试
pnpm run typecheck   # 类型检查（若有）
```

改动**必须**在本地跑通 build + test 后再提 PR。改到跨引擎行为（词法/语法/IR）时，
双引擎 parity 是硬门槛——TS 输出须与 Java 引擎一致（见仓内 golden / parity 测试）。

## 提交流程 · Pull Request Flow

1. 从 `main` 切分支（`fix/…`、`feat/…`、`docs/…`）。
2. 小步提交；提交信息用祈使语气说明「做了什么 + 为什么」。
3. PR 描述附本地验证结果；等 CI 全绿后再请求合并。

## 许可证 · License

贡献即表示你同意你的贡献按本仓 [LICENSE](LICENSE)（Apache-2.0）授权。
By contributing, you agree your contributions are licensed under Apache-2.0.
