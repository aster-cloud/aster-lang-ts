# PII 泄露场景清单

- 更新时间：2025-10-22 12:23 NZST
- 覆盖负责人：Codex

| 用例 | 目标 | 预期错误码 |
| --- | --- | --- |
| `pii_http_violation.aster` | 明文 HTTP 传输敏感数据 | `E400` |
