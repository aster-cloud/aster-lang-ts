# 共享类型检查测试套件

- 更新时间：2025-10-22 12:14 NZST
- 维护者：Codex

本目录承载 Java 与 TypeScript 类型检查器共享的 golden 测试数据，确保两端语义实现保持一致。

## 目录结构

- `golden/`：原始 `.aster` 测试用例，覆盖基础类型、泛型、效应、能力、异步、PII 等场景。
- `expected/`：每个用例对应的类型推断结果与诊断基线，包含 `<case>.json` 与 `<case>.errors.json`。
- `scenarios/`：按主题归档的测试清单，便于扩展场景化测试。
  - `type_errors/`
  - `effect_violations/`
  - `pii_leaks/`
  - `capability_checks/`

## 期望文件格式

```jsonc
// expected/basic_types.json
{
  "file": "basic_types.aster",
  "module": "tests.typecheck.basic",
  "functions": {
    "add": {
      "signature": "add(Int, Int) -> Int",
      "effects": [],
      "capabilities": []
    }
  },
  "diagnostics": []
}

// expected/basic_types.errors.json
{
  "file": "basic_types.aster",
  "diagnostics": []
}
```

- 所有诊断应使用 `shared/error_codes.json` 中的 `code`，并记录 `severity`、`message` 与（如可用）`span`。
- `functions` 节点用于对比两端类型推断结果，`effects` 与 `capabilities` 均采用数组形式。
- 如测试仅验证错误，无需列出函数签名，可将 `functions` 置为空对象。

## 维护约定

1. 新增用例时需同时补充 `expected/` 与 `scenarios/` 目录，以便交叉验证脚本消费。
2. 更新 `shared/error_codes.json` 后，应通过 `scripts/generate_error_codes.ts` 重新生成平台端常量。
3. 若某测试暂无法在一端实现，允许在 `scenarios/*` 内补充注释说明原因，但不得删除用例。

