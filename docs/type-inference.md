# Type Inference

Type inference is the default in the current CNL style. Parameters, fields, and return types are inferred from usage rather than declared explicitly.

## What gets inferred

- Function parameters are inferred from how they are used.
- Data fields are inferred from how values are constructed and accessed.
- Return types are inferred from `Return` expressions.

## Inference boundaries

Inference is strongest when usage is direct and consistent across a function body:

- `If` branches should return values of the same shape.
- `Match` arms should return compatible values.
- `Let` bindings help the compiler see clear, named intermediate values.

## Simple examples

```
Define User with id, name.

To get_name with user, produce:
  Return user.name.
```

```
To is_adult with age, produce:
  If age at least 18:
    Return true.
  Return false.
```

## Guiding inference

If inference becomes ambiguous, prefer to:

- Add a small helper function with a clear return usage.
- Use descriptive names (`count`, `has_`, `is_`, `message`) that align with common inference rules.
- Refactor a complex expression into smaller `Let` bindings.
- Keep `If` and `Match` returns aligned on the same type.

## Avoid explicit type annotations

In this repository, examples and tests intentionally avoid explicit type annotations. If you need to express a type more clearly, prefer structural usage rather than annotations.

## Practical refactor patterns

```
To score_label with score, produce:
  Let high be score at least 90.
  If high:
    Return "high".
  Otherwise:
    Return "standard".
```

```
To display_name with user, produce:
  Let name be user.name.
  Return Text.concat("User ", name).
```
