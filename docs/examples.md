# Examples

The project includes several example sets:

- `examples/` contains end-to-end demos (compliance and healthcare).
- `test/cnl/programs/` contains small, focused CNL programs used in tests.
- `test/cnl/programs/i18n/` contains language-specific examples for English, Chinese, and German.

## Small example

```
This module is demo.greet.

Define User with name.

To greet with user, produce:
  Return Text.concat("Hello, ", user.name).
```

## Control flow example

```
This module is demo.control_flow.

To decision with score, produce:
  If score at least 700:
    Return "approved".
  Otherwise:
    Return "review".
```

## Match example

```
This module is demo.match_result.

To explain with result, produce:
  Match result:
    When Ok(value), Return Text.concat("OK: ", value).
    When Err(error), Return Text.concat("ERR: ", error).
```

## Workflow example

```
This module is demo.workflow.

To sync_report, produce. It performs io:
  workflow:
    step fetch:
      Return Http.get("https://example.com/report").
    step store:
      Return Storage.write("report.txt", fetch).
```

## Compliance demos

- `examples/compliance/soc2-audit-demo.aster`
- `examples/compliance/hipaa-validation-demo.aster`

## Healthcare demos

- `examples/healthcare/patient-record.aster`
- `examples/healthcare/prescription-workflow.aster`

## Language-specific demos

- `test/cnl/programs/i18n/en-US/`
- `test/cnl/programs/i18n/zh-CN/`
- `test/cnl/programs/i18n/de-DE/`
