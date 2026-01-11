# CNL Syntax (Current Style)

This guide documents the current CNL style used in this repository. Examples are inference-first and do not use explicit type annotations.

## Key ideas

- One statement per line, ending with a period.
- Block headers end with a colon and use 2-space indentation.
- Prefer simple, readable constructs over nested expressions.

## Modules

```
This module is greeting.
```

## Data types and enums

```
Define User with name, age, email.

Define Status as one of Pending or Approved or Rejected.
```

## Constructors and field access

```
To email_domain with user, produce:
  Return Text.after(user.email, "@").
```

## Functions

```
To greet with name, produce:
  Return Text.concat("Hello, ", name).
```

```
To is_empty with text, produce:
  Return Text.equals(text, "").
```

## Variables

```
To badge with user, produce:
  Let label be Text.concat("User ", user.name).
  Return label.
```

## Control flow

```
To check_access with role, produce:
  If role equals to "admin":
    Return true.
  Otherwise:
    Return false.
```

```
To eligibility with score, produce:
  If score at least 700:
    Return "approved".
  Otherwise:
    Return "review".
```

## Match

```
To explain with result, produce:
  Match result:
    When Ok(value), Return Text.concat("OK: ", value).
    When Err(error), Return Text.concat("ERR: ", error).
```

## Workflows (effects)

```
To sync_report, produce. It performs io:
  workflow:
    step fetch:
      Return Http.get("https://example.com/report").
    step store:
      Return Storage.write("report.txt", fetch).
```

## Comments

Use `//` for inline or standalone comments. Comments may appear after a header or at the end of a statement.

```
To greet with name, produce: // header note
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
