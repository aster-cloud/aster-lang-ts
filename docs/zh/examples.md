# 示例

项目包含多类示例：

- `examples/` 包含端到端示例（合规与医疗）。
- `test/cnl/programs/` 包含小型、聚焦的 CNL 程序，用于测试。
- `test/cnl/programs/i18n/` 包含英语、中文、德语的语言示例。

## 小型示例

```
Module demo.greet.

Define User has name.

Rule greet given user, produce:
  Return Text.concat("Hello, ", user.name).
```

## 控制流示例

```
Module demo.control_flow.

Rule decision given score, produce:
  If score at least 700:
    Return "approved".
  Otherwise:
    Return "review".
```

## 匹配示例

```
Module demo.match_result.

Rule explain given result, produce:
  Match result:
    When Ok(value), Return Text.concat("OK: ", value).
    When Err(error), Return Text.concat("ERR: ", error).
```

## 工作流示例

```
Module demo.workflow.

Rule sync_report, produce. It performs io:
  workflow:
    step fetch:
      Return Http.get("https://example.com/report").
    step store:
      Return Storage.write("report.txt", fetch).
```

## 合规示例

- `examples/compliance/soc2-audit-demo.aster`
- `examples/compliance/hipaa-validation-demo.aster`

## 医疗示例

- `examples/healthcare/patient-record.aster`
- `examples/healthcare/prescription-workflow.aster`

## 语言示例

- `test/cnl/programs/i18n/en-US/`
- `test/cnl/programs/i18n/zh-CN/`
- `test/cnl/programs/i18n/de-DE/`
