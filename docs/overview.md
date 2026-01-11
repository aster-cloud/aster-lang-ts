# Docs Overview

Aster CNL is a controlled natural language designed to be readable by non-programmers while still being type-safe.
This repository contains the TypeScript compiler toolchain, plus examples and tests.

What is new in the current CNL style:

- Type inference is the default. Examples do not use explicit type annotations for params, fields, or returns.
- Operator-call chaining is removed. Use standard calls (e.g., `Text.concat(a, b)`) or infix operators (e.g., `a plus b`).
- CNL statements end with a period. Block headers end with a colon and use 2-space indentation.

Language editions:

- English (default): `docs/overview.md`, `docs/cnl-syntax.md`, `docs/type-inference.md`, `docs/operator-call.md`, `docs/examples.md`, `docs/contributing.md`
- 简体中文: `docs/zh/overview.md`, `docs/zh/cnl-syntax.md`, `docs/zh/type-inference.md`, `docs/zh/operator-call.md`, `docs/zh/examples.md`, `docs/zh/contributing.md`
- Deutsch: `docs/de/overview.md`, `docs/de/cnl-syntax.md`, `docs/de/type-inference.md`, `docs/de/operator-call.md`, `docs/de/examples.md`, `docs/de/contributing.md`

Docs map:

- `docs/cnl-syntax.md`: Core syntax and formatting rules.
- `docs/type-inference.md`: How inference works and how to guide it.
- `docs/operator-call.md`: Migration notes and replacement patterns.
- `docs/examples.md`: Curated examples and where to find more.
- `docs/contributing.md`: Contributor workflow and project conventions.

Suggested reading order:

1. `docs/cnl-syntax.md` for grammar and formatting rules.
2. `docs/type-inference.md` to understand how types are inferred.
3. `docs/operator-call.md` if you are migrating older code.
4. `docs/examples.md` for working end-to-end references.
