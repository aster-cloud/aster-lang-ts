# Examples

The project includes several example sets:

- `examples/` contains end-to-end demos (compliance and healthcare).
- `test/cnl/programs/` contains small, focused CNL programs used in tests.
- `test/cnl/programs/i18n/` contains language-specific examples for English, Chinese, and German.

## Small example

```
Module demo.greet.

Define User has name.

Rule greet given user, produce:
  Return Text.concat("Hello, ", user.name).
```

## Control flow example

```
Module demo.control_flow.

Rule decision given score, produce:
  If score at least 700:
    Return "approved".
  Otherwise:
    Return "review".
```

## Match example

```
Module demo.match_result.

Rule explain given result, produce:
  Match result:
    When Ok(value), Return Text.concat("OK: ", value).
    When Err(error), Return Text.concat("ERR: ", error).
```

## Workflow example

```
Module demo.workflow.

Rule sync_report, produce. It performs io:
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
