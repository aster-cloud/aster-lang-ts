# Aster Lang 测试贡献指南

> 更新时间：2025-10-22 22:04 NZST（执行者：Codex）

本指南面向首次向 Aster Lang 贡献测试的开发者，帮助你在 5 分钟内找到入口、在 1 小时内交付高质量测试用例。请在提交任何 PR 前完整阅读本文件。

## 指南目标

- 阐明确认测试范围、选择测试类型、编写与调试的标准流程。
- 提供可直接复制的代码模板与常用命令，降低上手成本。
- 说明与黄金（Golden）数据、回归测试 TODO 的维护要求，避免破坏既有基线。
- 强调测试金字塔目标（单元 70% / 集成 20% / E2E 10%），确保新增用例对准薄弱层级。

## 适用对象

- 新加入 Aster Lang 编译器开发的贡献者。
- 计划扩展语言特性的核心成员，需要补充覆盖面。
- 为 CLI、运行时或 IDE 集成修复缺陷的维护者。

## 准备工作

1. 阅读 `test/README.md` 获取测试目录全局结构。
2. 复习最新的测试统计与历史记录：`docs/testing.md`。
3. 如需了解当前回归用例状态，请参考 `.claude/phase5.3-test-failures-analysis.md`。
4. 运行最小验证命令，确保本地环境可执行：
   ```bash
   npm install
   npm run build
   npm run test -- --watch=false
   ```
5. 若涉及 CLI 或 Java 侧测试，请同步安装对应工具链（详见 `docs/SETUP.md`）。

---

## 测试类型选择决策树

```
+------------------------------------------+
| 功能是否仅涉及纯函数/无外部依赖？         |
+----------------------+-------------------+
                       |
                       | 是 → 选择 单元测试（test/unit）
                       v
否
|
|-- 涉及多个 Aster 模块交互？
|      |-- 是 → 集成测试（test/integration）
|      v
|-- 需要模拟 CLI / 运行脚本？
|      |-- 是 → 端到端测试（test/e2e）
|      v
|-- 基线 JSON/文本输出需要锁定？
|      |-- 是 → 黄金测试，复用 e2e golden 机制
|      v
|-- 针对特定缺陷回归？
|      |-- 是 → 回归测试（test/regression）
|      v
|-- 随机输入或属性不变量？
|      |-- 是 → 属性测试（test/property）
|      v
|-- 需要 fuzz 数据或性能对比？
         |-- fuzz → test/fuzz
         |-- perf → test/perf
```

> 提示：若仍然犹豫，请提交 issue 并 @ 主 AI 决策；执行 AI 不负责最终拍板。

---

## 各测试类型快速参考

### 单元测试（Unit）

- 目标：验证单个函数或模块的纯逻辑，输入/输出可直接构造。
- 位置：`test/unit/<领域>/<文件>.test.ts`
- 框架：Node.js `node:test` + `assert/strict`
- 模板片段：
  ```ts
  import { describe, it } from 'node:test';
  import assert from 'node:assert/strict';
  import { 待测函数 } from '../../../src/...';

  describe('模块说明', () => {
    it('应该满足某行为', () => {
      const 输入 = ...;
      const 结果 = 待测函数(输入);
      assert.deepEqual(结果, 期望值);
    });
  });
  ```
- 常见陷阱：不要在单元测试中访问文件系统或执行 CLI；若需要，请升级为集成或 E2E。

### 集成测试（Integration）

- 目标：覆盖多个内部模块协作，如词法→语法→类型检查链路。
- 位置：`test/integration/`
- 建议：封装复用 `src/` 下的公共 API（如 `canonicalize`、`parse`），避免重复管线代码。
- 输出：通常返回诊断结果数组、核心中间表示，需断言结构。
- 调试技巧：在 `npm run test:integration` 时加 `--inspect` 附加调试器。

### 端到端测试（E2E）

- 目标：模拟用户路径，通常通过 CLI 或脚本执行 Aster 编译流程。
- 位置：`test/e2e/` 与 `test/cnl/examples/`（黄金数据）。
- Golden 测试：将输出写入 `test/e2e/golden/expected/*.json`，并在代码中调用比较器。
- 注意：新增 Golden 文件必须在 PR 中一同提交，且保持内容可读、注释明确。

### 回归测试（Regression）

- 目标：锁定已知缺陷案例，防止再次复现。
- 位置：`test/regression/type-checker-golden.test.ts` 等。
- TODO 策略：当实现缺失时，以注释 `TODO(TypeChecker): ...` 形式保留，并在 `.claude/phase5.3-test-failures-analysis.md` 更新说明。
- 在恢复 TODO 前，需与主 AI 确认策略（是更新 expected、还是补全功能）。

### 属性测试 / 模糊测试 / 性能测试

- `test/property/` 依赖 fast-check；用于声明性不变量，示例参见 `property/effects.tester.ts`。
- `test/fuzz/` 使用独立脚本生成多组输入，关注崩溃率与覆盖率。
- `test/perf/` 记录运行耗时；提交前请使用基准比较保持波动 <10%。

---

## 为新功能添加测试：一步步流程

1. **确定需求**  
   - 从任务描述或 issue 中提取功能点。  
   - 标记涉及模块（语法/类型/运行时）。  
   - 若存在设计文档，在 `.claude/` 目录查找对应阶段材料。

2. **选定测试类型**  
   - 对照上方决策树，并评估对测试金字塔的贡献。  
   - 若选择不合主流（例如新增 E2E 而非单元），需在 PR 描述说明原因。

3. **准备输入与期望**  
   - 单元/集成测试：直接写字符串或 JSON。  
   - Golden 测试：在 `test/cnl/examples/` 新建 `.aster` 或 `.json`，再运行对比脚本生成 expected。  
   - 回归测试：引用 `.claude/phase5.3-test-failures-analysis.md` 等文档提供的失败案例。

4. **编写测试文件**  
   - 复制最相近的测试模板，修改案例与断言。  
  - 所有注释、描述、断言消息必须使用中文，方便团队沟通。  
   - 若需要 helper，请优先复用 `test/helpers/` 内现有函数，避免重复造轮子。

5. **运行针对性命令**  
   - `npm run test:unit` / `npm run test:integration` / `npm run test:e2e` 等。  
   - 推荐加上 `--runInBand` 于非并行场景，确保输出顺序。  
   - 如执行 Golden 测试，先运行 `npm run test:golden -- --update` 生成 expected，再执行无 `--update` 的对比。

6. **调试失败**  
   - 使用 `LOG_LEVEL=DEBUG` 或 `ASTER_DEBUG_TYPES=1` 观察内部日志。  
   - 结合 `node --inspect-brk` 对 CLI 进行断点调试。  
   - 如怀疑解析问题，可运行 `node dist/scripts/typecheck-cli.js <file>` 直接查看 AST/诊断。

7. **记录结果**  
   - 在 PR 中附上命令与输出来自 `docs/testing.md` 的格式。  
   - 若需要更新文档，请同步修改 `docs/testing.md` 或相关阶段报告。

8. **提交前检查**  
   - 确保新增文件已加入 git。  
   - 对比 `npm run lint` 是否通过（若仓库提供）。  
   - 运行 `npm run test` 全量验证，确认无回归。

---

## 代码模板与示例

### 单元测试模板

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpression } from '../../../src/parser.js';

describe('表达式解析', () => {
  it('应该解析简单加法', () => {
    const source = '1 + 2';
    const ast = parseExpression(source);
    assert.equal(ast.kind, 'Add');
  });
});
```

### 集成测试模板

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../../src/canonicalizer.js';
import { lex } from '../../../src/lexer.js';
import { parse } from '../../../src/parser.js';
import { lowerModule } from '../../../src/lower_to_core.js';
import { typecheckModule } from '../../../src/typecheck.js';

describe('管线集成', () => {
  it('应该从源码生成零诊断', () => {
    const source = `
Module test.examples.hello.

Rule main, produce Int:
  Return 42.
`;
    const canonical = canonicalize(source);
    const tokens = lex(canonical);
    const ast = parse(tokens);
    const diagnostics = typecheckModule(lowerModule(ast));
    assert.equal(diagnostics.length, 0);
  });
});
```

### 黄金测试差异比较

```ts
import { compareGolden } from '../helpers/golden.js';

it('应该匹配预期 JSON', async () => {
  await compareGolden({
    name: 'effects/pii_violation',
    actual: runCliAndCollectJson('test/cnl/examples/pii_violation.aster')
  });
});
```

> 所有模板仅供参考，实际代码需根据模块路径调整；请保持相对路径正确。

---

## 运行与调试命令速查

- 全量测试：`npm run test`
- 单元测试：`npm run test:unit`
- 集成测试：`npm run test:integration`
- E2E（含 Golden）：`npm run test:e2e` / `npm run test:golden`
  - Golden 的输入语料依次取 `ASTER_LANG_TEST_PATH`、兄弟 checkout（`../aster-lang-test` 或 `./aster-lang-test`）、npm 包 `@aster-cloud/aster-lang-test`；期望跟随 aster-lang-test main。兄弟仓需先在 `packages/js` 执行 `pnpm install && pnpm run build`，未构建会直接报错。
- 回归套件：`npm run test:regression`
- 仅更新 Golden：`npm run test:golden -- --update`
- Java 侧测试：`./gradlew :aster-core:test`
- CLI 集成：`ASTER_COMPILER=java ./gradlew-java25 :aster-lang-cli:run --args 'parse <file>.aster --json'`
- 调试 CLI：`LOG_LEVEL=DEBUG node dist/scripts/typecheck-cli.js test/cnl/examples/xxx.aster`

---

## Golden 测试维护流程

1. 在 `test/cnl/examples/` 添加或更新示例，命名规则见 `test/cnl/examples/README.md`。  
2. 运行 `npm run test:golden -- --update` 生成新的 expected 文件。  
3. 检查 `test/e2e/golden/expected/` 下的 diff，确认仅包含预期变更。  
4. 在 PR 描述中链接相关设计或需求，说明 Golden 变更原因。  
5. 若更改影响到 Phase 5 历史，请在 `.claude/phase5.*.md` 中追加说明（需主 AI 指示后执行）。

---

## 回归测试 TODO 恢复流程

1. 查阅 `.claude/phase5.3-test-failures-analysis.md`，找到对应 TODO 标记。  
2. 先修复根因（实现缺失或基线过时），并增加单元/集成覆盖。  
3. 删除测试中的 `TODO(...)` 注释，恢复断言。  
4. 更新 expected 文件，确保 `npm run test:regression` 全部通过。  
5. 在 PR 中记录“恢复某 TODO”以及验证结果，方便历史追溯。  
6. 通知主 AI 审阅，等待确认后合并。

---

## 最佳实践清单

- ✅ 先写失败的测试再实现功能，确保红→绿过程完整。
- ✅ 一次 PR 只关注单一功能或缺陷，避免测试难以定位。
- ✅ 使用中文断言信息，例如 `assert.equal(...)` 的第三个参数。
- ✅ 避免使用随机数；如必须随机，请设置固定种子保证重现。
- ✅ 运行完测试后，更新 `docs/testing.md` 的统计或执行记录（需主 AI 指示）。
- ✅ 在 `operations-log.md` 记录关键测试命令与结果。
- 🚫 不要在测试中做网络请求或依赖未 mock 的外部系统。
- 🚫 不要提交孤立的 expected 文件变更，必须伴随代码或文档解释。
- 🚫 不要修改安全相关逻辑以规避测试失败（安全策略由上层负责）。

---

## 常见问题

**Q：为什么我的 Golden 测试输出格式不一致？**  
A：请确认已运行 `npm run build`，保证 PEG 解析器与类型检查器版本同步；此外，比较 JSON 时请排序字段或使用 helper。

**Q：回归测试中 TODO 要如何标记？**  
A：使用 `TODO(TypeChecker): ...` 形式，并在 `.claude/phase5.3-test-failures-analysis.md` 说明原因与期望恢复条件。

**Q：能否直接在回归用例里写实现推断逻辑？**  
A：禁止。测试层只验证行为，具体实现需在 `src/` 或 `packages/` 下完成。

---

## 附录：参考资料

- `.claude/phase5.*-*.md` —— Phase 5 历史记录与决策日志。
- `docs/testing.md` —— 最新执行记录。
- `test/unit/async/async-discipline.test.ts` —— 复杂诊断单元测试示例。
- `test/regression/type-checker-golden.test.ts` —— 回归测试结构与 TODO 注释示例。
- `test/helpers/golden.ts` —— 黄金测试比较工具。

---

> 若在执行过程中遇到阻塞，请记录问题并通知主 AI 指示下一步；执行 AI 不做终局判断。
