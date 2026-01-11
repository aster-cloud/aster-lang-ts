# Operator-Call Removal

Operator-call chaining (e.g., `Text.equals(a, b).equals(c, d)`) is removed. Use standard calls or infix operators instead.

## Why this change

- Keeps expressions explicit and easy to read.
- Avoids long chains that are hard to parse for non-programmers.
- Encourages small, named steps with `Let` bindings.

## Preferred patterns

```
If Text.equals(a, b):
  Return true.
```

```
If a equals to b:
  Return true.
```

```
Let total be a plus b.
Return total.
```

```
Let same be a equals to b.
If same:
  Return true.
```

## Replacements

- `Text.equals(a, b).equals(c, d)` -> `If Text.equals(a, b):` then handle `Text.equals(c, d)` separately.
- `List.head(xs).toString()` -> `Text.concat("", List.head(xs))` or `Int.toString(List.head(xs))` (pick the correct helper).
- `obj.getField()` -> `obj.field` (field access), or `Type.method(obj, ...)` if it is a helper.

## Migration advice

- Use `Let` bindings to break up nested expressions.
- Avoid chaining dot calls; use nested function calls or multiple statements.
- Keep expressions small and readable for non-programmers.

## Quick checklist

- Replace `a.b().c()` with multiple statements or helper calls.
- Prefer `Type.method(value, ...)` over `value.method(...)`.
- If a helper returns a value that is immediately used, bind it with `Let`.
