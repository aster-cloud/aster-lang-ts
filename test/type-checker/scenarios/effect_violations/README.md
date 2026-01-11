# 效应违规场景清单

- 更新时间：2025-10-22 12:23 NZST
- 覆盖负责人：Codex

| 用例 | 目标 | 预期错误码 |
| --- | --- | --- |
| `effect_missing_io.aster` | 检测缺失的 `@io` 声明 | `E200` |
| `effect_missing_cpu.aster` | 检测缺失的 `@cpu` 声明 | `E201` |
| `async_missing_wait.aster` | 异步纪律校验（Start 未 Wait） | `E500` |
