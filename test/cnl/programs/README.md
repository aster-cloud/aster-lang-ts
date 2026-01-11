# CNL 示例与 E2E 测试数据

> 更新时间：2025-10-22 22:04 NZST（执行者：Codex）

本目录承担双重职责：

1. **语言示例仓库**：向学习者展示 CNL/Aster 的语法与模式。
2. **E2E 测试数据源**：为 `test/e2e/golden`、CLI 演示及回归测试提供稳定输入。

---

## 命名与结构约定

- 使用语义化模块名：`feature_scope/example_name.aster`，例如 `effects/http_chains.aster`。
- JSON 期望值放置在 `golden/*.json`，命名与 `.aster` 文件保持一致。
- 若示例包含多语言或依赖数据，请在子目录创建 `README` 说明，确保上下文完整。
- 保持文件内注释为中文，解释关键语法或行为。

---

## 添加新示例的步骤

1. 在此目录创建新的 `.aster` 文件，使用三段式结构（模块声明、类型定义、函数体）。  
2. 如需配套 JSON/文本输出，将 expected 写入 `test/e2e/golden/expected/`，文件名与示例对应。  
3. 运行 `npm run test:golden -- --update` 生成 Golden 基线。  
4. 检查 diff 并更新 `test/TESTING_GUIDE.md` 中相关章节（若流程变更）。  
5. 在 PR 描述中说明示例目的，并引用需求或设计文档路径。  
6. 若示例用于回归测试，请同时在 `test/regression/` 中添加断言或恢复 TODO。

---

## 与测试目录的关系

- `test/e2e/golden/*.test.ts` 会从本目录读取示例，再与 expected 输出比较。  
- CLI 集成测试使用 `dist/scripts/typecheck-cli.js test/cnl/examples/<file>` 直接运行。  
- 回归分析文档（如 `.claude/phase5.3-test-failures-analysis.md`）会引用具体示例，请勿随意重命名。  
- 若需要删除示例，必须先确认无测试依赖，并在 `.claude/phase5.*.md` 内记录原因（需主 AI 指示）。

---

## Golden 数据维护技巧

- 尽量保持示例简短，突出单一语法点。  
- 为复杂示例添加顶部注释，说明覆盖的语义或缺陷。  
- 当语言语义调整导致输出变化时，优先更新 expected，再评估是否需要新增示例。  
- 使用 `LOG_LEVEL=DEBUG` 或 `ASTER_DEBUG_TYPES=1` 运行 CLI 以验证诊断细节。  
- 若多个示例共享同一模式，可提取公共片段到 `snippets/` 子目录，并在 README 中解释引用方式。

---

## 参考文档

- `test/README.md` —— 测试总览。  
- `test/TESTING_GUIDE.md` —— 添加测试的完整流程。  
- `.claude/phase5.*.md` —— Phase 5 历史背景与 Golden 变更记录。

---

> 如需新增分类或大规模重构目录，请先向主 AI 提交确认，执行 AI 不做结构决策。
