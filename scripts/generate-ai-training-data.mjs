#!/usr/bin/env node

// 该脚本根据指定的 CNL 案例生成 AI 训练所需的 JSONL 数据集。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, 'test', 'ai-generation');

/**
 * @typedef {Object} CaseDefinition
 * @property {string} slug
 * @property {string} englishDescription
 * @property {"basic"|"effects"|"validation"|"security"|"complex"} category
 * @property {string[]} tags
 * @property {"easy"|"medium"|"hard"} difficulty
 * @property {{type:"file", path:string}|{type:"inline", cnl:string}} source
 */

/** @type {CaseDefinition[]} */
const sourceCases = [
  // 类型检查示例
  {
    slug: 'typecheck-basic-types',
    englishDescription: 'Show a helper that adds two integers and returns their sum.',
    category: 'basic',
    tags: ['basic_types', 'arithmetic'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/type-checker/golden/basic_types.aster' },
  },
  {
    slug: 'typecheck-generics-identity',
    englishDescription: 'Provide a generic identity function that simply returns whichever value it receives.',
    category: 'basic',
    tags: ['generics', 'function'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/type-checker/golden/generics.aster' },
  },
  {
    slug: 'typecheck-list-literal-mismatch',
    englishDescription: 'Illustrate a list literal that mixes integers and text, triggering a type mismatch.',
    category: 'validation',
    tags: ['list', 'type_error'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/type-checker/golden/list_literal_mismatch.aster' },
  },
  {
    slug: 'typecheck-type-mismatch-assign',
    englishDescription: 'Construct a record using an incorrect field type so the assignment fails validation.',
    category: 'validation',
    tags: ['records', 'type_error'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/type-checker/golden/type_mismatch_assign.aster' },
  },
  {
    slug: 'typecheck-return-type-mismatch',
    englishDescription: 'Return text from a function that promises an integer to demonstrate a return type mismatch.',
    category: 'validation',
    tags: ['functions', 'type_error'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/type-checker/golden/return_type_mismatch.aster' },
  },
  {
    slug: 'typecheck-workflow-type-mismatch',
    englishDescription: 'Show a workflow whose steps return inconsistent result variants, leading to a type error.',
    category: 'validation',
    tags: ['workflow', 'result'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/type-checker/golden/workflow-type-mismatch.aster' },
  },
  {
    slug: 'typecheck-workflow-missing-io',
    englishDescription: 'Define a workflow that performs IO but forgets to declare the effect capability.',
    category: 'effects',
    tags: ['workflow', 'io'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/type-checker/golden/workflow-missing-io.aster' },
  },
  {
    slug: 'typecheck-workflow-missing-compensate',
    englishDescription: 'Demonstrate a workflow with an IO step that never declares any compensation handler.',
    category: 'effects',
    tags: ['workflow', 'compensation'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/type-checker/golden/workflow-missing-compensate.aster' },
  },
  {
    slug: 'typecheck-workflow-compensate-new-cap',
    englishDescription: 'Highlight a workflow whose compensation block introduces a new capability not declared up front.',
    category: 'effects',
    tags: ['workflow', 'capability'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/type-checker/golden/workflow-compensate-new-cap.aster' },
  },
  {
    slug: 'typecheck-workflow-linear',
    englishDescription: 'Model a multi-step workflow with retries, compensations, and timeout policies.',
    category: 'complex',
    tags: ['workflow', 'retry', 'timeout'],
    difficulty: 'hard',
    source: { type: 'file', path: 'test/type-checker/golden/workflow-linear.aster' },
  },
  {
    slug: 'typecheck-workflow-timeout-short',
    englishDescription: 'Show a workflow whose timeout is shorter than supported to trigger validation errors.',
    category: 'validation',
    tags: ['workflow', 'timeout'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/type-checker/golden/workflow_timeout_too_short.aster' },
  },
  {
    slug: 'typecheck-workflow-timeout-long',
    englishDescription: 'Set a workflow timeout that far exceeds the allowed maximum to produce diagnostics.',
    category: 'validation',
    tags: ['workflow', 'timeout'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/type-checker/golden/workflow_timeout_too_long.aster' },
  },
  {
    slug: 'typecheck-workflow-retry-many',
    englishDescription: 'Configure a workflow with an excessive retry limit and linear backoff.',
    category: 'validation',
    tags: ['workflow', 'retry'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/type-checker/golden/workflow_retry_many_attempts.aster' },
  },
  {
    slug: 'typecheck-workflow-retry-exponential',
    englishDescription: 'Demonstrate acceptable workflow retry settings using exponential backoff.',
    category: 'effects',
    tags: ['workflow', 'retry'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/type-checker/golden/workflow_retry_exponential.aster' },
  },
  {
    slug: 'typecheck-workflow-retry-timeout-conflict',
    englishDescription: 'Illustrate a workflow whose retry policy conflicts with an overly small timeout.',
    category: 'validation',
    tags: ['workflow', 'retry', 'timeout'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/type-checker/golden/workflow_retry_timeout_conflict.aster' },
  },
  {
    slug: 'typecheck-workflow-undeclared-capability',
    englishDescription: 'Show a workflow step that uses a secrets capability without declaring it.',
    category: 'effects',
    tags: ['workflow', 'capability'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/type-checker/golden/workflow-undeclared-capability.aster' },
  },
  {
    slug: 'typecheck-effect-missing-io',
    englishDescription: 'Call an HTTP function without granting IO capabilities to highlight effect enforcement.',
    category: 'effects',
    tags: ['effects', 'http'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/type-checker/golden/effect_missing_io.aster' },
  },
  {
    slug: 'typecheck-effect-missing-cpu',
    englishDescription: 'Hash text without declaring the required CPU capability.',
    category: 'effects',
    tags: ['effects', 'cpu'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/type-checker/golden/effect_missing_cpu.aster' },
  },
  {
    slug: 'typecheck-effect-var-basic',
    englishDescription: 'Use an effect-polymorphic identity helper to show capability variables in action.',
    category: 'effects',
    tags: ['effects', 'polymorphism'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/type-checker/golden/effect_var_basic.aster' },
  },
  {
    slug: 'typecheck-lambda-with-effects',
    englishDescription: 'Capture effectful functions inside a lambda and reuse them to fetch HTTP data.',
    category: 'effects',
    tags: ['lambda', 'http'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/type-checker/golden/lambda_with_effects.aster' },
  },
  {
    slug: 'typecheck-async-missing-wait',
    englishDescription: 'Start an asynchronous task without awaiting the result to demonstrate async validation.',
    category: 'effects',
    tags: ['async', 'workflow'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/type-checker/golden/async_missing_wait.aster' },
  },
  {
    slug: 'typecheck-async-duplicate-start',
    englishDescription: 'Launch two async operations bound to the same handle to show duplicate start errors.',
    category: 'effects',
    tags: ['async', 'concurrency'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/type-checker/golden/async_duplicate_start.aster' },
  },
  {
    slug: 'typecheck-async-duplicate-wait',
    englishDescription: 'Wait twice on the same async handle to trigger duplicate wait diagnostics.',
    category: 'effects',
    tags: ['async', 'concurrency'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/type-checker/golden/async_duplicate_wait.aster' },
  },
  {
    slug: 'typecheck-async-wait-not-started',
    englishDescription: 'Attempt to wait on an async handle that was never started.',
    category: 'effects',
    tags: ['async', 'concurrency'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/type-checker/golden/async_wait_not_started.aster' },
  },
  {
    slug: 'typecheck-payment-capability-success',
    englishDescription: 'Show valid usage of the Payment capability for charge and refund helpers.',
    category: 'effects',
    tags: ['capability', 'payment'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/type-checker/golden/payment_capability_success.aster' },
  },
  {
    slug: 'typecheck-payment-capability-missing-io',
    englishDescription: 'Call the Payment API without declaring IO, resulting in a capability violation.',
    category: 'effects',
    tags: ['capability', 'payment'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/type-checker/golden/payment_capability_missing_io.aster' },
  },
  {
    slug: 'typecheck-inventory-capability-success',
    englishDescription: 'Reserve and release inventory with the correct capability declarations.',
    category: 'effects',
    tags: ['capability', 'inventory'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/type-checker/golden/inventory_capability_success.aster' },
  },
  {
    slug: 'typecheck-inventory-capability-missing-io',
    englishDescription: 'Use the Inventory capability without IO permissions to trigger an error.',
    category: 'effects',
    tags: ['capability', 'inventory'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/type-checker/golden/inventory_capability_missing_io.aster' },
  },
  {
    slug: 'typecheck-pii-http-violation',
    englishDescription: 'Send tagged PII data over HTTP to demonstrate privacy enforcement.',
    category: 'security',
    tags: ['pii', 'http'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/type-checker/golden/pii_http_violation.aster' },
  },
  {
    slug: 'typecheck-module-a',
    englishDescription: 'Fetch data over HTTP inside a simple helper module.',
    category: 'effects',
    tags: ['module', 'http'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/type-checker/golden/module_a.aster' },
  },
  {
    slug: 'typecheck-module-b',
    englishDescription: 'Import another module and call its IO function to relay the fetched data.',
    category: 'effects',
    tags: ['module', 'http'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/type-checker/golden/module_b.aster' },
  },
  {
    slug: 'typecheck-with-external-package',
    englishDescription: 'Call into an external package that performs IO to show capability propagation.',
    category: 'effects',
    tags: ['module', 'io'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/type-checker/golden/with_external_package.aster' },
  },
  // 效果系统诊断示例
  {
    slug: 'diag-eff-alias-import',
    englishDescription: 'Demonstrate capability alias imports by renaming HTTP, database, and time modules while issuing calls through both names.',
    category: 'effects',
    tags: ['effects', 'alias', 'capability'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/eff_alias_import.aster' },
  },
  {
    slug: 'diag-eff-alias-unmapped',
    englishDescription: 'Show what happens when code calls an alias that was never mapped to a real capability.',
    category: 'effects',
    tags: ['effects', 'alias', 'error'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/eff_alias_unmapped.aster' },
  },
  {
    slug: 'diag-eff-valid-http-sql',
    englishDescription: 'Declare both HTTP and SQL capabilities so a helper can fetch data and persist it safely.',
    category: 'effects',
    tags: ['http', 'sql', 'capability'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/eff_valid_http_sql.aster' },
  },
  {
    slug: 'diag-eff-valid-nested',
    englishDescription: 'Propagate nested IO requirements from leaf calls up through intermediate and root helpers.',
    category: 'effects',
    tags: ['nesting', 'io', 'capability'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/eff_valid_nested.aster' },
  },
  {
    slug: 'diag-eff-viol-cpu-calls-io',
    englishDescription: 'Illustrate a CPU-only declaration that still reaches out to IO, triggering enforcement errors.',
    category: 'effects',
    tags: ['violation', 'cpu', 'io'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/eff_violation_cpu_calls_io.aster' },
  },
  {
    slug: 'diag-eff-viol-http-calls-sql',
    englishDescription: 'Call SQL APIs from a function that only requested HTTP to show capability drift.',
    category: 'effects',
    tags: ['violation', 'http', 'sql'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/eff_violation_http_calls_sql.aster' },
  },
  {
    slug: 'diag-eff-viol-sql-calls-files',
    englishDescription: 'Perform file IO inside a SQL-only function to raise enforcement diagnostics.',
    category: 'effects',
    tags: ['violation', 'sql', 'file'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/eff_violation_sql_calls_files.aster' },
  },
  {
    slug: 'diag-eff-viol-files-calls-secrets',
    englishDescription: 'Use the Secrets capability without declaring it inside a file-only handler.',
    category: 'effects',
    tags: ['violation', 'files', 'secrets'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/eff_violation_files_calls_secrets.aster' },
  },
  {
    slug: 'diag-eff-viol-nested-a',
    englishDescription: 'Demonstrate nested helpers where a deeper call uses extra capabilities the root never declared.',
    category: 'effects',
    tags: ['violation', 'nesting'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/eff_violation_nested_a.aster' },
  },
  {
    slug: 'diag-eff-viol-nested-b',
    englishDescription: 'Continue the nested enforcement scenario with a different branch calling forbidden capabilities.',
    category: 'effects',
    tags: ['violation', 'nesting'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/eff_violation_nested_b.aster' },
  },
  {
    slug: 'diag-eff-viol-missing-http',
    englishDescription: 'Forget to include HTTP in the declared capability list while issuing network calls.',
    category: 'effects',
    tags: ['violation', 'http'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/eff_violation_missing_http.aster' },
  },
  {
    slug: 'diag-eff-viol-missing-sql',
    englishDescription: 'Trigger diagnostics by writing to SQL from a function that never requested that capability.',
    category: 'effects',
    tags: ['violation', 'sql'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/eff_violation_missing_sql.aster' },
  },
  {
    slug: 'diag-eff-viol-missing-time',
    englishDescription: 'Call time utilities without listing the Time capability.',
    category: 'effects',
    tags: ['violation', 'time'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/eff_violation_missing_time.aster' },
  },
  {
    slug: 'diag-eff-viol-transitive',
    englishDescription: 'Highlight transitive capability leaks where a helper delegates to another module that uses extra effects.',
    category: 'effects',
    tags: ['violation', 'transitive'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/eff_violation_transitive.aster' },
  },
  {
    slug: 'diag-eff-viol-multiple',
    englishDescription: 'Aggregate several capability mistakes inside one function to produce multiple diagnostics.',
    category: 'effects',
    tags: ['violation', 'multi_error'],
    difficulty: 'hard',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/eff_violation_multiple_errors.aster' },
  },
  {
    slug: 'diag-eff-infer-transitive',
    englishDescription: 'Exercise effect inference across multiple helper layers to ensure capabilities are propagated.',
    category: 'effects',
    tags: ['inference', 'transitive'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/eff_infer_transitive.aster' },
  },
  {
    slug: 'diag-eff-infer-wrapper-cpu',
    englishDescription: 'Wrap CPU-only helpers and let inference prove no IO is required.',
    category: 'effects',
    tags: ['inference', 'cpu'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/eff_infer_wrapper_cpu.aster' },
  },
  {
    slug: 'diag-eff-caps-missing-secrets',
    englishDescription: 'Enforce explicit Secrets declarations when parsing capability brackets.',
    category: 'effects',
    tags: ['capability', 'enforcement'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/eff_caps_enforce_missing_secrets.aster' },
  },
  // PII 与安全示例
  {
    slug: 'diag-pii-http-safe',
    englishDescription: 'Store plain text email data to illustrate a safe path that carries no PII tags.',
    category: 'security',
    tags: ['pii', 'safe_path'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/pii_http_safe.aster' },
  },
  {
    slug: 'diag-pii-propagation',
    englishDescription: 'Propagate tagged user data into an HTTP POST to demonstrate privacy violations.',
    category: 'security',
    tags: ['pii', 'http'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/pii_propagation.aster' },
  },
  {
    slug: 'diag-pii-function-return',
    englishDescription: 'Return an email value from a helper and immediately send it over HTTP.',
    category: 'security',
    tags: ['pii', 'http'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/pii_function_return.aster' },
  },
  {
    slug: 'diag-pii-nested-call',
    englishDescription: 'Format SSNs and upload the string through nested helpers to surface data lineage.',
    category: 'security',
    tags: ['pii', 'http', 'nesting'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/e2e/golden/diagnostics/pii_nested_call.aster' },
  },
  // CNL 程序示例
  {
    slug: 'cnl-collections-list-ops',
    englishDescription: 'Provide helpers for list length, indexed lookup, and emptiness checks over text lists.',
    category: 'basic',
    tags: ['collections', 'list'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/cnl/programs/collections/list_ops.aster' },
  },
  {
    slug: 'cnl-lambda-mixed',
    englishDescription: 'Build nested lambdas that concatenate strings and compare integers.',
    category: 'basic',
    tags: ['lambda', 'text', 'comparison'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/cnl/programs/lambda/lambda_cnl_mixed.aster' },
  },
  {
    slug: 'cnl-eligibility-full',
    englishDescription: 'Model a full eligibility flow with multiple data types and helper functions for minors and seniors.',
    category: 'complex',
    tags: ['eligibility', 'healthcare'],
    difficulty: 'hard',
    source: { type: 'file', path: 'test/cnl/programs/regression/eligibility/test_eligibility_full.aster' },
  },
  {
    slug: 'cnl-eligibility-with-ifs',
    englishDescription: 'Compose several nested IF rules to determine coverage percentages and patient cost.',
    category: 'complex',
    tags: ['eligibility', 'branching'],
    difficulty: 'hard',
    source: { type: 'file', path: 'test/cnl/programs/regression/eligibility/test_eligibility_with_ifs.aster' },
  },
  {
    slug: 'cnl-eligibility-complex-return',
    englishDescription: 'Return structured eligibility decisions depending on age, showcasing record construction.',
    category: 'complex',
    tags: ['eligibility', 'records'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/cnl/programs/regression/eligibility/test_complex_return.aster' },
  },
  {
    slug: 'cnl-eligibility-struct-basic',
    englishDescription: 'Handle simple insurance checks by toggling coverage fields based on a patient record.',
    category: 'complex',
    tags: ['eligibility', 'records'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/cnl/programs/regression/eligibility/test_eligibility_struct.aster' },
  },
  {
    slug: 'cnl-loan-full-test',
    englishDescription: 'Evaluate loan applications by checking age, credit score, and computing rate ladders.',
    category: 'complex',
    tags: ['finance', 'loan'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/cnl/programs/business/finance/loan_full_test.aster' },
  },
  {
    slug: 'cnl-policy-engine',
    englishDescription: 'Define enums and helper rules to evaluate whether a user may access a resource.',
    category: 'complex',
    tags: ['policy', 'access_control'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/cnl/programs/business/policy/policy_engine.aster' },
  },
  {
    slug: 'cnl-rules-engine',
    englishDescription: 'Build a general-purpose business rules engine with condition evaluation and actions.',
    category: 'complex',
    tags: ['rules', 'engine'],
    difficulty: 'hard',
    source: { type: 'file', path: 'test/cnl/programs/business/rules_engine.aster' },
  },
  {
    slug: 'cnl-async-fetch-dashboard',
    englishDescription: 'Launch async profile and timeline fetches, wait for both, and return a combined dashboard.',
    category: 'effects',
    tags: ['async', 'result'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/cnl/programs/async/fetch_dashboard.aster' },
  },
  {
    slug: 'cnl-finance-fraud',
    englishDescription: 'Score transactions against account history to flag risky behavior.',
    category: 'complex',
    tags: ['finance', 'fraud'],
    difficulty: 'medium',
    source: { type: 'file', path: 'test/cnl/programs/library/finance/fraud.aster' },
  },
  {
    slug: 'cnl-patterns-enum-exhaustive',
    englishDescription: 'Pattern match over an enum without covering every variant to highlight exhaustiveness.',
    category: 'validation',
    tags: ['pattern_matching', 'enum'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/cnl/programs/patterns/enum_exhaustiveness.aster' },
  },
  {
    slug: 'cnl-interop-cli-tool',
    englishDescription: 'Offer simple CLI helpers for greeting users, adding punctuation, and measuring text length.',
    category: 'basic',
    tags: ['interop', 'text'],
    difficulty: 'easy',
    source: { type: 'file', path: 'test/cnl/programs/integration/interop/cli_tool.aster' },
  },
];

/** @type {CaseDefinition[]} */
const newCases = [
  // 基础函数案例
  {
    slug: 'new-basic-max-of-three',
    englishDescription: 'Compute the maximum of three integers using nested comparisons.',
    category: 'basic',
    tags: ['arithmetic', 'comparison'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case1.

Rule maxOfThree given a as Int, b as Int, c as Int, produce Int:
  If a greater than b:
    If a greater than c:
      Return a.
  If b greater than c:
    Return b.
  Return c.`,
    },
  },
  {
    slug: 'new-basic-clamp-rating',
    englishDescription: 'Clamp a rating so it always stays between zero and five.',
    category: 'basic',
    tags: ['validation', 'numbers'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case2.

Rule clampRating given value as Int, produce Int:
  If value less than 0:
    Return 0.
  If value greater than 5:
    Return 5.
  Return value.`,
    },
  },
  {
    slug: 'new-basic-full-name',
    englishDescription: 'Join a first and last name with a single space.',
    category: 'basic',
    tags: ['text', 'formatting'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case3.

Rule fullName given first as Text, last as Text, produce Text:
  Let firstPart be Text.concat(first, " ").
  Return Text.concat(firstPart, last).`,
    },
  },
  {
    slug: 'new-basic-count-nonempty',
    englishDescription: 'Count how many strings in a list are not empty.',
    category: 'basic',
    tags: ['recursion', 'list'],
    difficulty: 'medium',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case4.

Rule countNonEmpty given values as List of Text, produce Int:
  If List.isEmpty(values),:
    Return 0.
  Let head be List.head(values).
  Let tail be List.tail(values).
  Let remainder be countNonEmpty(tail).
  If Text.equals(head, ""),:
    Return remainder.
  Return 1 plus remainder.`,
    },
  },
  {
    slug: 'new-basic-apply-discount',
    englishDescription: 'Subtract a fixed discount from a price but never go below zero.',
    category: 'basic',
    tags: ['pricing', 'arithmetic'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case5.

Rule applyDiscount given price as Int, discount as Int, produce Int:
  Let result be price minus discount.
  If result less than 0,:
    Return 0.
  Return result.`,
    },
  },
  {
    slug: 'new-basic-total-duration',
    englishDescription: 'Sum preparation, task, and cleanup durations into a total.',
    category: 'basic',
    tags: ['arithmetic', 'time'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case6.

Rule totalDuration given prep as Int, task as Int, cleanup as Int, produce Int:
  Let partial be prep plus task.
  Return partial plus cleanup.`,
    },
  },
  {
    slug: 'new-basic-tagged-message',
    englishDescription: 'Prepend a bracketed tag in front of a log message.',
    category: 'basic',
    tags: ['text', 'formatting'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case7.

Rule taggedMessage given tag as Text, body as Text, produce Text:
  Let bracket be Text.concat("[", tag).
  Let label be Text.concat(bracket, "] ").
  Return Text.concat(label, body).`,
    },
  },
  {
    slug: 'new-basic-choose-tier',
    englishDescription: 'Map a numeric score into gold, silver, bronze, or basic tiers.',
    category: 'basic',
    tags: ['branching', 'scoring'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case8.

Rule chooseTier given score as Int, produce Text:
  If score at least 90,:
    Return "gold".
  If score at least 75,:
    Return "silver".
  If score at least 60,:
    Return "bronze".
  Return "basic".`,
    },
  },
  {
    slug: 'new-basic-extract-domain',
    englishDescription: 'Split an email address to return its domain or an empty string.',
    category: 'basic',
    tags: ['text', 'parsing'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case9.

Rule extractDomain given email as Text, produce Text:
  If not Text.contains(email, "@"),:
    Return "".
  Let parts be Text.split(email, "@").
  Return List.get(parts, 1).`,
    },
  },
  {
    slug: 'new-basic-keywords-line',
    englishDescription: 'Join keywords into a comma separated line, falling back to an empty string.',
    category: 'basic',
    tags: ['text', 'list'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case10.

Rule keywordsLine given keywords as List of Text, produce Text:
  If List.isEmpty(keywords),:
    Return "".
  Return Text.join(",", keywords).`,
    },
  },
  {
    slug: 'new-basic-loyalty-points',
    englishDescription: 'Multiply purchases by a multiplier to award loyalty points.',
    category: 'basic',
    tags: ['arithmetic', 'loyalty'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case11.

Rule loyaltyPoints given purchases as Int, multiplier as Int, produce Int:
  Return purchases times multiplier.`,
    },
  },
  {
    slug: 'new-basic-sum-clicks',
    englishDescription: 'Add up three daily click counters to get a total.',
    category: 'basic',
    tags: ['arithmetic', 'aggregation'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case12.

Rule sumClicks given day1 as Int, day2 as Int, day3 as Int, produce Int:
  Let firstTwo be day1 plus day2.
  Return firstTwo plus day3.`,
    },
  },
  // 校验案例
  {
    slug: 'new-validation-score-range',
    englishDescription: 'Validate that a credit score stays within the 300-850 range.',
    category: 'validation',
    tags: ['range', 'score'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case13.

Rule isScoreValid given score as Int, produce Bool:
  If score less than 300,:
    Return false.
  If score greater than 850,:
    Return false.
  Return true.`,
    },
  },
  {
    slug: 'new-validation-required-name',
    englishDescription: 'Ensure a required text field is not empty.',
    category: 'validation',
    tags: ['text', 'required'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case14.

Rule hasName given value as Text, produce Bool:
  If Text.equals(value, ""),:
    Return false.
  Return true.`,
    },
  },
  {
    slug: 'new-validation-order-limit',
    englishDescription: 'Reject orders whose amount exceeds a provided limit.',
    category: 'validation',
    tags: ['limits', 'orders'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case15.

Rule isWithinLimit given amount as Int, limit as Int, produce Bool:
  If amount greater than limit,:
    Return false.
  Return true.`,
    },
  },
  {
    slug: 'new-validation-date-window',
    englishDescription: 'Check that a start timestamp never falls after its end timestamp.',
    category: 'validation',
    tags: ['time', 'ordering'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case16.

Rule hasValidWindow given startTs as Int, endTs as Int, produce Bool:
  If startTs greater than endTs,:
    Return false.
  Return true.`,
    },
  },
  {
    slug: 'new-validation-allowed-country',
    englishDescription: 'Accept only a short allowlist of country codes.',
    category: 'validation',
    tags: ['allowlist', 'text'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case17.

Rule isAllowedCountry given code as Text, produce Bool:
  If Text.equals(code, "US"),:
    Return true.
  If Text.equals(code, "NZ"),:
    Return true.
  If Text.equals(code, "AU"),:
    Return true.
  Return false.`,
    },
  },
  {
    slug: 'new-validation-consistent-total',
    englishDescription: 'Verify that subtotal plus tax equals the reported total.',
    category: 'validation',
    tags: ['arithmetic', 'consistency'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case18.

Rule isConsistentTotal given subtotal as Int, tax as Int, total as Int, produce Bool:
  Let computed be subtotal plus tax.
  If computed equals to total,:
    Return true.
  Return false.`,
    },
  },
  // 效果系统新案例
  {
    slug: 'new-effects-audit-log',
    englishDescription: 'Insert an audit row into SQL and notify an HTTP endpoint.',
    category: 'effects',
    tags: ['sql', 'http', 'audit'],
    difficulty: 'medium',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case19.

Rule logAudit given event as Text, produce Text. It performs io [Sql, Http]:
  Let saved be Sql.insert("audit_log", event).
  Return Http.post("/notify", saved).`,
    },
  },
  {
    slug: 'new-effects-fetch-fallback',
    englishDescription: 'Fetch from HTTP and fall back to a default endpoint if the body is empty.',
    category: 'effects',
    tags: ['http', 'fallback'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case20.

Rule fetchWithFallback given url as Text, produce Text. It performs io [Http]:
  Let primary be Http.get(url).
  If Text.equals(primary, ""),:
    Return Http.get("/fallback").
  Return primary.`,
    },
  },
  {
    slug: 'new-effects-async-profile',
    englishDescription: 'Start two async calls (profile and timeline) and concatenate their results.',
    category: 'effects',
    tags: ['async', 'http'],
    difficulty: 'medium',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case21.

Rule fetchProfilePage given userId as Text, produce Text. It performs io:
  Start profile as async ProfileSvc.load(userId).
  Start timeline as async FeedSvc.timeline(userId).
  Wait for profile and timeline.
  Return Text.concat(profile, timeline).`,
    },
  },
  {
    slug: 'new-effects-rotate-secret',
    englishDescription: 'Rotate a secret and return a labeled string.',
    category: 'effects',
    tags: ['secrets', 'capability'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case22.

Rule rotateSecretAndLabel given key as Text, produce Text. It performs io [Secrets]:
  Let token be Secrets.rotate(key).
  Return Text.concat("rotated:", token).`,
    },
  },
  {
    slug: 'new-effects-timestamped-ping',
    englishDescription: 'Call Time.now and HTTP ping to build a timestamped heartbeat.',
    category: 'effects',
    tags: ['time', 'http'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case23.

Rule timestampedPing, produce Text. It performs io [Time, Http]:
  Let ts be Time.now().
  Let resp be Http.get("/ping").
  Let prefix be Text.concat(ts, ": ").
  Return Text.concat(prefix, resp).`,
    },
  },
  {
    slug: 'new-effects-upload-report',
    englishDescription: 'Upload a report over HTTP and return Result-based errors for forbidden or timeout responses.',
    category: 'effects',
    tags: ['http', 'result'],
    difficulty: 'medium',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case24.

Define UploadErr as one of Timeout or Forbidden.

Rule uploadReport given body as Text, produce Result of Text and UploadErr. It performs io [Http]:
  Let resp be Http.post("/reports", body).
  If Text.equals(resp, "timeout"),:
    Return err of Timeout.
  If Text.equals(resp, "403"),:
    Return err of Forbidden.
  Return ok of resp.`,
    },
  },
  {
    slug: 'new-effects-order-workflow',
    englishDescription: 'Define a workflow that reserves an order in SQL then notifies an HTTP endpoint.',
    category: 'effects',
    tags: ['workflow', 'http', 'sql'],
    difficulty: 'hard',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case25.

Rule approveOrderWorkflow given orderId as Text, produce Workflow of Result of Text and Text and IO. It performs io [Http, Sql]:
  
  workflow:
    step reserve:
      Let record be Sql.insert("orders", orderId).
      Return ok of record.
    compensate:
      Return err of "reserve_failed".

    step confirm:
      Return ok of Http.post("/orders/confirm", orderId).

    retry:
      max attempts: 2.
      backoff: linear.

    timeout: 60 seconds.
  
  .`,
    },
  },
  {
    slug: 'new-effects-refresh-token',
    englishDescription: 'Rotate a client secret and immediately call an HTTP endpoint to refresh access.',
    category: 'effects',
    tags: ['secrets', 'http'],
    difficulty: 'medium',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case26.

Rule refreshAccessToken given clientId as Text, produce Text. It performs io [Secrets, Http]:
  Let rotated be Secrets.rotate(clientId).
  Let payload be Text.concat("token=", rotated).
  Return Http.post("/oauth/refresh", payload).`,
    },
  },
  // 安全案例
  {
    slug: 'new-security-mask-ssn',
    englishDescription: 'Mask an SSN-tagged field by returning a fixed placeholder.',
    category: 'security',
    tags: ['pii', 'masking'],
    difficulty: 'easy',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case27.

Rule maskSsn given value as @pii(L3, ssn) Text, produce Text:
  Return "****-****".`,
    },
  },
  {
    slug: 'new-security-share-profile',
    englishDescription: 'Send an email address tagged as PII over HTTP (intentional violation).',
    category: 'security',
    tags: ['pii', 'http'],
    difficulty: 'medium',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case28.

Rule shareProfile given email as @pii(L2, email) Text, produce Text. It performs io [Http]:
  Return Http.post("/profiles/share", email).`,
    },
  },
  {
    slug: 'new-security-anonymize-email',
    englishDescription: 'Strip the user portion from a PII-tagged email and only keep the domain.',
    category: 'security',
    tags: ['pii', 'anonymize'],
    difficulty: 'medium',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case29.

Rule anonymizeEmail given value as @pii(L2, email) Text, produce Text:
  If not Text.contains(value, "@"),:
    Return "invalid".
  Let parts be Text.split(value, "@").
  Let domain be List.get(parts, 1).
  Return Text.concat("***@", domain).`,
    },
  },
  {
    slug: 'new-security-maybe-send-email',
    englishDescription: 'Only send PII over HTTP when flagged as non-sensitive, otherwise block it.',
    category: 'security',
    tags: ['pii', 'http', 'policy'],
    difficulty: 'medium',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case30.

Rule maybeSendEmail given isSensitive as Bool, email as @pii(L2, email) Text, produce Text. It performs io [Http]:
  If isSensitive,:
    Return "blocked".
  Return Http.post("/mail/send", email).`,
    },
  },
  {
    slug: 'new-security-hash-id',
    englishDescription: 'Hash a PII identifier using the CPU capability before storage.',
    category: 'security',
    tags: ['pii', 'cpu'],
    difficulty: 'medium',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case31.

Rule hashIdentifier given value as @pii(L2, id) Text, produce Text. It performs io [Cpu]:
  Return Cpu.hash(value).`,
    },
  },
  // 复杂逻辑案例
  {
    slug: 'new-complex-loan-review',
    englishDescription: 'Score a loan request by checking credit score, debt ratio, and assigning a rate.',
    category: 'complex',
    tags: ['finance', 'loan', 'rules'],
    difficulty: 'medium',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case32.

Define LoanRequest has applicantId as Text, amount as Int, income as Int, creditScore as Int.

Define LoanDecision has approved as Bool, reason as Text, rate as Int.

Rule scoreLoan given request as LoanRequest, produce LoanDecision:
  If request.creditScore less than 620,:
    Return LoanDecision with approved set to false, reason set to "Low credit", rate set to 0.
  If request.amount greater than (request.income times 4),:
    Return LoanDecision with approved set to false, reason set to "Debt ratio", rate set to 0.
  If request.creditScore at least 760,:
    Return LoanDecision with approved set to true, reason set to "Prime", rate set to 4.
  If request.creditScore at least 700,:
    Return LoanDecision with approved set to true, reason set to "Preferred", rate set to 6.
  Return LoanDecision with approved set to true, reason set to "Standard", rate set to 8.`,
    },
  },
  {
    slug: 'new-complex-order-routing',
    englishDescription: 'Choose a fulfillment warehouse based on region, amount, and expedited flag.',
    category: 'complex',
    tags: ['routing', 'orders'],
    difficulty: 'medium',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case33.

Define Order has region as Text, amount as Int, expedited as Bool.

Define RouteDecision has warehouse as Text, expedite as Bool.

Rule chooseRoute given order as Order, produce RouteDecision:
  If order.expedited,:
    Return RouteDecision with warehouse set to "EXPRESS", expedite set to true.
  If Text.equals(order.region, "EU"),:
    Return RouteDecision with warehouse set to "BERLIN", expedite set to false.
  If Text.equals(order.region, "APAC"),:
    Return RouteDecision with warehouse set to "SINGAPORE", expedite set to false.
  If order.amount greater than 10000,:
    Return RouteDecision with warehouse set to "CENTRAL", expedite set to false.
  Return RouteDecision with warehouse set to "LOCAL", expedite set to false.`,
    },
  },
  {
    slug: 'new-complex-support-priority',
    englishDescription: 'Assign support tickets to queues based on severity and customer tier.',
    category: 'complex',
    tags: ['support', 'routing'],
    difficulty: 'medium',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case34.

Define Ticket has severity as Int, product as Text, customerTier as Text.

Define Assignment has queue as Text, priority as Int.

Rule assignTicket given ticket as Ticket, produce Assignment:
  If ticket.severity at least 90,:
    Return Assignment with queue set to "CRITICAL", priority set to 1.
  If Text.equals(ticket.customerTier, "platinum"),:
    Return Assignment with queue set to "VIP", priority set to 2.
  If Text.equals(ticket.product, "payments"),:
    Return Assignment with queue set to "FINANCE", priority set to 3.
  Return Assignment with queue set to "STANDARD", priority set to 4.`,
    },
  },
  {
    slug: 'new-complex-batch-metrics',
    englishDescription: 'Aggregate total and count from a list of integers using recursion.',
    category: 'complex',
    tags: ['recursion', 'aggregation'],
    difficulty: 'hard',
    source: {
      type: 'inline',
      cnl: `Module ai.generated.case35.

Define Metrics has total as Int, count as Int.

Rule aggregateMetrics given values as List of Int, produce Metrics:
  If List.isEmpty(values),:
    Return Metrics with total set to 0, count set to 0.
  Let head be List.head(values).
  Let tail be List.tail(values).
  Let rest be aggregateMetrics(tail).
  Let newTotal be head plus rest.total.
  Let newCount be 1 plus rest.count.
  Return Metrics with total set to newTotal, count set to newCount.`,
    },
  },
];

const cases = [...sourceCases, ...newCases];

if (cases.length === 0) {
  throw new Error('尚未定义任何案例，无法生成数据集');
}

const preparedCases = cases.map((entry) => {
  let cnlCode = '';
  if (entry.source.type === 'file') {
    const filePath = path.join(repoRoot, entry.source.path);
    cnlCode = fs.readFileSync(filePath, 'utf8').trim();
  } else {
    cnlCode = entry.source.cnl.trim();
  }
  return {
    slug: entry.slug,
    english_description: entry.englishDescription,
    category: entry.category,
    tags: entry.tags,
    difficulty: entry.difficulty,
    cnl_code: cnlCode,
  };
});

const hashedCases = preparedCases.sort((a, b) => {
  const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
  return hash(a.slug).localeCompare(hash(b.slug));
});

const TOTAL_RANGE = { min: 100, max: 110 };
const TARGET_RATIOS = { train: 0.7, dev: 0.15, eval: 0.15 };
const COUNT_LIMITS = {
  train: { min: 60, max: 70 },
  dev: { min: 15, max: 20 },
  eval: { min: 15, max: 20 },
};

const total = hashedCases.length;
if (total < TOTAL_RANGE.min || total > TOTAL_RANGE.max) {
  throw new Error(`案例总量需保持在 ${TOTAL_RANGE.min}-${TOTAL_RANGE.max} 条之间，当前为 ${total} 条。`);
}

const pickSplit = (caseCount) => {
  const candidates = [];
  for (let train = COUNT_LIMITS.train.min; train <= COUNT_LIMITS.train.max; train += 1) {
    for (let dev = COUNT_LIMITS.dev.min; dev <= COUNT_LIMITS.dev.max; dev += 1) {
      const evalCount = caseCount - train - dev;
      if (evalCount < COUNT_LIMITS.eval.min || evalCount > COUNT_LIMITS.eval.max) {
        continue;
      }
      const ratioTrain = train / caseCount;
      const ratioDev = dev / caseCount;
      const ratioEval = evalCount / caseCount;
      const score =
        Math.abs(ratioTrain - TARGET_RATIOS.train) +
        Math.abs(ratioDev - TARGET_RATIOS.dev) +
        Math.abs(ratioEval - TARGET_RATIOS.eval);
      candidates.push({ train, dev, evalCount, score });
    }
  }
  if (candidates.length === 0) {
    throw new Error('无法在当前案例数量下满足拆分约束，请调整案例列表。');
  }
  candidates.sort((a, b) => {
    if (a.score === b.score) {
      return b.train - a.train;
    }
    return a.score - b.score;
  });
  return candidates[0];
};

const { train: trainCount, dev: devCount, evalCount } = pickSplit(total);

const splits = [
  { name: 'train', count: trainCount },
  { name: 'dev', count: devCount },
  { name: 'eval', count: evalCount },
];

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

let cursor = 0;
for (const split of splits) {
  const subset = hashedCases.slice(cursor, cursor + split.count);
  cursor += split.count;
  const filePath = path.join(outputDir, `${split.name}.jsonl`);
  const lines = subset.map((item, index) => {
    const idSuffix = String(index + 1).padStart(3, '0');
    return JSON.stringify({
      id: `${split.name}-${idSuffix}`,
      english_description: item.english_description,
      cnl_code: item.cnl_code,
      category: item.category,
      tags: item.tags,
      difficulty: item.difficulty,
    });
  });
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`写入 ${subset.length} 条记录到 ${filePath}`);
}
