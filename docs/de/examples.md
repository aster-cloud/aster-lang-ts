# Beispiele

Das Projekt enthaelt mehrere Beispielsammlungen:

- `examples/` enthaelt End-to-End-Demos (Compliance und Healthcare).
- `test/cnl/programs/` enthaelt kleine, fokussierte CNL-Programme fuer Tests.
- `test/cnl/programs/i18n/` enthaelt sprachspezifische Beispiele fuer Englisch, Chinesisch und Deutsch.

## Kleines Beispiel

```
Module demo.greet.

Define User has name.

Rule greet given user, produce:
  Return Text.concat("Hello, ", user.name).
```

## Kontrollfluss-Beispiel

```
Module demo.control_flow.

Rule decision given score, produce:
  If score at least 700:
    Return "approved".
  Otherwise:
    Return "review".
```

## Match-Beispiel

```
Module demo.match_result.

Rule explain given result, produce:
  Match result:
    When Ok(value), Return Text.concat("OK: ", value).
    When Err(error), Return Text.concat("ERR: ", error).
```

## Workflow-Beispiel

```
Module demo.workflow.

Rule sync_report, produce. It performs io:
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
