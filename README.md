# Aster Lang TypeScript Compiler

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

TypeScript implementation of the Aster CNL (Controlled Natural Language) compiler pipeline.

## Overview

Aster is a pragmatic, type-safe language with human-readable controlled natural language syntax. This package provides the pure TypeScript compiler infrastructure:

- **Canonicalizer**: Normalizes CNL source code
- **Lexer**: Tokenizes source with multi-language lexicon support
- **Parser**: Generates AST from token stream
- **Core IR**: Intermediate representation
- **Type Checker**: Static type analysis
- **LSP Server**: Language Server Protocol implementation

## Installation

```bash
pnpm install @aster-cloud/aster-lang-ts
```

## Quick Start

```typescript
import { parseSource, resolveAndLowerChecked } from '@aster-cloud/aster-lang-ts';

// Compile pipeline: canonicalize → lex → parse → name resolution (R1) → lower → name resolution (R2)
const source = `
Module greeting.

Rule greet given name, produce:
  Return Text.concat("Hello, ", name).
`;

const { ast } = parseSource(source);
// Throws NameResolutionError (E8xx diagnostics) instead of returning Core with unresolved names
const { core, diagnostics } = resolveAndLowerChecked(ast);
```

Raw lowering (`lowerModule`) and the unchecked `resolveAndLower` are internal and not exported:
every public path to Core IR runs name resolution and refuses to emit IR on resolution errors.
Use `compile` / `compileAndTypecheck` from `@aster-cloud/aster-lang-ts/browser`,
`resolveAndLowerChecked`, or `resolvePolicyTypes`.

## Running exported policy packages (`aster run`)

The `aster` bin runs policy packages exported by the platform (package format 1.0, ADR 0059). The same five
commands are also published as a single file, `dist/runner/aster.mjs` (exported as `@aster-cloud/aster-lang-ts/runner`
and attached to each GitHub Release with its `aster.mjs.sha256`); it needs only Node ≥ 24, no `node_modules`.

```bash
aster run ./my-policy-v3-node-b --input input.json --jwks export-jwks.json   # or --input - (stdin)
aster verify ./my-policy.zip --recompile --probes --jwks export-jwks.json
aster inspect ./my-policy.zip --jwks export-jwks.json
aster compile ./my-policy.zip --out core.json                                # local Core IR, for drift diagnosis
aster version
node aster.mjs run ./my-policy.zip --input - < input.json                     # single-file runner
```

- stdout is always one line of canonical JSON (`{"meta":…,"ok":true,"value":…}` or an error envelope); diagnostics go to
  stderr. Exit codes: 0 ok, 1 `EVAL_ERROR` / `PROBE_MISMATCH`, 2 input or usage errors, 3 integrity and signature
  failures, 4 unsupported package / IR drift / compile errors, 5 `TIMEOUT` / `RESOURCE_EXHAUSTED`.
- Signatures are verified by default against the built-in trust anchor (empty until export keys are published);
  pass `--jwks <file|https-url>` or `--pubkey <file>`, or `--allow-unsigned` for unsigned packages.
- Evaluation runs in a worker thread with a `--timeout` (default `5s`, at most `300s`).
- Long values above 2⁵³ are printed as exact JSON integers; read `value` with a big-number JSON parser if you need them.
- The package format, exit codes and output envelopes are defined by aster-lang-test `conformance/package-v1/`.

## Multi-Language Support

Aster supports writing policies in multiple natural languages:

```typescript
import { canonicalize, lex, parse } from '@aster-cloud/aster-lang-ts';
import { ZH_CN } from '@aster-cloud/aster-lang-ts/lexicons/zh-CN';

const zhSource = `
模块 问候。

规则 问候 给定 姓名，产出：
  返回「你好，」 加 姓名。
`;

const tokens = lex(canonicalize(zhSource, ZH_CN), ZH_CN);
const ast = parse(tokens);
```

Supported languages:
- English (en-US) - Default
- Simplified Chinese (zh-CN)
- German (de-DE)

## Current CNL Style

- Type inference is the default; examples avoid explicit type annotations.
- Operator-call chaining is removed. Use standard calls or infix operators.
- Statements end with periods, and block headers end with colons.

## Documentation

- `docs/overview.md`
- `docs/cnl-syntax.md`
- `docs/type-inference.md`
- `docs/operator-call.md`
- `docs/examples.md`
- `docs/contributing.md`
- Localized docs:
- English (default): same list above.
- 简体中文: `docs/zh/overview.md`, `docs/zh/cnl-syntax.md`, `docs/zh/type-inference.md`, `docs/zh/operator-call.md`, `docs/zh/examples.md`, `docs/zh/contributing.md`
- Deutsch: `docs/de/overview.md`, `docs/de/cnl-syntax.md`, `docs/de/type-inference.md`, `docs/de/operator-call.md`, `docs/de/examples.md`, `docs/de/contributing.md`

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test:unit

# Start LSP server
pnpm lsp

# REPL
pnpm repl
```

## Project Structure

```
src/
  ├── canonicalizer.ts    # Source normalization
  ├── lexer.ts            # Tokenization
  ├── parser.ts           # AST generation
  ├── ast.ts              # AST definitions
  ├── lower_to_core.ts    # Core IR lowering
  ├── core_ir.ts          # Core IR definitions
  ├── typecheck/          # Type checker
  ├── lsp/                # Language Server Protocol
  └── config/
      └── lexicons/       # Multi-language lexicons
          ├── en-US.ts
          ├── zh-CN.ts
          └── de-DE.ts
```

## API Reference

### Core Exports

| Export | Description |
|--------|-------------|
| `canonicalize(source, lexicon?)` | Normalize CNL source |
| `lex(source, lexicon?)` | Tokenize source |
| `parse(tokens)` | Parse to AST |
| `parseSource(source, lexicon?, scopes?)` | Canonicalize, tokenize and parse |
| `resolveAndLowerChecked(ast, scopes?)` | Name resolution + lowering to Core IR; throws `NameResolutionError` on E8xx |
| `resolvePolicyTypes(source, options)` | Resolved Data/Enum declarations with original spellings |
| `typecheck(module)` | Type check module |

### Lexicon Exports

```typescript
import { EN_US } from '@aster-cloud/aster-lang-ts/lexicons/en-US';
import { ZH_CN } from '@aster-cloud/aster-lang-ts/lexicons/zh-CN';
import { DE_DE } from '@aster-cloud/aster-lang-ts/lexicons/de-DE';
```

## License

Apache-2.0 (see [LICENSE](LICENSE))
