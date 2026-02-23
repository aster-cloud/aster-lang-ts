# Aster Lang TypeScript Compiler

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
import { canonicalize, lex, parse, lowerModule } from '@aster-cloud/aster-lang-ts';

// Compile pipeline
const source = `
Module greeting.

Rule greet given name, produce:
  Return Text.concat("Hello, ", name).
`;

const canonical = canonicalize(source);
const tokens = lex(canonical);
const ast = parse(tokens);
const core = lowerModule(ast);
```

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
| `lowerModule(ast)` | Convert AST to Core IR |
| `typecheck(module)` | Type check module |

### Lexicon Exports

```typescript
import { EN_US } from '@aster-cloud/aster-lang-ts/lexicons/en-US';
import { ZH_CN } from '@aster-cloud/aster-lang-ts/lexicons/zh-CN';
import { DE_DE } from '@aster-cloud/aster-lang-ts/lexicons/de-DE';
```

## License

MIT
