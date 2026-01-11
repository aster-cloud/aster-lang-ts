# E2E Golden Testing Guide

## Overview

The E2E golden testing framework uses baseline comparison ("golden files") to verify the compiler's output across three phases:
- **AST**: Abstract Syntax Tree generation
- **Core IR**: Intermediate Representation lowering
- **Diagnostics**: Type checking and error detection

## Directory Structure

```
test/e2e/
├── golden/
│   ├── ast/                    # AST golden tests
│   │   ├── *.aster             # Source files
│   │   └── expected_*.ast.json # Expected AST output
│   ├── core/                   # Core IR golden tests
│   │   ├── *.aster             # Source files
│   │   └── expected_*_core.json # Expected Core IR output
│   └── diagnostics/            # Diagnostics golden tests
│       ├── *.aster             # Source files
│       └── expected_*.diag.txt # Expected diagnostic messages
└── runner/
    └── golden-runner.ts        # Test runner with dynamic discovery
```

## How It Works

### Dynamic Test Discovery

The test runner automatically discovers all test files in each category directory:

```typescript
function discoverGoldenTests(
  category: 'ast' | 'core' | 'diagnostics'
): Array<{ input: string; expected: string }>
```

For each `.aster` file, it looks for the corresponding expected output file:
- **AST**: `expected_{name}.ast.json`
- **Core**: `expected_{name}_core.json`
- **Diagnostics**: `expected_{name}.diag.txt`

### Test Execution

1. **AST Tests** (`runOneAst`):
   - Parse source file → Generate AST
   - Prune 'origin' fields
   - Compare with expected JSON

2. **Core IR Tests** (`runOneCore`):
   - Parse → Lower to Core IR
   - Prune 'start', 'end', 'origin', 'span' fields
   - Compare with expected JSON

3. **Diagnostics Tests** (`runOneTypecheck`):
   - Parse → Lower → Typecheck
   - Extract diagnostic messages
   - Compare with expected text

### Pruning Logic

Different test types require different pruning strategies:

```typescript
// AST: Only remove 'origin' (preserve span information)
function pruneAst(obj: any): any {
  // Removes: origin
  // Keeps: span (with start/end)
}

// Core IR: Remove all position metadata
function pruneCore(obj: any): any {
  // Removes: start, end, origin, span
}
```

## Running Tests

```bash
# Run all E2E golden tests
npm run test:e2e

# Build and run
npm run build && npm run test:e2e
```

### Expected Output

```
=== Running Diagnostics Tests (Dynamic Discovery) ===
Found 48 diagnostics tests
OK: TYPECHECK test/e2e/golden/diagnostics/eff_violation_chain.aster
...

=== Running Core IR Tests (Dynamic Discovery) ===
Found 41 core tests
OK: CORE test/e2e/golden/core/greet.aster
...

=== Running AST Tests (Dynamic Discovery) ===
Found 2 ast tests
OK: AST test/e2e/golden/ast/annotations_multiline.aster
...
```

## Adding New Tests

### 1. Create Source File

Place your `.aster` file in the appropriate directory:

```bash
# For a diagnostics test
echo 'fun bad() { nonexistent() }' > test/e2e/golden/diagnostics/my_test.aster
```

### 2. Generate Expected Output

#### For AST Tests:

```javascript
import fs from 'node:fs';
import { canonicalize, lex, parse } from './dist/src/index.js';

const src = fs.readFileSync('test/e2e/golden/ast/my_test.aster', 'utf8');
const ast = parse(lex(canonicalize(src)));

// Prune origin fields
function pruneAst(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(pruneAst);
  if (typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'origin') continue;
    out[k] = pruneAst(v);
  }
  return out;
}

fs.writeFileSync(
  'test/e2e/golden/ast/expected_my_test.ast.json',
  JSON.stringify(pruneAst(ast), null, 2) + '\n'
);
```

#### For Core IR Tests:

```javascript
import { lowerModule } from './dist/src/lower_to_core.js';

// ... (same parse steps as above)
const core = lowerModule(ast);

// Prune all position metadata
function pruneCore(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(pruneCore);
  if (typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'start' || k === 'end' || k === 'origin' || k === 'span') continue;
    out[k] = pruneCore(v);
  }
  return out;
}

fs.writeFileSync(
  'test/e2e/golden/core/expected_my_test_core.json',
  JSON.stringify(pruneCore(core), null, 2) + '\n'
);
```

#### For Diagnostics Tests:

```javascript
import { typecheckModule } from './dist/src/typecheck.js';

// ... (same parse and lower steps)
const diags = typecheckModule(core);

const lines = diags.map(d => `${formatSeverity(d.severity)}: ${d.message}`);

fs.writeFileSync(
  'test/e2e/golden/diagnostics/expected_my_test.diag.txt',
  lines.join('\n') + '\n'
);
```

### 3. Run Tests

```bash
npm run build
npm run test:e2e
```

The new test will be automatically discovered and executed!

## Test Statistics (as of 2025-10-22)

| Category | Tests | Passing | Status |
|----------|-------|---------|--------|
| Diagnostics | 48 | 48 | ✅ 100% |
| Core IR | 41 | 41 | ✅ 100% |
| AST | 2 | 2 | ✅ 100% |
| **Total** | **91** | **91** | **✅ 100%** |

## Troubleshooting

### Test fails with JSON mismatch

1. **Check pruning**: Ensure you're using the correct prune function for the test type
2. **Regenerate expected file**: Parser may have changed, use the generation scripts above
3. **Check span fields**: AST tests keep spans, Core IR tests remove them

### Expected file not found

The runner looks for specific naming patterns:
- AST: `expected_{basename}.ast.json`
- Core: `expected_{basename}_core.json`
- Diagnostics: `expected_{basename}.diag.txt`

Make sure your expected file follows this pattern.

### Test not discovered

1. Ensure `.aster` file is in the correct directory (`ast/`, `core/`, or `diagnostics/`)
2. Ensure expected file exists with correct naming
3. Run with verbose output: `npm run test:e2e 2>&1 | grep "Found"`

## Architecture Notes

### Why Split Prune Functions?

The parser generates `span` objects containing source position information (`start`, `end`). Different test types have different requirements:

- **AST tests**: Validate exact parse tree structure, including spans for error reporting
- **Core IR tests**: Validate semantic lowering, position info is irrelevant

Using separate prune functions ensures each test type gets the appropriate level of detail.

### Migration from test/cnl/examples/

All golden tests have been migrated from `test/cnl/examples/` to `test/e2e/golden/` as part of Phase 3 refactoring (Oct 2025). See `.claude/phase3.7-completion-report.md` for details.

## References

- Test runner implementation: `test/e2e/runner/golden-runner.ts`
- Migration reports: `.claude/phase3-*.md`
- Classification metadata: `.claude/golden-test-classification.json`
