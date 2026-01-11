# 类型错误场景清单

- 更新时间：2025-10-22 12:22 NZST
- 覆盖负责人：Codex

| 用例 | 目标 | 预期错误码 |
| --- | --- | --- |
| `basic_types.aster` | 基线：无错误，验证推断稳定性 | — |
| `generics.aster` | 泛型推断保持成功 | — |
| `type_mismatch_assign.aster` | 构造字段类型不匹配 | `E012` |
| `return_type_mismatch.aster` | 返回类型不匹配 | `E003` |
| `list_literal_mismatch.aster` | 列表字面量元素类型不一致 | `E020` |
