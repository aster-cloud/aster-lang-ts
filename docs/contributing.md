# Contributing

Thanks for helping improve Aster CNL. This guide describes the current contribution workflow and style rules.

## Style rules

- Use the current CNL style: inference-first, no explicit type annotations in examples/tests.
- Do not use operator-call chaining; use standard calls or infix operators.
- End statements with periods and block headers with colons.
- Use 2-space indentation.

## Setup

```
pnpm install
pnpm build
```

## Tests

```
pnpm test
```

## Updating goldens and datasets

If you update CNL sources used in tests or examples:

```
node dist/scripts/update-golden-ast.js
node scripts/update-all-core-golden.js
node scripts/generate-ai-training-data.mjs
```

## Docs updates

When you change syntax, inference rules, or examples, update:

- `README.md`
- `docs/cnl-syntax.md`
- `docs/type-inference.md`
- `docs/operator-call.md`
- `docs/examples.md`

## Localization updates

This repository maintains localized docs in English, Simplified Chinese, and German.

- Keep `docs/zh/` and `docs/de/` in sync with the English docs under `docs/`.
- When you add or rename a section, update all three languages.
- Prefer concise translations over literal ones if it improves clarity.
