# CNL Syntax (Current Style)

This guide documents the current CNL style used in this repository. Examples are inference-first and do not use explicit type annotations.

## Key ideas

- One statement per line, ending with a period.
- Block headers end with a colon and use 2-space indentation.
- Prefer simple, readable constructs over nested expressions.

## Modules

```
Module greeting.
```

## Data types and enums

```
Define User has name, age, email.

Define Status as one of Pending or Approved or Rejected.
```

## Constructors and field access

```
Rule email_domain given user, produce:
  Return Text.after(user.email, "@").
```

## Functions

```
Rule greet given name, produce:
  Return Text.concat("Hello, ", name).
```

```
Rule is_empty given text, produce:
  Return Text.equals(text, "").
```

## Variables

```
Rule badge given user, produce:
  Let label be Text.concat("User ", user.name).
  Return label.
```

## Control flow

```
Rule check_access given role, produce:
  If role equals to "admin":
    Return true.
  Otherwise:
    Return false.
```

```
Rule eligibility given score, produce:
  If score at least 700:
    Return "approved".
  Otherwise:
    Return "review".
```

## Match

```
Rule explain given result, produce:
  Match result:
    When Ok(value), Return Text.concat("OK: ", value).
    When Err(error), Return Text.concat("ERR: ", error).
```

## Workflows (effects)

```
Rule sync_report, produce. It performs io:
  workflow:
    step fetch:
      Return Http.get("https://example.com/report").
    step store:
      Return Storage.write("report.txt", fetch).
```

## Comments

Use `//` for inline or standalone comments. Comments may appear after a header or at the end of a statement.

```
Rule greet given name, produce: // header note
  Return Text.concat("Hi, ", name). // inline note
```

## Operators and comparisons

Common comparisons and operators read like English:

```
Let total be a plus b.
Let same be a equals to b.
Let older be age at least 21.
```

## Formatting rules

- End statements with a period.
- End block headers with a colon.
- Use 2-space indentation.
- Prefer inference-first style (no explicit types in examples).
- Operator-call chaining is removed; use standard calls or infix operators.
