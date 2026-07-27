# Aster 语言错误码参考

本文档列出了 Aster 语言编译器和类型检查器使用的所有错误码。

**总计**: 70 个错误码

## 按类别分类

### 异步编程 (async)

共 5 个错误码

| 错误码 | 严重性 | 消息模板 | 解决方案 |
|--------|--------|----------|----------|
| **E500** `ASYNC_START_NOT_WAITED` | 🔴 error | Started async task '&#123;task&#125;' not waited | Call wait on started async tasks to ensure completion. |
| **E501** `ASYNC_WAIT_NOT_STARTED` | 🔴 error | Waiting for async task '&#123;task&#125;' that was never started | Ensure the task name in wait matches a started task. |
| **E502** `ASYNC_DUPLICATE_START` | 🔴 error | Async task '&#123;task&#125;' started multiple times (&#123;count&#125; occurrences) | Avoid starting the same task multiple times; reuse or rename. |
| **E503** `ASYNC_DUPLICATE_WAIT` | 🟡 warning | Async task '&#123;task&#125;' waited multiple times (&#123;count&#125; occurrences) | Ensure each task is waited on only once, or use a separate synchronization mechanism. |
| **E504** `ASYNC_WAIT_BEFORE_START` | 🔴 error | Wait for async task '&#123;task&#125;' occurs before any matching start | Execute start before wait, and ensure both are on compatible control paths. |

### 能力系统 (capability)

共 7 个错误码

| 错误码 | 严重性 | 消息模板 | 解决方案 |
|--------|--------|----------|----------|
| **E027** `WORKFLOW_UNDECLARED_CAPABILITY` | 🔴 error | Workflow '&#123;func&#125;' step '&#123;step&#125;' uses capability &#123;capability&#125; that is not declared on the function header. | Declare &#123;capability&#125; in the function header or adjust the step code. |
| **E028** `COMPENSATE_NEW_CAPABILITY` | 🔴 error | Compensate block for step '&#123;step&#125;' in function '&#123;func&#125;' introduces new capability &#123;capability&#125; that does not appear in the main step body. | Compensate blocks can only reuse capabilities from the main step body. |
| **E300** `CAPABILITY_NOT_ALLOWED` | 🔴 error | Function '&#123;func&#125;' requires &#123;cap&#125; capability but manifest for module '&#123;module&#125;' denies it. | Update the capability manifest or modify the function to comply. |
| **E301** `EFF_CAP_MISSING` | 🔴 error | Function '&#123;func&#125;' uses &#123;cap&#125; capability but header declares [&#123;declared&#125;]. | Declare the actually used capabilities in the function header. |
| **E302** `EFF_CAP_SUPERFLUOUS` | 🔵 info | Function '&#123;func&#125;' declares &#123;cap&#125; capability but it is not used. | Remove unused capability declarations for clarity. |
| **E303** `CAPABILITY_INFER_MISSING_IO` | 🔴 error | Function '&#123;func&#125;' uses IO capabilities [&#123;capabilities&#125;] but is missing @io effect (e.g., &#123;calls&#125;). | Declare @io effect in the function header, or remove related calls to stay pure. |
| **E304** `CAPABILITY_INFER_MISSING_CPU` | 🔴 error | Function '&#123;func&#125;' performs CPU capability calls (e.g., &#123;calls&#125;) but declares neither @cpu nor @io effect. | Add @cpu or @io effect to cover CPU capabilities. |

### 效果系统 (effect)

共 12 个错误码

| 错误码 | 严重性 | 消息模板 | 解决方案 |
|--------|--------|----------|----------|
| **E023** `WORKFLOW_COMPENSATE_MISSING` | 🟡 warning | Step '&#123;step&#125;' performs side effects but does not define a compensate block. | Provide a compensate block for steps with IO side effects to enable rollback. |
| **E026** `WORKFLOW_MISSING_IO_EFFECT` | 🔴 error | Workflow '&#123;func&#125;' must declare @io effect before using a 'workflow' block. | Add @io effect declaration to the function header. |
| **E200** `EFF_MISSING_IO` | 🔴 error | Function '&#123;func&#125;' may perform I/O but is missing @io effect. | Declare @io effect for functions that perform I/O. |
| **E201** `EFF_MISSING_CPU` | 🔴 error | Function '&#123;func&#125;' may perform CPU-bound work but is missing @cpu (or @io) effect. | Declare @cpu or @io effect for CPU-intensive functions. |
| **E202** `EFF_SUPERFLUOUS_IO_CPU_ONLY` | 🔵 info | Function '&#123;func&#125;' declares @io but only CPU-like work found; @io subsumes @cpu and may be unnecessary. | If the function only does CPU work, consider removing the redundant @io declaration. |
| **E203** `EFF_SUPERFLUOUS_IO` | 🟡 warning | Function '&#123;func&#125;' declares @io but no obvious I/O found. | Confirm @io is needed; remove if no I/O behavior exists. |
| **E204** `EFF_SUPERFLUOUS_CPU` | 🟡 warning | Function '&#123;func&#125;' declares @cpu but no obvious CPU-bound work found. | Remove the redundant @cpu declaration or add corresponding CPU work. |
| **E205** `EFF_INFER_MISSING_IO` | 🔴 error | Function '&#123;func&#125;' missing @io effect declaration, inference requires IO. | Add @io effect based on inference results. |
| **E206** `EFF_INFER_MISSING_CPU` | 🔴 error | Function '&#123;func&#125;' missing @cpu effect declaration, inference requires CPU (or @io). | Add @cpu or @io effect based on inference results. |
| **E207** `EFF_INFER_REDUNDANT_IO` | 🟡 warning | Function '&#123;func&#125;' declares @io but no IO side effects inferred. | Confirm whether to keep the @io declaration. |
| **E208** `EFF_INFER_REDUNDANT_CPU` | 🟡 warning | Function '&#123;func&#125;' declares @cpu but no CPU side effects inferred. | Remove the @cpu declaration if no CPU side effects exist. |
| **E209** `EFF_INFER_REDUNDANT_CPU_WITH_IO` | 🟡 warning | Function '&#123;func&#125;' declares both @cpu and @io; @cpu is redundant since @io is required. | Keep @io only; remove the redundant @cpu. |

### PII 隐私保护 (pii)

共 10 个错误码

| 错误码 | 严重性 | 消息模板 | 解决方案 |
|--------|--------|----------|----------|
| **E070** `PII_ASSIGN_DOWNGRADE` | 🔴 error | Cannot assign PII data to lower-level target: &#123;source&#125; -&gt; &#123;target&#125; | Use a sanitization function or declare a matching @pii level on the target. |
| **E072** `PII_SINK_UNSANITIZED` | 🔴 error | PII level &#123;level&#125; data output to &#123;sinkKind&#125; without sanitization | Call redact() or tokenize() before output to reduce sensitivity. |
| **E073** `PII_ARG_VIOLATION` | 🔴 error | PII argument type mismatch: expected &#123;expected&#125;, got &#123;actual&#125; | Check the function signature to ensure PII levels and categories match. |
| **E400** `PII_HTTP_UNENCRYPTED` | 🔴 error | PII data transmitted over HTTP without encryption | Use an encrypted channel (HTTPS) or sanitize before transmitting PII data. |
| **E401** `PII_ANNOTATION_MISSING` | 🔴 error | PII annotation missing for value flowing into '&#123;sink&#125;' | Add @pii annotation to sensitive data for tracking. |
| **E402** `PII_SENSITIVITY_MISMATCH` | 🟡 warning | PII sensitivity mismatch: required &#123;required&#125;, got &#123;actual&#125; | Adjust the data sensitivity level or update the process requirements. |
| **E403** `PII_MISSING_CONSENT_CHECK` | 🟡 warning | Function '&#123;func&#125;' processes PII data without consent check (GDPR Art. 6) | Call checkConsent() or add @consent_required annotation before processing PII data. |
| **E404** `PII_ANALYZER_FAILED` | 🔴 error | PII safety analysis failed for this module — the editor cannot verify whether sensitive data is correctly handled. This policy should not be deployed until the analysis succeeds. Internal reason: &#123;reason&#125; | Try saving and reloading the file. If the error persists, contact your administrator or report this issue with the source code attached. |
| **W071** `PII_IMPLICIT_UPLEVEL` | 🟡 warning | Implicit PII level escalation detected: &#123;source&#125; -&gt; &#123;target&#125; | Add explicit type annotations for level changes to aid auditing. |
| **W074** `PII_SINK_UNKNOWN` | 🟡 warning | PII data may flow to &#123;sinkKind&#125; without annotation | Add @pii annotation to track sensitive data flow. |

### 作用域与导入 (scope)

共 6 个错误码

| 错误码 | 严重性 | 消息模板 | 解决方案 |
|--------|--------|----------|----------|
| **E029** `WORKFLOW_UNKNOWN_STEP_DEPENDENCY` | 🔴 error | Workflow step '&#123;step&#125;' depends on undefined step '&#123;dependency&#125;'. | Only reference declared step names in the current workflow. |
| **E100** `DUPLICATE_IMPORT_ALIAS` | 🟡 warning | Duplicate import alias '&#123;alias&#125;'. | Use unique aliases for different imports to avoid shadowing. |
| **E101** `UNDEFINED_VARIABLE` | 🔴 error | Undefined variable: &#123;name&#125; | Declare and initialize the variable before use. |
| **E102** `MULTIPLE_ENTRY_RULES` | 🔴 error | Multiple @entry rules in module: &#123;rules&#125; | Keep at most one Rule annotated with @entry in a module. |
| **E103** `IMPORT_SYMBOL_CONFLICT` | 🟡 warning | Import symbol conflict: &#123;symbol&#125; | Adjust the import alias or the local top-level declaration name to avoid the import symbol conflict. |
| **E104** `DUPLICATE_SYMBOL` | 🔴 error | Symbol '&#123;name&#125;' is already defined in this scope. | Choose a different name or check for unintended duplicate declarations. |

### 类型系统 (type)

共 30 个错误码

| 错误码 | 严重性 | 消息模板 | 解决方案 |
|--------|--------|----------|----------|
| **E001** `TYPE_MISMATCH` | 🔴 error | Type mismatch: expected &#123;expected&#125;, got &#123;actual&#125; | Check that the type annotation matches the inferred expression type. |
| **E002** `TYPE_MISMATCH_ASSIGN` | 🔴 error | Type mismatch assigning to '&#123;name&#125;': &#123;expected&#125; vs &#123;actual&#125; | Ensure the variable's previous binding type matches the current assignment. |
| **E003** `RETURN_TYPE_MISMATCH` | 🔴 error | Return type mismatch: expected &#123;expected&#125;, got &#123;actual&#125; | Check that the return statement matches the declared return type. |
| **E004** `TYPE_VAR_UNDECLARED` | 🔴 error | Type variable '&#123;name&#125;' is used in '&#123;func&#125;' but not declared in its type parameters. | Declare used type variables in the function signature's 'of' clause. |
| **E005** `TYPE_PARAM_UNUSED` | 🟡 warning | Type parameter '&#123;name&#125;' on '&#123;func&#125;' is declared but not used. | Remove unused type parameters to avoid confusion. |
| **E006** `TYPEVAR_LIKE_UNDECLARED` | 🔴 error | Type variable-like '&#123;name&#125;' is used in '&#123;func&#125;' but not declared; declare it with 'of &#123;name&#125;'. | For names that look like type variables, declare them in the 'of' clause. |
| **E007** `TYPEVAR_INCONSISTENT` | 🔴 error | Type variable '&#123;name&#125;' inferred inconsistently: &#123;previous&#125; vs &#123;actual&#125; | Ensure all usage sites of a type variable produce the same concrete type. |
| **E008** `IF_BRANCH_MISMATCH` | 🔴 error | If branch type mismatch: then &#123;thenType&#125; vs else &#123;elseType&#125; | Ensure both branches of an if expression return the same type. |
| **E009** `MATCH_BRANCH_MISMATCH` | 🔴 error | Match case return types differ: &#123;expected&#125; vs &#123;actual&#125; | Check that all match branches return the same type. |
| **E010** `INTEGER_PATTERN_TYPE` | 🔴 error | Integer pattern used on non-Int scrutinee (&#123;scrutineeType&#125;) | Only use integer patterns on Int-typed match expressions. |
| **E011** `UNKNOWN_FIELD` | 🔴 error | Unknown field '&#123;field&#125;' for &#123;type&#125; | Check that the field name is correct for the data type. |
| **E012** `FIELD_TYPE_MISMATCH` | 🔴 error | Field '&#123;field&#125;' expects &#123;expected&#125;, got &#123;actual&#125; | Verify the field initializer expression matches the declared type. |
| **E013** `MISSING_REQUIRED_FIELD` | 🔴 error | Construction of &#123;type&#125; missing required field '&#123;field&#125;' | Provide all required fields declared in the data type. |
| **E014** `NOT_CALL_ARITY` | 🔴 error | not(...) expects 1 argument | Adjust the not() call to have exactly 1 argument. |
| **E015** `AWAIT_TYPE` | 🟡 warning | await expects Maybe&lt;T&gt; or Result&lt;T,E&gt;, got &#123;type&#125; | Only use await on Maybe or Result types. |
| **E016** `DUPLICATE_ENUM_CASE` | 🟡 warning | Duplicate enum case '&#123;case&#125;' in match on &#123;type&#125;. | Remove duplicate enum branches to keep the match concise. |
| **E017** `NON_EXHAUSTIVE_MAYBE` | 🟡 warning | Non-exhaustive match on Maybe type; missing &#123;missing&#125; case. | Add both null and non-null branches for Maybe matches. |
| **E018** `NON_EXHAUSTIVE_ENUM` | 🟡 warning | Non-exhaustive match on &#123;type&#125;; missing: &#123;missing&#125; | Add all uncovered enum branches, or add a wildcard. |
| **E019** `AMBIGUOUS_INTEROP_NUMERIC` | 🟡 warning | Ambiguous interop call '&#123;target&#125;': mixing numeric kinds (Int=&#123;hasInt&#125;, Long=&#123;hasLong&#125;, Double=&#123;hasDouble&#125;). Overload resolution may widen/box implicitly. | Unify numeric argument types in interop calls to avoid implicit boxing and widening. |
| **E020** `LIST_ELEMENT_TYPE_MISMATCH` | 🔴 error | List literal element type mismatch: expected &#123;expected&#125;, got &#123;actual&#125; | Ensure all elements in a list literal have the same type. |
| **E021** `OPTIONAL_EXPECTED` | 🔴 error | Optional value required here: expected Maybe or Option, but got &#123;actual&#125; | Pass a Maybe/Option type or explicitly wrap the value. |
| **E022** `WORKFLOW_COMPENSATE_TYPE` | 🔴 error | Compensate block for step '&#123;step&#125;' must return Result&lt;Unit, &#123;expectedErr&#125;&gt;, got &#123;actual&#125; | Ensure the compensate block returns Result&lt;Unit, E&gt; where E is the step error type. |
| **E024** `WORKFLOW_RETRY_INVALID` | 🔴 error | Workflow retry max attempts must be greater than zero (actual: &#123;maxAttempts&#125;). | Set retry.maxAttempts to a positive integer. |
| **E025** `WORKFLOW_TIMEOUT_INVALID` | 🔴 error | Workflow timeout must be greater than zero milliseconds (actual: &#123;milliseconds&#125;). | Set the timeout to a positive value to ensure compensate logic can be triggered. |
| **E030** `WORKFLOW_CIRCULAR_DEPENDENCY` | 🔴 error | Workflow contains circular step dependency: &#123;cycle&#125; | Remove or restructure circular dependencies to enable topological execution. |
| **E031** `DECIMAL_DOUBLE_MIXING` | 🔴 error | Cannot combine Decimal and Double in '&#123;operator&#125;'. Double is binary floating-point and would inject rounding error into an exact Decimal. Use Decimal literals (e.g. 1.08m) on both sides, or Int/Long (exact promotion). | Make both operands Decimal (suffix m), or use Int/Long which promote exactly to Decimal. |
| **E210** `EFFECT_VAR_UNDECLARED` | 🔴 error | Effect variable &#123;var&#125; undeclared | Add the effect type parameter to the function signature's effect parameter list. |
| **E211** `EFFECT_VAR_UNRESOLVED` | 🔴 error | Effect variable &#123;vars&#125; could not be resolved to concrete effects | Provide explicit effects (pure/cpu/io/workflow) or remove unused effect variables. |
| **W105** `WORKFLOW_RETRY_INCONSISTENT` | 🟡 warning | Workflow retry configuration may be unreasonable: &#123;reason&#125; | Check the combination of total wait time, maxAttempts, and backoff strategy. |
| **W106** `WORKFLOW_TIMEOUT_UNREASONABLE` | 🟡 warning | Workflow timeout configuration may be unreasonable: &#123;reason&#125; | Check whether the timeout value is too large or too small. |

## 附录

### 严重性级别

- 🔴 **error**: 阻止编译，必须修复
- 🟡 **warning**: 不阻止编译，但建议修复
- 🔵 **info**: 信息提示，可选择性处理

### 占位符说明

错误消息模板中的 `{name}` 形式表示占位符，运行时会被具体值替换。例如：
- `{expected}`、`{actual}`: 期望类型与实际类型
- `{func}`、`{name}`: 函数名或变量名
- `{capability}`: 能力名称（如 Http、Sql）

### 错误码编号规则

- **E001-E099**: 类型系统错误
- **E100-E199**: 作用域与导入错误
- **E200-E299**: 效果系统错误
- **E300-E399**: 能力系统错误
- **E400-E499**: PII 隐私相关错误
- **E500-E599**: 异步编程错误
- **W0xx**: 警告级别错误码（使用 W 前缀）

---

*本文档由 `scripts/generate_error_code_docs.ts` 自动生成*
