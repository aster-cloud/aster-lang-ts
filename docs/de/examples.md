# Beispiele

Das Projekt enthaelt mehrere Beispielsammlungen:

- `examples/` enthaelt End-to-End-Demos (Compliance und Healthcare).
- `test/cnl/programs/` enthaelt kleine, fokussierte CNL-Programme fuer Tests.
- `test/cnl/programs/i18n/` enthaelt sprachspezifische Beispiele fuer Englisch, Chinesisch und Deutsch.

## Kleines Beispiel

```
This module is demo.greet.

Define User with name.

To greet with user, produce:
  Return Text.concat("Hello, ", user.name).
```

## Kontrollfluss-Beispiel

```
This module is demo.control_flow.

To decision with score, produce:
  If score at least 700:
    Return "approved".
  Otherwise:
    Return "review".
```

## Match-Beispiel

```
This module is demo.match_result.

To explain with result, produce:
  Match result:
    When Ok(value), Return Text.concat("OK: ", value).
    When Err(error), Return Text.concat("ERR: ", error).
```

## Workflow-Beispiel

```
This module is demo.workflow.

To sync_report, produce. It performs io:
  workflow:
    step fetch:
      Return Http.get("https://example.com/report").
    step store:
      Return Storage.write("report.txt", fetch).
```

## Compliance-Demos

- `examples/compliance/soc2-audit-demo.aster`
- `examples/compliance/hipaa-validation-demo.aster`

## Healthcare-Demos

- `examples/healthcare/patient-record.aster`
- `examples/healthcare/prescription-workflow.aster`

## Sprachspezifische Demos

- `test/cnl/programs/i18n/en-US/`
- `test/cnl/programs/i18n/zh-CN/`
- `test/cnl/programs/i18n/de-DE/`
