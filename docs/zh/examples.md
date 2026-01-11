# 示例

项目包含多类示例：

- `examples/` 包含端到端示例（合规与医疗）。
- `test/cnl/programs/` 包含小型、聚焦的 CNL 程序，用于测试。
- `test/cnl/programs/i18n/` 包含英语、中文、德语的语言示例。

## 小型示例

```
This module is demo.greet.

Define User with name.

To greet with user, produce:
  Return Text.concat("Hello, ", user.name).
```

## 控制流示例

```
This module is demo.control_flow.

To decision with score, produce:
  If score at least 700:
    Return "approved".
  Otherwise:
    Return "review".
```

## 匹配示例

```
This module is demo.match_result.

To explain with result, produce:
  Match result:
    When Ok(value), Return Text.concat("OK: ", value).
    When Err(error), Return Text.concat("ERR: ", error).
```

## 工作流示例

```
This module is demo.workflow.

To sync_report, produce. It performs io:
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
