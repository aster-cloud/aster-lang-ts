# 贡献指南

感谢你为 Aster CNL 做出贡献。本指南描述当前的贡献流程与风格规范。

## 风格规则

- 使用当前 CNL 风格：以推断为主，示例/测试中不写显式类型。
- 不使用运算符链式调用；使用标准调用或中缀运算符。
- 语句以句号结尾，块头以冒号结尾。
- 使用 2 空格缩进。

## 环境设置

```
pnpm install
pnpm build
```

## 测试

```
pnpm test
```

## 更新 goldens 与数据集

如果你更新了测试或示例中使用的 CNL 源文件：

```
node dist/scripts/update-golden-ast.js
node scripts/update-all-core-golden.js
node scripts/generate-ai-training-data.mjs
```

## 文档更新

当你修改语法、推断规则或示例时，请同步更新：

- `README.md`
- `docs/cnl-syntax.md`
- `docs/type-inference.md`
- `docs/operator-call.md`
- `docs/examples.md`

## 本地化更新

仓库维护英语、简体中文、德语三个语言版本的文档。

- 保持 `docs/zh/` 与 `docs/de/` 与 `docs/` 中的英文内容一致。
- 当新增或重命名章节时，请同步更新三种语言。
- 优先保证表达清晰，必要时可适度意译。
